/**
 * Vocabulario contable único de la app (base: NIF B-3 estado de resultados, B-2 estado de
 * flujos de efectivo y B-6 estado de situación financiera). Todas las pantallas, el Excel del
 * contador y el informe con IA usan estos nombres: no "EBITDA", "EBIT" ni "P&L".
 */
export const TERMS = {
  // Estado de resultados
  incomeStatement: "Estado de resultados",
  grossSales: "Ventas brutas",
  platformFees: "Comisiones de plataforma",
  affiliateFees: "Comisiones de afiliados",
  netSales: "Ventas netas",
  costOfSales: "Costo de ventas",
  grossProfit: "Beneficio bruto",
  operatingExpenses: "Gastos de operación",
  depreciation: "Depreciación y amortización",
  operatingProfit: "Beneficio operativo",
  financialCosts: "Gastos financieros",
  otherIncome: "Otros ingresos y gastos",
  profitBeforeTax: "Beneficio antes de impuestos",
  incomeTaxes: "Impuestos a la utilidad",
  netProfit: "Beneficio neto",
  grossMargin: "Margen bruto",
  operatingMargin: "Margen operativo",
  netMargin: "Margen neto",
  // Estado de flujos de efectivo
  cashFlowStatement: "Estado de flujos de efectivo",
  operatingActivities: "Actividades de operación",
  investingActivities: "Actividades de inversión",
  financingActivities: "Actividades de financiamiento",
  netCashChange: "Aumento (disminución) neto de efectivo",
  openingCash: "Efectivo al inicio del periodo",
  closingCash: "Efectivo al final del periodo",
  // Estado de situación financiera
  balanceSheet: "Estado de situación financiera",
  assets: "Activo",
  liabilities: "Pasivo",
  equity: "Capital contable",
  contributedCapital: "Capital contribuido (aportaciones del dueño)",
  retainedEarnings: "Resultados acumulados",
  ownerDraws: "Retiros del dueño",
} as const;

/** Qué significa cada concepto, en lenguaje simple. Se muestra al pasar el cursor y en el glosario. */
export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: TERMS.grossSales, meaning: "Todo lo que cobraste a tus clientes, antes de descuentos y comisiones." },
  { term: TERMS.netSales, meaning: "Lo que de verdad te queda de las ventas: ventas brutas menos las comisiones de Skool y de afiliados." },
  { term: TERMS.costOfSales, meaning: "Lo que cuesta entregar el producto (ej. el plan de Skool que hospeda la comunidad)." },
  { term: TERMS.grossProfit, meaning: "Ventas netas − costo de ventas. Cuánto deja el producto antes de los gastos del negocio." },
  { term: TERMS.operatingExpenses, meaning: "Lo que cuesta operar el negocio: software, diseño, consultoría, publicidad, etc." },
  { term: TERMS.operatingProfit, meaning: "Beneficio bruto − gastos de operación. Lo que gana el negocio con su actividad normal." },
  { term: TERMS.financialCosts, meaning: "Intereses y costos de deudas o financiamiento." },
  { term: TERMS.otherIncome, meaning: "Lo que no es de la operación: cashback, intereses ganados, comisiones bancarias, ajustes." },
  { term: TERMS.profitBeforeTax, meaning: "Beneficio operativo − gastos financieros ± otros. Lo que queda antes de impuestos." },
  { term: TERMS.netProfit, meaning: "El beneficio final, después de impuestos. Es lo que realmente ganó la LLC en el periodo." },
  { term: TERMS.operatingActivities, meaning: "Dinero que entra y sale por el día a día: cobros de clientes, pagos a proveedores, impuestos." },
  { term: TERMS.investingActivities, meaning: "Compras de activos que duran (equipo, software comprado de por vida)." },
  { term: TERMS.financingActivities, meaning: "Dinero de y hacia el dueño o los préstamos: aportes, retiros, créditos y su pago." },
  { term: TERMS.assets, meaning: "Lo que la LLC tiene: dinero en bancos y lo que Skool te debe pagar." },
  { term: TERMS.liabilities, meaning: "Lo que la LLC debe: tarjetas, cuentas por pagar, préstamos." },
  { term: TERMS.equity, meaning: "Lo que es tuyo: lo que aportaste más lo que ha ganado el negocio, menos lo que retiraste. Activo = pasivo + capital contable." },
];
