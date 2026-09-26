/**
 * Paquete para el contador: un ZIP con el Excel de estados financieros y detalle, más todos los
 * recibos del periodo. Encabezados en español con inglés entre paréntesis (el Form 5472 suele
 * prepararlo un contador de EE. UU.).
 */
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { and, asc, gte, lte } from "drizzle-orm";
import * as s from "@/db/schema";
import { loadFinanceData } from "@/lib/data/finance-data";
import { CASHFLOW_ROWS, computeBalanceSheet, computeCashFlow, computePnlReport, PNL_ROWS } from "@/lib/finance/engine";
import { BRAND } from "@/lib/config";
import type { Tx } from "./ledger";

const PNL_EN: Record<string, string> = {
  gross: "Gross billings",
  processorFees: "Platform fees",
  affiliateFees: "Affiliate fees",
  revenue: "Net revenue",
  cogs: "Cost of revenue",
  grossProfit: "Gross profit",
  opex: "Operating expenses",
  ebitda: "EBITDA",
  depreciation: "Depreciation & amortization",
  ebit: "Operating income (EBIT)",
  interest: "Interest & financing costs",
  other: "Other income / expense",
  preOperating: "Start-up costs (owner-funded)",
  ebt: "Income before taxes",
  taxes: "Income taxes",
  netProfit: "Net income",
};

const FUNDING: Record<string, string> = { llc_cash: "Caja LLC (LLC cash)", llc_credit: "Tarjeta LLC (LLC card)", owner_personal: "Aporte del dueño (owner-paid)" };
const OWNER_TYPE: Record<string, string> = { contribution: "Aporte (contribution)", loan: "Préstamo del dueño (owner loan)", reimbursement: "Reembolso (reimbursement)", draw: "Retiro (draw)" };

const MONEY = '#,##0.00;[Red]-#,##0.00';
const slug = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase() || "gasto";

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.money ? { numFmt: MONEY } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFF5F5EF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003028" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  return ws;
}

export type PackageOptions = { from: string; to: string; hnlPerUsd: number; readBlob?: (path: string) => Promise<Uint8Array | null> };

