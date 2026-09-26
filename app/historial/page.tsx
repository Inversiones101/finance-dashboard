import Link from "next/link";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { History } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { PageHeader, Panel, Empty } from "@/components/crud/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE = 100;

/** Nombres legibles de lo que registra la bitácora. */
const ENTITY: Record<string, string> = {
  expenses: "Gasto",
  revenues: "Ingreso",
  members: "Miembro",
  cash_movements: "Movimiento bancario",
  bank_inbox: "Bandeja de Mercury",
  financial_accounts: "Cuenta",
  subscriptions: "Suscripción",
  vendor_contracts: "Contrato",
  debts: "Deuda",
  debt_payments: "Pago de deuda",
  tax_obligations: "Impuesto",
  owner_ledger: "Aporte del dueño",
  products: "Producto",
  product_prices: "Precio",
  categories: "Categoría",
  counterparties: "Contacto",
  reminders: "Recordatorio",
  budgets: "Presupuesto",
  goals: "Meta",
  settings: "Configuración",
  users: "Usuario",
  roles: "Rol",
  sessions: "Sesión",
  books: "Cierre de mes",
  attachments: "Recibo",
  backups: "Respaldo",
};
const ACTION: Record<string, string> = {
  create: "Creó",
  update: "Editó",
  delete: "Borró",
  login: "Inició sesión",
  login_recovery_code: "Entró con código de recuperación",
  enable_2fa: "Activó dos pasos",
  disable_2fa: "Desactivó dos pasos",
  regenerate_recovery_codes: "Generó códigos de recuperación",
  revoke_session: "Cerró una sesión",
  revoke_other_sessions: "Cerró las demás sesiones",
  close_month: "Cerró el mes",
  reopen_month: "Reabrió el mes",
  sync: "Sincronizó",
  sync_cron: "Sincronización automática",
  resolve: "Clasificó",
  accept_all: "Aceptó sugerencias",
  import_skool: "Importó CSV de Skool",
  classify: "Clasificó",
  cancel: "Dio de baja",
  reactivate: "Reactivó",
  charge: "Registró cobro",
  backfill_fees: "Aplicó comisiones",
  save_scenario: "Guardó escenario",
  delete_scenario: "Borró escenario",
  upload: "Subió",
  backup: "Respaldo",
};

function detail(diff: unknown) {
  if (!diff || typeof diff !== "object") return "";
  const entries = Object.entries(diff as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(" · ");
}

export default async function HistorialPage({ searchParams }: PageProps<"/historial">) {
  await requirePage("users", "admin");
  const { quien, que, pagina } = await searchParams;
  const page = Math.max(0, Number(pagina) || 0);
  const db = await getDb();
  const where: SQL[] = [];
  if (typeof quien === "string" && quien) where.push(eq(s.auditLog.userId, quien));
  if (typeof que === "string" && que) where.push(eq(s.auditLog.entity, que));

  const [rows, people] = await Promise.all([
    db
      .select({ log: s.auditLog, name: s.users.name })
      .from(s.auditLog)
      .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.auditLog.createdAt))
      .limit(PAGE + 1)
      .offset(page * PAGE),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users),
  ]);
  const more = rows.length > PAGE;
  const href = (p: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const merged = { quien, que, pagina: undefined, ...p } as Record<string, unknown>;
    for (const [k, v] of Object.entries(merged)) if (typeof v === "string" ? v : typeof v === "number" && v > 0) q.set(k, String(v));
    return `/historial${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Historial de cambios" description="Quién hizo qué y cuándo: cada registro, edición, borrado, inicio de sesión y cierre de mes queda aquí. No se puede modificar." />

      <Panel
        actions={<History className="size-4 text-muted-foreground" />}
        title="Bitácora"
        description={`Mostrando ${Math.min(rows.length, PAGE)} registros${page ? ` (página ${page + 1})` : ""}.`}
      >
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link href={href({ quien: undefined })} className={cn("rounded-full border px-3 py-1", !quien && "bg-surface-2 font-medium")}>
            Todos
          </Link>
          {people.map((p) => (
            <Link key={p.id} href={href({ quien: p.id })} className={cn("rounded-full border px-3 py-1", quien === p.id && "bg-surface-2 font-medium")}>
              {p.name}
            </Link>
          ))}
          <span className="mx-1 w-px bg-border" />
          {["expenses", "revenues", "members", "cash_movements", "users", "books"].map((e) => (
            <Link key={e} href={href({ que: que === e ? undefined : e })} className={cn("rounded-full border px-3 py-1", que === e && "bg-surface-2 font-medium")}>
              {ENTITY[e]}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <Empty>Sin registros con estos filtros.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Cuándo</TableHead>
                  <TableHead>Quién</TableHead>
                  <TableHead>Qué</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, PAGE).map(({ log, name }) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular">
                      {log.createdAt.toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tegucigalpa" })}
                    </TableCell>
                    <TableCell className="text-sm">{name ?? (log.userId ? "Usuario eliminado" : "Sistema")}</TableCell>
                    <TableCell className="text-sm">
                      {ACTION[log.action] ?? log.action} <span className="text-muted-foreground">· {ENTITY[log.entity] ?? log.entity}</span>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{detail(log.diff)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {(page > 0 || more) && (
          <div className="mt-3 flex justify-between text-sm">
            {page > 0 ? <Link href={href({ pagina: page - 1 })}>← Más recientes</Link> : <span />}
            {more && <Link href={href({ pagina: page + 1 })}>Más antiguos →</Link>}
          </div>
        )}
      </Panel>
    </div>
  );
}
