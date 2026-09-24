import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getChurnAssumptionPct } from "@/lib/data/dashboard";
import { computeDashboard, computePnlReport, GOAL_METRICS } from "@/lib/finance/engine";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";

/**
 * Herramientas del asistente. Las de lectura consultan la BD con los permisos del usuario.
 * Las de escritura NUNCA escriben: devuelven una propuesta que el usuario confirma en pantalla,
 * y la confirmación pasa por las mismas server actions (validación + permisos) que la UI.
 */

export type ProposalKind = "expense" | "revenue" | "cancel_member" | "reactivate_member" | "reminder" | "classify_movement" | "budget" | "goal";
export type Proposal = { id: string; kind: ProposalKind; title: string; lines: string[]; payload: Record<string, unknown> };

const month = z.string().regex(/^\d{4}-\d{2}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().positive().max(10_000_000);

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "resumen_financiero",
    description:
      "Resumen del negocio al día de hoy: caja en bancos, saldo en plataformas (Skool), resultado del mes (ingresos, utilidad, márgenes, EBITDA), MRR/ARR, miembros, burn, runway, deudas y compromisos, próximos movimientos, alertas, presupuesto del mes y metas. Úsala antes de responder cualquier pregunta sobre cómo va el negocio.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listar_movimientos",
    description: "Lista gastos o ingresos de un mes (id, fecha, descripción, categoría/producto, monto, cómo se pagó). Úsala para responder sobre gastos o cobros concretos.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gastos", "ingresos"] },
        mes: { type: "string", description: "YYYY-MM" },
      },
      required: ["tipo", "mes"],
      additionalProperties: false,
    },
  },
  {
    name: "estado_de_resultados",
    description: "Estado de resultados (P&L) por mes, trimestre o año entre dos meses: facturación, comisiones, ingreso neto, costos directos, utilidad bruta, gastos operativos, EBITDA, EBIT, intereses, utilidad neta y márgenes.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "YYYY-MM" },
        hasta: { type: "string", description: "YYYY-MM" },
        agrupacion: { type: "string", enum: ["month", "quarter", "year"] },
      },
      required: ["desde", "hasta", "agrupacion"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_miembros",
    description: "Lista miembros de la comunidad (id, nombre, plan, frecuencia, precio, próxima renovación, estado). Filtra por estado y opcionalmente por nombre.",
    input_schema: {
      type: "object",
      properties: {
        estado: { type: "string", enum: ["activos", "bajas", "todos"] },
        buscar: { type: "string", description: "Parte del nombre (opcional)" },
      },
      required: ["estado"],
      additionalProperties: false,
    },
  },
  {
    name: "catalogos",
    description: "Ids y nombres de categorías (con su tipo), productos, cuentas de la LLC y suscripciones. Úsala para obtener los ids que piden las propuestas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "movimientos_bancarios",
    description: "Movimientos de las cuentas de la LLC que están sin clasificar (ajustes sueltos), con su id, fecha, monto y descripción.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  // ── Propuestas (requieren confirmación del usuario) ──
  {
    name: "proponer_gasto",
    description: "Propone registrar un gasto. No lo registra: el usuario lo confirma en pantalla. 'pago' es el id de una cuenta o tarjeta de la LLC, o 'aporte_dueno' si lo pagó el dueño con dinero personal.",
    input_schema: {
      type: "object",
      properties: {
        descripcion: { type: "string" },
        monto: { type: "number", description: "En la moneda indicada, sin símbolos" },
        moneda: { type: "string", enum: ["USD", "HNL"] },
        fecha: { type: "string", description: "YYYY-MM-DD" },
        categoria_id: { type: "string" },
        pago: { type: "string" },
      },
      required: ["descripcion", "monto", "moneda", "fecha", "categoria_id", "pago"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_ingreso",
    description: "Propone registrar un cobro. 'deposito': id de la cuenta/plataforma donde cayó (ej. Saldo Skool), 'retiro_dueno' si cayó en una cuenta personal, o 'sin_cobrar'.",
    input_schema: {
      type: "object",
      properties: {
        monto_bruto: { type: "number" },
        comision_plataforma: { type: "number" },
        comision_afiliados: { type: "number" },
        fecha: { type: "string", description: "YYYY-MM-DD" },
        producto_id: { type: "string", description: "Opcional si se da categoria_id" },
        categoria_id: { type: "string", description: "Opcional si se da producto_id" },
        tipo_cobro: { type: "string", enum: ["one_time", "monthly", "quarterly", "annual"] },
        cliente: { type: "string" },
        deposito: { type: "string" },
      },
      required: ["monto_bruto", "comision_plataforma", "comision_afiliados", "fecha", "tipo_cobro", "deposito"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_baja_miembro",
    description: "Propone dar de baja a un miembro (deja de contar en el MRR). 'desde': al terminar su periodo pagado o ya mismo.",
    input_schema: {
      type: "object",
      properties: { miembro_id: { type: "string" }, desde: { type: "string", enum: ["fin_de_periodo", "ahora"] } },
      required: ["miembro_id", "desde"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_reactivar_miembro",
    description: "Propone reactivar a un miembro dado de baja (vuelve a sumar al MRR).",
    input_schema: { type: "object", properties: { miembro_id: { type: "string" } }, required: ["miembro_id"], additionalProperties: false },
  },
  {
    name: "proponer_recordatorio",
    description: "Propone crear un recordatorio que aparecerá en 'Próximos movimientos'.",
    input_schema: {
      type: "object",
      properties: { titulo: { type: "string" }, fecha: { type: "string", description: "YYYY-MM-DD" }, detalle: { type: "string" } },
      required: ["titulo", "fecha"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_clasificar_movimiento",
    description:
      "Propone clasificar un movimiento bancario sin clasificar como: owner_contribution (depósito/aporte del dueño, entra), owner_draw (retiro, sale), revenue (ingreso, entra), expense (gasto, sale; requiere categoria_id), other_income (cashback/intereses, entra), bank_fee (comisión, sale).",
    input_schema: {
      type: "object",
      properties: {
        movimiento_id: { type: "string" },
        como: { type: "string", enum: ["owner_contribution", "owner_draw", "revenue", "expense", "other_income", "bank_fee"] },
        descripcion: { type: "string" },
        categoria_id: { type: "string" },
        producto_id: { type: "string" },
      },
      required: ["movimiento_id", "como", "descripcion"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_presupuesto",
    description: "Propone un presupuesto (tope de gasto) para una categoría. 'mes' YYYY-MM, o 'todos' para que aplique cada mes.",
    input_schema: {
      type: "object",
      properties: { categoria_id: { type: "string" }, mes: { type: "string" }, monto: { type: "number" } },
      required: ["categoria_id", "mes", "monto"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_meta",
    description:
      "Propone una meta. metrica: gross_revenue (facturación), net_revenue, net_profit, mrr, active_members, new_members, cash. objetivo en dólares o número de miembros.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        metrica: { type: "string", enum: Object.keys(GOAL_METRICS) },
        objetivo: { type: "number" },
        inicio: { type: "string", description: "YYYY-MM-DD" },
        fin: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["nombre", "metrica", "objetivo", "inicio", "fin"],
      additionalProperties: false,
    },
  },
];

export const ASSISTANT_TOOLS = TOOLS;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Ejecuta una herramienta. Devuelve texto (JSON) para el modelo y, si aplica, una propuesta. */
export async function runTool(
  name: string,
  rawInput: unknown,
  user: SessionUser
): Promise<{ result: string; isError?: boolean; proposal?: Proposal }> {
  const db = await getDb();
  const today = todayIn();
  const deny = (what: string) => ({ result: `Sin permiso para ${what}.`, isError: true });
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const newId = () => crypto.randomUUID();

  const names = async () => {
    const [cats, prods, accts, mems] = await Promise.all([
      db.select().from(s.categories),
      db.select().from(s.products),
      db.select().from(s.financialAccounts).where(eq(s.financialAccounts.owner, "llc")),
      db.select({ id: s.members.id, name: s.members.name }).from(s.members),
    ]);
    return {
      cat: new Map(cats.map((c) => [c.id, c])),
      prod: new Map(prods.map((p) => [p.id, p])),
      acct: new Map(accts.map((a) => [a.id, a])),
      member: new Map(mems.map((m) => [m.id, m.name])),
    };
  };

  switch (name) {
    case "resumen_financiero": {
      if (!can(user.permissions, "dashboard")) return deny("ver el dashboard");
      const [data, fx, churn] = await Promise.all([loadFinanceData(db), getUsdHnlRate(), getChurnAssumptionPct()]);
      const d = computeDashboard(data, { asOf: today, hnlPerUsd: fx.hnlPerUsd, churnAssumption: churn / 100 });
      return {
        result: JSON.stringify({
          hoy: today,
          mes: d.period.name,
          kpis: d.kpis,
          caja_bancos: d.cash,
          plataformas_de_cobro: d.platforms,
          miembros: d.members,
          gastos_del_mes: d.month,
          pasivos: d.liabilities,
          proximos: d.upcoming.slice(0, 10),
          alertas: d.insights,
          presupuesto_del_mes: d.budgets,
          metas: d.goals.map((g) => ({ nombre: g.name, metrica: g.label, valor: g.value, objetivo: g.target, avance: g.progress, estado: g.status })),
          tipo_de_cambio: fx.hnlPerUsd,
        }),
      };
    }
    case "listar_movimientos": {
      const p = z.object({ tipo: z.enum(["gastos", "ingresos"]), mes: month }).safeParse(input);
      if (!p.success) return { result: "Parámetros inválidos: tipo y mes (YYYY-MM).", isError: true };
      const [y, m] = p.data.mes.split("-").map(Number);
      const from = `${p.data.mes}-01`;
      const to = `${p.data.mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
      const n = await names();
      if (p.data.tipo === "gastos") {
        if (!can(user.permissions, "expenses")) return deny("ver gastos");
        const rows = await db.select().from(s.expenses).where(and(gte(s.expenses.expenseDate, from), lte(s.expenses.expenseDate, to))).orderBy(desc(s.expenses.expenseDate)).limit(80);
        return {
          result: JSON.stringify(
            rows.map((e) => ({
              id: e.id,
              fecha: e.expenseDate,
              descripcion: e.description,
              categoria: n.cat.get(e.categoryId)?.name,
              monto: e.amountCents / 100,
              moneda: e.currency,
              pagado_con: e.fundingSource === "owner_personal" ? "Aporte del dueño" : (n.acct.get(e.paymentAccountId ?? "")?.name ?? "—"),
              estado: e.status,
            }))
          ),
        };
      }
      if (!can(user.permissions, "revenue")) return deny("ver ingresos");
      const rows = await db.select().from(s.revenues).where(and(gte(s.revenues.revenueDate, from), lte(s.revenues.revenueDate, to))).orderBy(desc(s.revenues.revenueDate)).limit(120);
      return {
        result: JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            fecha: r.revenueDate,
            producto: r.productId ? n.prod.get(r.productId)?.name : n.cat.get(r.categoryId)?.name,
            cliente: r.customerName,
            bruto: r.grossCents / 100,
            comisiones: (r.processorFeeCents + r.affiliateFeeCents) / 100,
            neto: r.netCents / 100,
            moneda: r.currency,
            tipo_cobro: r.billingInterval,
          }))
        ),
      };
    }
    case "estado_de_resultados": {
      if (!can(user.permissions, "reports")) return deny("ver reportes");
      const p = z.object({ desde: month, hasta: month, agrupacion: z.enum(["month", "quarter", "year"]) }).safeParse(input);
      if (!p.success) return { result: "Parámetros inválidos.", isError: true };
      const r = computePnlReport(await loadFinanceData(db), { from: p.data.desde, to: p.data.hasta, granularity: p.data.agrupacion });
      return { result: JSON.stringify(r.periods.map((period) => ({ ...period, prev: undefined, yoy: undefined }))) };
    }
    case "listar_miembros": {
      if (!can(user.permissions, "revenue")) return deny("ver miembros");
      const p = z.object({ estado: z.enum(["activos", "bajas", "todos"]), buscar: z.string().optional() }).safeParse(input);
      if (!p.success) return { result: "Parámetros inválidos.", isError: true };
      const n = await names();
      const rows = (await db.select().from(s.members).orderBy(asc(s.members.name)))
        .filter((m) => (p.data.estado === "todos" ? true : p.data.estado === "activos" ? m.status === "active" : m.status === "canceled"))
        .filter((m) => !p.data.buscar || m.name.toLowerCase().includes(p.data.buscar.toLowerCase()))
        .slice(0, 150);
      return {
        result: JSON.stringify(
          rows.map((m) => ({ id: m.id, nombre: m.name, plan: n.prod.get(m.productId)?.name, frecuencia: m.billingInterval, precio: m.priceCents / 100, renovacion: m.currentPeriodEnd, estado: m.status, baja: m.canceledOn }))
        ),
      };
    }
    case "catalogos": {
      const n = await names();
      const subs = await db.select({ id: s.subscriptions.id, name: s.subscriptions.name, status: s.subscriptions.status }).from(s.subscriptions);
      return {
        result: JSON.stringify({
          categorias: [...n.cat.values()].map((c) => ({ id: c.id, nombre: c.name, tipo: c.kind })),
          productos: [...n.prod.values()].map((p) => ({ id: p.id, nombre: p.name, cobro: p.defaultBillingInterval, precio_lista: p.listPriceCents ? p.listPriceCents / 100 : null })),
          cuentas_llc: [...n.acct.values()].map((a) => ({ id: a.id, nombre: a.name, tipo: a.type, estado: a.status })),
          suscripciones: subs,
        }),
      };
    }
    case "movimientos_bancarios": {
      if (!can(user.permissions, "banking")) return deny("ver cuentas");
      const n = await names();
      const rows = await db.select().from(s.cashMovements).where(eq(s.cashMovements.type, "adjustment")).orderBy(desc(s.cashMovements.movementDate));
      return {
        result: JSON.stringify(
          rows
            .filter((m) => !m.revenueId && !m.expenseId && !m.ownerLedgerId && !m.transferGroupId && n.acct.has(m.accountId))
            .map((m) => ({ id: m.id, cuenta: n.acct.get(m.accountId)?.name, fecha: m.movementDate, monto: m.amountCents / 100, descripcion: m.description }))
        ),
      };
    }
  }

  // ── Propuestas ─────────────────────────────────────────────────────────────
  const n = await names();
  const bad = (msg: string) => ({ result: `No se pudo preparar la propuesta: ${msg}`, isError: true });
  const done = (proposal: Proposal) => ({
    result: `Propuesta lista (${proposal.title}). Todavía NO está aplicada: el usuario debe confirmarla con el botón en pantalla.`,
    proposal,
  });

  switch (name) {
    case "proponer_gasto": {
      if (!can(user.permissions, "expenses", "write")) return deny("registrar gastos");
      const p = z.object({ descripcion: z.string().min(1), monto: money, moneda: z.enum(["USD", "HNL"]), fecha: date, categoria_id: z.string(), pago: z.string() }).safeParse(input);
      if (!p.success) return bad("datos incompletos");
      const c = n.cat.get(p.data.categoria_id);
      if (!c || c.kind === "revenue") return bad("categoría de gasto inválida; consulta catalogos");
      const acct = p.data.pago === "aporte_dueno" ? null : n.acct.get(p.data.pago);
      if (p.data.pago !== "aporte_dueno" && (!acct || acct.type === "processor")) return bad("cuenta de pago inválida (usa una cuenta/tarjeta de la LLC o aporte_dueno)");
      return done({
        id: newId(),
        kind: "expense",
        title: `Gasto: ${p.data.descripcion}`,
        lines: [`${p.data.moneda === "HNL" ? "L" : "$"}${p.data.monto.toFixed(2)} · ${p.data.fecha}`, `Categoría: ${c.name}`, `Pagado con: ${acct?.name ?? "Aporte del dueño"}`],
        payload: { description: p.data.descripcion, amount: p.data.monto, currency: p.data.moneda, date: p.data.fecha, categoryId: c.id, account: acct?.id ?? "personal", card: acct?.type === "credit_card" },
      });
    }
    case "proponer_ingreso": {
      if (!can(user.permissions, "revenue", "write")) return deny("registrar ingresos");
      const p = z
        .object({
          monto_bruto: money,
          comision_plataforma: z.number().min(0),
          comision_afiliados: z.number().min(0),
          fecha: date,
          producto_id: z.string().optional(),
          categoria_id: z.string().optional(),
          tipo_cobro: z.enum(["one_time", "monthly", "quarterly", "annual"]),
          cliente: z.string().optional(),
          deposito: z.string(),
        })
        .safeParse(input);
      if (!p.success) return bad("datos incompletos");
      const prod = p.data.producto_id ? n.prod.get(p.data.producto_id) : undefined;
      const cat = p.data.categoria_id ? n.cat.get(p.data.categoria_id) : undefined;
      if (!prod && (!cat || cat.kind !== "revenue")) return bad("indica un producto o una categoría de ingreso válidos");
      const dep = p.data.deposito;
      const depAcct = n.acct.get(dep);
      if (!["retiro_dueno", "sin_cobrar"].includes(dep) && (!depAcct || depAcct.type === "credit_card")) return bad("depósito inválido");
      return done({
        id: newId(),
        kind: "revenue",
        title: `Ingreso: ${prod?.name ?? cat?.name}${p.data.cliente ? ` · ${p.data.cliente}` : ""}`,
        lines: [`Bruto ${usd(p.data.monto_bruto)} · comisiones ${usd(p.data.comision_plataforma + p.data.comision_afiliados)}`, `${p.data.fecha} · ${p.data.tipo_cobro}`, `Depósito: ${depAcct?.name ?? (dep === "retiro_dueno" ? "Retiro del dueño" : "Sin cobrar")}`],
        payload: {
          gross: p.data.monto_bruto,
          processorFee: p.data.comision_plataforma,
          affiliateFee: p.data.comision_afiliados,
          date: p.data.fecha,
          productId: prod?.id ?? "",
          categoryId: prod ? "" : (cat?.id ?? ""),
          interval: p.data.tipo_cobro,
          customer: p.data.cliente ?? "",
          deposit: depAcct?.id ?? (dep === "retiro_dueno" ? "owner" : ""),
        },
      });
    }
    case "proponer_baja_miembro":
    case "proponer_reactivar_miembro": {
      if (!can(user.permissions, "revenue", "write")) return deny("modificar miembros");
      const id = String(input.miembro_id ?? "");
      const memberName = n.member.get(id);
      if (!memberName) return bad("miembro no encontrado; usa listar_miembros");
      if (name === "proponer_reactivar_miembro")
        return done({ id: newId(), kind: "reactivate_member", title: `Reactivar a ${memberName}`, lines: ["Vuelve a sumar al MRR."], payload: { memberId: id } });
      const when = input.desde === "ahora" ? "now" : "period_end";
      return done({
        id: newId(),
        kind: "cancel_member",
        title: `Dar de baja a ${memberName}`,
        lines: [when === "now" ? "Deja de contar en el MRR desde hoy." : "Deja de contar al terminar su periodo pagado."],
        payload: { memberId: id, when },
      });
    }
    case "proponer_recordatorio": {
      if (!can(user.permissions, "settings", "write")) return deny("crear recordatorios");
      const p = z.object({ titulo: z.string().min(1), fecha: date, detalle: z.string().optional() }).safeParse(input);
      if (!p.success) return bad("datos incompletos");
      return done({ id: newId(), kind: "reminder", title: `Recordatorio: ${p.data.titulo}`, lines: [p.data.fecha, p.data.detalle ?? ""].filter(Boolean), payload: { title: p.data.titulo, dueOn: p.data.fecha, detail: p.data.detalle ?? "" } });
    }
    case "proponer_clasificar_movimiento": {
      if (!can(user.permissions, "banking", "write")) return deny("clasificar movimientos");
      const p = z
        .object({
          movimiento_id: z.string(),
          como: z.enum(["owner_contribution", "owner_draw", "revenue", "expense", "other_income", "bank_fee"]),
          descripcion: z.string().min(1),
          categoria_id: z.string().optional(),
          producto_id: z.string().optional(),
        })
        .safeParse(input);
      if (!p.success) return bad("datos incompletos");
      const [mov] = await db.select().from(s.cashMovements).where(eq(s.cashMovements.id, p.data.movimiento_id));
      if (!mov) return bad("movimiento no encontrado; usa movimientos_bancarios");
      const LABEL = { owner_contribution: "Aporte de capital del dueño", owner_draw: "Retiro del dueño", revenue: "Ingreso", expense: "Gasto", other_income: "Cashback o intereses", bank_fee: "Comisión bancaria" };
      return done({
        id: newId(),
        kind: "classify_movement",
        title: `Clasificar: ${mov.description ?? "movimiento"}`,
        lines: [`${mov.movementDate} · ${usd(mov.amountCents / 100)}`, `Como: ${LABEL[p.data.como]}`, p.data.categoria_id ? `Categoría: ${n.cat.get(p.data.categoria_id)?.name ?? "?"}` : ""].filter(Boolean),
        payload: { id: mov.id, as: p.data.como, description: p.data.descripcion, categoryId: p.data.categoria_id ?? "", productId: p.data.producto_id ?? "" },
      });
    }
    case "proponer_presupuesto": {
      if (!can(user.permissions, "planning", "write")) return deny("crear presupuestos");
      const p = z.object({ categoria_id: z.string(), mes: z.union([month, z.literal("todos")]), monto: money }).safeParse(input);
      if (!p.success) return bad("datos incompletos");
      const c = n.cat.get(p.data.categoria_id);
      if (!c || c.kind === "revenue") return bad("categoría de gasto inválida");
      return done({
        id: newId(),
        kind: "budget",
        title: `Presupuesto: ${c.name}`,
        lines: [`${usd(p.data.monto)} ${p.data.mes === "todos" ? "cada mes" : `en ${p.data.mes}`}`],
        payload: { categoryId: c.id, month: p.data.mes, amount: p.data.monto },
      });
    }
    case "proponer_meta": {
      if (!can(user.permissions, "planning", "write")) return deny("crear metas");
      const p = z.object({ nombre: z.string().min(1), metrica: z.enum(Object.keys(GOAL_METRICS) as [keyof typeof GOAL_METRICS]), objetivo: z.number().positive(), inicio: date, fin: date }).safeParse(input);
      if (!p.success) return bad("datos incompletos");
      const meta = GOAL_METRICS[p.data.metrica];
      return done({
        id: newId(),
        kind: "goal",
        title: `Meta: ${p.data.nombre}`,
        lines: [`${meta.label}: ${meta.kind === "money" ? usd(p.data.objetivo) : p.data.objetivo}`, `${p.data.inicio} → ${p.data.fin}`],
        payload: { name: p.data.nombre, metric: p.data.metrica, target: p.data.objetivo, periodStart: p.data.inicio, periodEnd: p.data.fin },
      });
    }
  }
  return { result: `Herramienta desconocida: ${name}`, isError: true };
}