export async function buildAccountantPackage(tx: Tx, { from, to, hnlPerUsd, readBlob }: PackageOptions) {
  const data = await loadFinanceData(tx as never);
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const [expenses, revenues, movements, owner, accounts, categories, products, counterparties, attachments] = await Promise.all([
    tx.select().from(s.expenses).where(and(gte(s.expenses.expenseDate, from), lte(s.expenses.expenseDate, to))).orderBy(asc(s.expenses.expenseDate)),
    tx.select().from(s.revenues).where(and(gte(s.revenues.revenueDate, from), lte(s.revenues.revenueDate, to))).orderBy(asc(s.revenues.revenueDate)),
    tx.select().from(s.cashMovements).where(and(gte(s.cashMovements.movementDate, from), lte(s.cashMovements.movementDate, to))).orderBy(asc(s.cashMovements.movementDate)),
    tx.select().from(s.ownerLedger).where(and(gte(s.ownerLedger.entryDate, from), lte(s.ownerLedger.entryDate, to))).orderBy(asc(s.ownerLedger.entryDate)),
    tx.select().from(s.financialAccounts),
    tx.select().from(s.categories),
    tx.select().from(s.products),
    tx.select().from(s.counterparties),
    tx.select().from(s.expenseAttachments),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  const prod = new Map(products.map((p) => [p.id, p.name]));
  const vendor = new Map(counterparties.map((c) => [c.id, c.name]));
  const inPeriod = new Set(expenses.map((e) => e.id));
  const files = attachments.filter((a) => inPeriod.has(a.expenseId));

  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.company;
  wb.created = new Date();

  // ── Resumen ────────────────────────────────────────────────────────────────
  const pnl = computePnlReport(data, { from: fromMonth, to: toMonth, granularity: "month" });
  const bs = computeBalanceSheet(data, { asOf: to, hnlPerUsd });
  const summary = sheet(wb, "Resumen (Summary)", [
    { header: "Concepto (Item)", key: "k", width: 48 },
    { header: "Valor (Value)", key: "v", width: 22 },
  ]);
  const t = pnl.total;
  const contributions = owner.filter((o) => o.type === "contribution").reduce((a, o) => a + o.amountCents * Number(o.fxRateToUsd), 0) / 100;
  const draws = owner.filter((o) => o.type === "draw").reduce((a, o) => a + o.amountCents * Number(o.fxRateToUsd), 0) / 100;
  summary.addRows([
    { k: "Empresa (Company)", v: BRAND.company },
    { k: "Periodo (Period)", v: `${from} → ${to}` },
    { k: "Generado (Generated)", v: new Date().toISOString().slice(0, 10) },
    { k: "Moneda (Currency)", v: "USD" },
    { k: "", v: "" },
    { k: "Facturación bruta (Gross billings)", v: t.gross },
    { k: "Ingreso neto (Net revenue)", v: t.revenue },
    { k: "Utilidad bruta (Gross profit)", v: t.grossProfit },
    { k: "Gastos operativos (Operating expenses)", v: t.opex },
    { k: "EBITDA", v: t.ebitda },
    { k: "Puesta en marcha (Start-up costs, owner-funded)", v: t.preOperating },
    { k: "Utilidad neta (Net income)", v: t.netProfit },
    { k: "", v: "" },
    { k: "Aportes del dueño en el periodo (Owner contributions)", v: Math.round(contributions * 100) / 100 },
    { k: "Retiros del dueño en el periodo (Owner draws)", v: Math.round(draws * 100) / 100 },
    { k: `Activos al ${to} (Total assets)`, v: bs.assets.total },
    { k: `Pasivos al ${to} (Total liabilities)`, v: bs.liabilities.total },
    { k: `Patrimonio al ${to} (Total equity)`, v: bs.equity.total },
    { k: "", v: "" },
    { k: "Gastos registrados (Expense records)", v: expenses.length },
    { k: "Recibos incluidos (Receipts included)", v: files.length },
  ]);
  summary.getColumn("v").numFmt = MONEY;
  summary.getColumn("v").alignment = { horizontal: "right" };

  // ── Estado de resultados por mes ───────────────────────────────────────────
  const pnlWs = sheet(wb, "Resultados (P&L)", [
    { header: "Línea (Line)", key: "line", width: 44 },
    ...pnl.periods.map((p) => ({ header: p.label, key: p.key, width: 14, money: true })),
    { header: "Total", key: "total", width: 14, money: true },
  ]);
  for (const r of PNL_ROWS) {
    const es = r.label.replace(/^[−±]\s*/, "");
    const row = pnlWs.addRow({ line: es === PNL_EN[r.key] ? es : `${es} (${PNL_EN[r.key]})`, ...Object.fromEntries(pnl.periods.map((p) => [p.key, p[r.key]])), total: t[r.key] });
    if ("strong" in r && r.strong) row.font = { bold: true };
  }

  // ── Balance general ────────────────────────────────────────────────────────
  const bsWs = sheet(wb, "Balance (Balance sheet)", [
    { header: `Al ${to} (As of)`, key: "k", width: 50 },
    { header: "USD", key: "v", width: 16, money: true },
  ]);
  const bold = (k: string, v: number) => (bsWs.addRow({ k, v }).font = { bold: true });
  bold("ACTIVOS (ASSETS)", bs.assets.total);
  for (const c of bs.assets.cash) bsWs.addRow({ k: `  Banco: ${c.name}`, v: c.amount });
  for (const p of bs.assets.platforms) bsWs.addRow({ k: `  Por cobrar en plataforma: ${p.name} (Platform receivable)`, v: p.amount });
  if (bs.assets.receivables) bsWs.addRow({ k: "  Cuentas por cobrar (Receivables)", v: bs.assets.receivables });
  bold("PASIVOS (LIABILITIES)", bs.liabilities.total);
  for (const c of bs.liabilities.cards) bsWs.addRow({ k: `  Tarjeta: ${c.name} (Credit card)`, v: c.amount });
  if (bs.liabilities.payables) bsWs.addRow({ k: "  Cuentas por pagar (Payables)", v: bs.liabilities.payables });
  for (const d of bs.liabilities.debts) bsWs.addRow({ k: `  Deuda: ${d.name} (Debt)`, v: d.amount });
  if (bs.liabilities.ownerLoans) bsWs.addRow({ k: "  Préstamos del dueño (Owner loans)", v: bs.liabilities.ownerLoans });
  bold("PATRIMONIO (EQUITY)", bs.equity.total);
  bsWs.addRow({ k: "  Capital aportado (Contributed capital)", v: bs.equity.capital });
  bsWs.addRow({ k: "  Retiros (Draws)", v: -bs.equity.draws });
  bsWs.addRow({ k: "  Resultados acumulados (Retained earnings)", v: bs.equity.retained });
  if (bs.equity.preOperating) bsWs.addRow({ k: "  Puesta en marcha (Start-up costs)", v: -bs.equity.preOperating });
  if (bs.equity.openingBalances) bsWs.addRow({ k: "  Saldos iniciales (Opening balances)", v: bs.equity.openingBalances });
  bsWs.addRow({ k: "Diferencia (debe ser 0) (Check, should be 0)", v: bs.difference });

  // ── Flujo de efectivo ──────────────────────────────────────────────────────
  const cf = computeCashFlow(data, { from: fromMonth, to: toMonth, granularity: "month" });
  const cfWs = sheet(wb, "Flujo (Cash flow)", [{ header: "Concepto (Item)", key: "k", width: 46 }, ...cf.periods.map((p) => ({ header: p.label, key: p.key, width: 14, money: true }))]);
  const cfRow = (label: string, get: (p: (typeof cf.periods)[number]) => number, strong = false) => {
    const row = cfWs.addRow({ k: label, ...Object.fromEntries(cf.periods.map((p) => [p.key, get(p)])) });
    if (strong) row.font = { bold: true };
  };
  cfRow("Caja inicial (Opening cash)", (p) => p.openingCash, true);
  for (const r of CASHFLOW_ROWS.operating) cfRow(`  ${r.label}`, (p) => p.rows[r.key] ?? 0);
  cfRow("Operación (Operating)", (p) => p.operating, true);
  for (const r of CASHFLOW_ROWS.investing) cfRow(`  ${r.label}`, (p) => p.rows[r.key] ?? 0);
  cfRow("Inversión (Investing)", (p) => p.investing, true);
  for (const r of CASHFLOW_ROWS.financing) cfRow(`  ${r.label}`, (p) => p.rows[r.key] ?? 0);
  cfRow("Financiamiento (Financing)", (p) => p.financing, true);
  cfRow("Caja final (Closing cash)", (p) => p.closingCash, true);

  // ── Gastos (con recibos) ───────────────────────────────────────────────────
  const zipFiles: Record<string, Uint8Array> = {};
  const fileNames = new Map<string, string[]>();
  let n = 0;
  for (const a of files) {
    const e = expenses.find((x) => x.id === a.expenseId)!;
    const ext = a.fileName.includes(".") ? a.fileName.split(".").pop()!.toLowerCase().slice(0, 5) : a.contentType === "application/pdf" ? "pdf" : "jpg";
    const name = `recibos/${e.expenseDate}_${slug(e.description)}_${++n}.${ext}`;
    const bytes = readBlob ? await readBlob(a.blobPath) : null;
    if (!bytes) continue;
    zipFiles[name] = bytes;
    fileNames.set(e.id, [...(fileNames.get(e.id) ?? []), name]);
  }
  const expWs = sheet(wb, "Gastos (Expenses)", [
    { header: "Fecha (Date)", key: "date", width: 12 },
    { header: "Descripción (Description)", key: "desc", width: 34 },
    { header: "Proveedor (Vendor)", key: "vendor", width: 20 },
    { header: "Categoría (Category)", key: "cat", width: 22 },
    { header: "Tipo (Type)", key: "kind", width: 16 },
    { header: "Moneda (Currency)", key: "cur", width: 10 },
    { header: "Monto (Amount)", key: "amount", money: true, width: 13 },
    { header: "Tasa a USD (FX)", key: "fx", width: 11 },
    { header: "USD", key: "usd", money: true, width: 13 },
    { header: "Pagado con (Paid with)", key: "fund", width: 26 },
    { header: "Cuenta (Account)", key: "account", width: 20 },
    { header: "Estado (Status)", key: "status", width: 11 },
    { header: "Recibo (Receipt file)", key: "files", width: 44 },
  ]);
  for (const e of expenses) {
    const c = cat.get(e.categoryId);
    expWs.addRow({
      date: e.expenseDate,
      desc: e.description,
      vendor: e.vendorId ? vendor.get(e.vendorId) : "",
      cat: c?.name,
      kind: c?.kind === "cogs" ? "Costo directo (COGS)" : c?.kind === "opex" ? "Operativo (OpEx)" : c?.kind,
      cur: e.currency,
      amount: e.amountCents / 100,
      fx: Number(e.fxRateToUsd),
      usd: Math.round(e.amountCents * Number(e.fxRateToUsd)) / 100,
      fund: FUNDING[e.fundingSource],
      account: e.paymentAccountId ? acc.get(e.paymentAccountId) : "",
      status: e.status,
      files: (fileNames.get(e.id) ?? []).join(", ") || "—",
    });
  }
  expWs.autoFilter = { from: "A1", to: "M1" };

  // ── Ingresos ───────────────────────────────────────────────────────────────
  const revWs = sheet(wb, "Ingresos (Revenue)", [
    { header: "Fecha (Date)", key: "date", width: 12 },
    { header: "Cliente (Customer)", key: "cust", width: 24 },
    { header: "Producto (Product)", key: "prod", width: 22 },
    { header: "Cobro (Billing)", key: "interval", width: 11 },
    { header: "Moneda (Currency)", key: "cur", width: 10 },
    { header: "Bruto (Gross)", key: "gross", money: true },
    { header: "Comisión plataforma (Platform fee)", key: "fee", money: true },
    { header: "Comisión afiliado (Affiliate fee)", key: "aff", money: true },
    { header: "Neto (Net)", key: "net", money: true },
    { header: "Depositado en (Deposited to)", key: "acc", width: 20 },
    { header: "Estado (Status)", key: "status", width: 11 },
  ]);
  for (const r of revenues) {
    revWs.addRow({
      date: r.revenueDate,
      cust: r.customerName ?? "",
      prod: r.productId ? prod.get(r.productId) : "",
      interval: r.billingInterval,
      cur: r.currency,
      gross: r.grossCents / 100,
      fee: r.processorFeeCents / 100,
      aff: r.affiliateFeeCents / 100,
      net: (r.grossCents - r.processorFeeCents - r.affiliateFeeCents) / 100,
      acc: r.depositAccountId ? acc.get(r.depositAccountId) : "",
      status: r.status,
    });
  }
  revWs.autoFilter = { from: "A1", to: "K1" };

  // ── Movimientos bancarios ──────────────────────────────────────────────────
  const movWs = sheet(wb, "Bancos (Bank activity)", [
    { header: "Fecha (Date)", key: "date", width: 12 },
    { header: "Cuenta (Account)", key: "acc", width: 22 },
    { header: "Tipo (Type)", key: "type", width: 20 },
    { header: "Descripción (Description)", key: "desc", width: 36 },
    { header: "Monto (Amount)", key: "amount", money: true },
    { header: "Id del banco (Bank transaction id)", key: "ext", width: 38 },
  ]);
  for (const m of movements) movWs.addRow({ date: m.movementDate, acc: acc.get(m.accountId), type: m.type, desc: m.description ?? "", amount: m.amountCents / 100, ext: m.externalId ?? "" });
  movWs.autoFilter = { from: "A1", to: "F1" };

  // ── Aportes y retiros del dueño (para el Form 5472: transacciones con el dueño extranjero) ──
  const ownWs = sheet(wb, "Dueño (Owner transactions)", [
    { header: "Fecha (Date)", key: "date", width: 12 },
    { header: "Tipo (Type)", key: "type", width: 30 },
    { header: "Descripción (Description)", key: "desc", width: 40 },
    { header: "Moneda (Currency)", key: "cur", width: 10 },
    { header: "Monto (Amount)", key: "amount", money: true },
    { header: "USD", key: "usd", money: true },
  ]);
  for (const o of owner) {
    ownWs.addRow({ date: o.entryDate, type: OWNER_TYPE[o.type] ?? o.type, desc: o.description ?? "", cur: o.currency, amount: o.amountCents / 100, usd: Math.round(o.amountCents * Number(o.fxRateToUsd)) / 100 });
  }

  const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
  const readme = [
    `${BRAND.company} — paquete para el contador / accountant package`,
    `Periodo / Period: ${from} → ${to}`,
    "",
    "paquete.xlsx",
    "  Resumen (Summary), Resultados (P&L por mes), Balance, Flujo de efectivo,",
    "  Gastos con su recibo, Ingresos, Movimientos bancarios y transacciones con el dueño.",
    "recibos/",
    "  Un archivo por recibo; el nombre coincide con la columna 'Recibo' de la hoja Gastos.",
    "",
    "Notas / Notes:",
    "  - Montos en USD; los gastos en lempiras usan la tasa del día del gasto.",
    "  - 'Puesta en marcha' = gastos pagados por el dueño antes del inicio de operaciones (capital inicial).",
    "  - La hoja 'Dueño' reúne las transacciones con el propietario (útil para el Form 5472).",
  ].join("\n");

  // Excel y fotos ya vienen comprimidos: se guardan tal cual (level 0) para no gastar tiempo.
  const entries: Record<string, [Uint8Array, { level: 0 }] | Uint8Array> = { "paquete.xlsx": [xlsx, { level: 0 }], "LEEME.txt": strToU8(readme) };
  for (const [name, bytes] of Object.entries(zipFiles)) entries[name] = [bytes, { level: 0 }];
  return { zip: zipSync(entries), receipts: Object.keys(zipFiles).length, missing: files.length - Object.keys(zipFiles).length };
}

/** Lee un recibo de Vercel Blob como bytes (para meterlo al ZIP). */
export async function readBlobBytes(path: string) {
  const { get } = await import("@vercel/blob");
  const r = await get(path, { access: "private" });
  if (!r?.stream) return null;
  return new Uint8Array(await new Response(r.stream).arrayBuffer());
}
