import type { Option } from "@/components/crud/fields";

const toOptions = (m: Record<string, string>): Option[] => Object.entries(m).map(([value, label]) => ({ value, label }));

export const INTERVAL = { one_time: "Pago único", monthly: "Mensual", quarterly: "Trimestral", annual: "Anual" } as const;
export const INTERVAL_OPTIONS = toOptions(INTERVAL);
export const RECURRING_OPTIONS = INTERVAL_OPTIONS.filter((o) => o.value !== "one_time");

export const CURRENCY_OPTIONS: Option[] = [
  { value: "USD", label: "USD · Dólares" },
  { value: "HNL", label: "HNL · Lempiras" },
];

export const REVENUE_STATUS = { pending: "Pendiente", available: "Disponible", paid_out: "Depositado", refunded: "Reembolsado", disputed: "En disputa" } as const;
export const EXPENSE_STATUS = { pending: "Por pagar", paid: "Pagado", financed: "Financiado", void: "Anulado" } as const;
export const SUB_STATUS = { active: "Activa", paused: "Pausada", canceled: "Cancelada" } as const;
export const CONTRACT_STATUS = { active: "Activo", completed: "Liquidado", canceled: "Cancelado" } as const;
export const DEBT_STATUS = { active: "Activa", paid_off: "Pagada", defaulted: "En mora", renegotiated: "Renegociada" } as const;
export const TAX_STATUS = { upcoming: "Próxima", in_progress: "En proceso", filed: "Presentada", paid: "Pagada", overdue: "Vencida", not_required: "No aplica" } as const;
export const ACCOUNT_STATUS = { active: "Activa", pending_opening: "Por abrir", closed: "Cerrada" } as const;
export const ACCOUNT_TYPE = { checking: "Cuenta corriente", savings: "Ahorro", credit_card: "Tarjeta de crédito", processor: "Saldo en plataforma", cash: "Efectivo" } as const;
export const ACCOUNT_OWNER = { llc: "De la LLC", personal: "Personal" } as const;
export const CATEGORY_KIND = { revenue: "Ingreso", cogs: "Costo directo (COGS)", opex: "Gasto operativo (Opex)" } as const;
export const COUNTERPARTY_TYPE = { customer: "Cliente", vendor: "Proveedor", creditor: "Acreedor", tax_authority: "Autoridad fiscal", processor: "Plataforma de cobro" } as const;
export const OWNER_ENTRY = { contribution: "Aporte de capital", loan: "Préstamo del dueño", reimbursement: "Reembolso al dueño", draw: "Retiro del dueño" } as const;
export const FUNDING = { llc_cash: "Caja LLC", llc_credit: "Tarjeta LLC", owner_personal: "Aporte del dueño" } as const;
export const MOVEMENT_TYPE: Record<string, string> = {
  revenue_payout: "Payout",
  revenue_direct: "Cobro",
  expense_payment: "Pago de gasto",
  card_payment: "Pago de tarjeta",
  debt_disbursement: "Desembolso de préstamo",
  debt_payment: "Pago de deuda",
  tax_payment: "Pago de impuesto",
  owner_contribution: "Aporte del dueño",
  owner_reimbursement: "Reembolso al dueño",
  owner_draw: "Retiro del dueño",
  transfer: "Transferencia",
  fee: "Comisión bancaria",
  interest: "Intereses",
  adjustment: "Ajuste",
};

export { toOptions };
