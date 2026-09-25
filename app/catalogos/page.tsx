import { asc, eq, isNull } from "drizzle-orm";
import { Check, Plus, Tag } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { CATEGORY_KIND, COUNTERPARTY_TYPE, INTERVAL, INTERVAL_OPTIONS, toOptions } from "@/lib/labels";
import {
  completeReminderAction,
  deleteCategoryAction,
  deleteCounterpartyAction,
  deleteProductAction,
  deleteReminderAction,
  saveCategoryAction,
  saveCounterpartyAction,
  saveProductAction,
  saveReminderAction,
  saveOperationsStartAction,
  setPriceAction,
  saveSkoolFeeAction,
  backfillSkoolFeesAction,
} from "@/lib/actions/catalogs";
import { InlineForm } from "@/components/profile/inline-form";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { priceSchedules } from "@/lib/services/pricing";
import { countSkoolChargesWithoutFee, getSkoolFee } from "@/lib/services/platform-fee";
import type { Tx } from "@/lib/services/ledger";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { CheckboxField, FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";

type Product = typeof s.products.$inferSelect;
type Category = typeof s.categories.$inferSelect;
type Counterparty = typeof s.counterparties.$inferSelect;
type Reminder = typeof s.reminders.$inferSelect;

function ProductFields({ o, d }: { o: FormOptions; d?: Product }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Membresía anual, Curso de Bolsa" />
        <TextField label="Línea de negocio" name="line" defaultValue={d?.line} placeholder="Ej. Comunidad Skool" hint="Agrupa productos en los selectores." />
      </FieldRow>
      <FieldRow>
        <SelectField label="Categoría de ingreso" name="categoryId" options={o.revenueCategories} defaultValue={d?.categoryId} placeholder="Elige…" required />
        <SelectField label="Tipo de cobro habitual" name="defaultBillingInterval" options={INTERVAL_OPTIONS} defaultValue={d?.defaultBillingInterval ?? "one_time"} />
      </FieldRow>
      <TextField label="Plataforma" name="platform" defaultValue={d?.platform} placeholder="Skool, Hotmart, Stripe, directo…" />
      <CheckboxField name="isActive" label="Activo (aparece al registrar ingresos)" defaultChecked={d?.isActive ?? true} />
    </>
  );
}

function CategoryFields({ d }: { d?: Category }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <TextField label="Nombre" name="name" defaultValue={d?.name} required />
      <SelectField label="Tipo" name="kind" options={toOptions(CATEGORY_KIND)} defaultValue={d?.kind ?? "opex"} hint="Costo directo: lo que cuesta entregar el producto (ej. Skool Pro). Opex: el resto de la operación." />
      <CheckboxField name="isTaxDeductible" label="Deducible de impuestos" defaultChecked={d?.isTaxDeductible ?? true} />
    </>
  );
}

function CounterpartyFields({ d }: { d?: Counterparty }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required />
        <SelectField label="Tipo" name="type" options={toOptions(COUNTERPARTY_TYPE)} defaultValue={d?.type ?? "vendor"} />
      </FieldRow>
      <FieldRow>
        <TextField label="Correo" name="email" type="email" defaultValue={d?.email} />
        <TextField label="País (2 letras)" name="country" defaultValue={d?.country} placeholder="US, HN" />
      </FieldRow>
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

function ReminderFields({ d, today }: { d?: Reminder; today: string }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Qué" name="title" defaultValue={d?.title} required placeholder="Ej. EIN (fecha estimada)" />
        <TextField label="Cuándo" name="dueOn" type="date" defaultValue={d?.dueOn ?? today} required />
      </FieldRow>
      <MoneyField label="Monto (opcional)" name="amountCents" defaultCents={d?.amountCents} />
      <TextareaField label="Detalle" name="detail" defaultValue={d?.detail} />
    </>
  );
}

export default async function CatalogosPage() {
  const user = await requirePage("settings");
  const canWrite = can(user.permissions, "settings", "write");
  const canAdmin = can(user.permissions, "settings", "admin");
  const today = todayIn();
  const db = await getDb();
  const [o, reminders, [ops], prices, skoolFee, feeless] = await Promise.all([
    getFormOptions(),
    db.select().from(s.reminders).where(isNull(s.reminders.doneAt)).orderBy(asc(s.reminders.dueOn)),
    db.select().from(s.settings).where(eq(s.settings.key, "operations_start_date")),
    priceSchedules(db as unknown as Tx, today),
    getSkoolFee(db as unknown as Tx),
    countSkoolChargesWithoutFee(db as unknown as Tx),
  ]);
  const operationsStart = typeof ops?.value === "string" ? ops.value : "";
  const addBtn = (label: string) => (
    <Button size="sm">
      <Plus className="size-4" /> {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Catálogos" description="Todo lo que el sistema usa para clasificar. Agregar un producto o una categoría aquí basta: el dashboard y los reportes lo incluyen solos." />

      <Tabs defaultValue="productos">
        <TabsList>
          <TabsTrigger value="productos">Productos</TabsTrigger>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="contactos">Contactos</TabsTrigger>
          <TabsTrigger value="recordatorios">Recordatorios</TabsTrigger>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa">
          <Panel
            title="Inicio de operaciones"
            description="Lo que pagaste de tu bolsillo antes de esta fecha es puesta en marcha: se cubre con tu capital inicial y no cuenta en la operación (utilidad bruta, EBITDA, márgenes ni burn). Desde esta fecha, todo gasto es operativo."
          >
            {canAdmin ? (
              <InlineForm action={saveOperationsStartAction} submitLabel="Guardar">
                <div className="max-w-xs">
                  <TextField label="Fecha de inicio de operaciones" name="operationsStart" type="date" defaultValue={operationsStart} hint="Vacío = todo cuenta como operación." />
                </div>
              </InlineForm>
            ) : (
              <p className="text-sm">{operationsStart ? formatDate(operationsStart) : "Sin definir"}</p>
            )}
          </Panel>
          <Panel
            className="mt-4"
            title="Comisión de Skool"
            description="Lo que Skool descuenta de cada pago. Se aplica a los cobros que entran por Skool (importación y renovaciones) para que el margen bruto sea real."
            actions={
              canAdmin && skoolFee && feeless > 0 ? (
                <ConfirmButton
                  title={`¿Aplicar la comisión a ${feeless} cobros?`}
                  description="Son cobros de Skool registrados sin comisión. Baja tu ingreso neto y el saldo de Skool a lo que realmente recibiste."
                  confirmLabel="Aplicar"
                  action={backfillSkoolFeesAction}
                  trigger={<Button size="sm" variant="outline">Aplicar a {feeless} cobros sin comisión</Button>}
                />
              ) : undefined
            }
          >
            {canAdmin ? (
              <InlineForm action={saveSkoolFeeAction} submitLabel="Guardar">
                <FieldRow>
                  <TextField label="Porcentaje por cobro" name="pct" type="number" defaultValue={skoolFee?.pct} hint="Ej. 2.9. Vacío = sin comisión." />
                  <MoneyField label="Monto fijo por cobro" name="fixedCents" defaultCents={skoolFee?.fixedCents} hint="Ej. 0.30" />
                </FieldRow>
              </InlineForm>
            ) : (
              <p className="text-sm">{skoolFee ? `${skoolFee.pct}% + ${formatMoney(skoolFee.fixedCents)}` : "Sin definir"}</p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="productos">
          <Panel
            title="Productos y líneas de ingreso"
            description="Cada forma de cobrar: membresías, cursos, consultorías…"
            actions={canWrite && <FormDialog title="Nuevo producto" action={saveProductAction} wide trigger={addBtn("Producto")}><ProductFields o={o} /></FormDialog>}
          >
            {o.products.length === 0 ? (
              <Empty>Sin productos.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Línea</TableHead>
                    <TableHead>Cobro</TableHead>
                    <TableHead>Precio de lista</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.name} {!p.isActive && <StatusBadge label="Inactivo" />}
                      </TableCell>
                      <TableCell>{p.line ?? "—"}</TableCell>
                      <TableCell>{INTERVAL[p.defaultBillingInterval]}</TableCell>
                      <TableCell>
                        {(() => {
                          const sch = prices.get(p.id);
                          return (
                            <>
                              <p className="font-medium tabular">{sch?.current != null ? formatMoney(sch.current) : "—"}</p>
                              {sch?.next && (
                                <p className="text-xs text-warning">
                                  {formatMoney(sch.next.priceCents)} desde {formatDate(sch.next.from)}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </TableCell>
                      <TableCell>{o.names.category.get(p.categoryId)}</TableCell>
                      <TableCell>
                        <RowActions
                          canEdit={canWrite}
                          canDelete={canAdmin}
                          wide
                          editTitle="Editar producto"
                          editAction={saveProductAction}
                          editFields={<ProductFields o={o} d={p} />}
                          deleteAction={deleteProductAction.bind(null, p.id)}
                          deleteLabel={p.name}
                          extra={
                            canWrite ? (
                              <FormDialog
                                title={`Precio de ${p.name}`}
                                description="El nuevo precio aplica a quien entre desde esa fecha. Los miembros actuales conservan el precio que pagan."
                                action={setPriceAction}
                                submitLabel="Guardar precio"
                                trigger={
                                  <Button variant="ghost" size="icon" className="size-8" aria-label="Cambiar precio" title="Cambiar precio">
                                    <Tag className="size-3.5" />
                                  </Button>
                                }
                              >
                                <Hidden name="productId" value={p.id} />
                                <FieldRow>
                                  <MoneyField label="Nuevo precio" name="priceCents" defaultCents={prices.get(p.id)?.current} required />
                                  <TextField label="Vigente desde" name="effectiveFrom" type="date" defaultValue={today} required hint="Puede ser futura: el día del lanzamiento." />
                                </FieldRow>
                                <TextField label="Nota" name="note" placeholder="Ej. Lanzamiento de noviembre" />
                                {(prices.get(p.id)?.history.length ?? 0) > 0 && (
                                  <div>
                                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Historial</p>
                                    <ul className="divide-y rounded-xl border text-sm">
                                      {prices
                                        .get(p.id)!
                                        .history.slice()
                                        .reverse()
                                        .map((h) => (
                                          <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                                            <span className="font-medium tabular">{formatMoney(h.priceCents)}</span>
                                            <span className="text-xs text-muted-foreground">
                                              {h.from <= "2000-01-01" ? "Precio inicial" : `desde ${formatDate(h.from)}`}
                                              {h.note && h.from > "2000-01-01" ? ` · ${h.note}` : ""}
                                            </span>
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                )}
                              </FormDialog>
                            ) : null
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="categorias">
          <Panel title="Categorías" description="Ingresos, costos directos y gastos operativos." actions={canWrite && <FormDialog title="Nueva categoría" action={saveCategoryAction} trigger={addBtn("Categoría")}><CategoryFields /></FormDialog>}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Deducible</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...o.categories]
                  .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
                  .map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: c.kind === "revenue" ? "var(--money-net)" : "var(--money-out)" }} />
                        {c.name}
                      </TableCell>
                      <TableCell>{CATEGORY_KIND[c.kind]}</TableCell>
                      <TableCell>{c.isTaxDeductible ? "Sí" : "No"}</TableCell>
                      <TableCell>
                        <RowActions canEdit={canWrite} canDelete={canAdmin} editTitle="Editar categoría" editAction={saveCategoryAction} editFields={<CategoryFields d={c} />} deleteAction={deleteCategoryAction.bind(null, c.id)} deleteLabel={c.name} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Panel>
        </TabsContent>

        <TabsContent value="contactos">
          <Panel title="Contactos" description="Proveedores, acreedores, autoridades fiscales y plataformas." actions={canWrite && <FormDialog title="Nuevo contacto" action={saveCounterpartyAction} wide trigger={addBtn("Contacto")}><CounterpartyFields /></FormDialog>}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.counterparties.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.name}
                      {c.notes && <p className="text-xs font-normal text-muted-foreground">{c.notes}</p>}
                    </TableCell>
                    <TableCell>{COUNTERPARTY_TYPE[c.type]}</TableCell>
                    <TableCell>{c.country ?? "—"}</TableCell>
                    <TableCell>
                      <RowActions canEdit={canWrite} canDelete={canAdmin} wide editTitle="Editar contacto" editAction={saveCounterpartyAction} editFields={<CounterpartyFields d={c} />} deleteAction={deleteCounterpartyAction.bind(null, c.id)} deleteLabel={c.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </TabsContent>

        <TabsContent value="recordatorios">
          <Panel title="Recordatorios" description="Hitos que aparecen en “Próximos movimientos” del dashboard." actions={canWrite && <FormDialog title="Nuevo recordatorio" action={saveReminderAction} trigger={addBtn("Recordatorio")}><ReminderFields today={today} /></FormDialog>}>
            {reminders.length === 0 ? (
              <Empty>Sin recordatorios pendientes.</Empty>
            ) : (
              <Table>
                <TableBody>
                  {reminders.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="w-32 text-muted-foreground">{formatDate(r.dueOn)}</TableCell>
                      <TableCell>
                        <p className="font-medium">{r.title}</p>
                        {r.detail && <p className="text-xs text-muted-foreground">{r.detail}</p>}
                      </TableCell>
                      <TableCell className="text-right tabular">{r.amountCents ? formatMoney(r.amountCents) : ""}</TableCell>
                      <TableCell className="w-28">
                        <RowActions
                          canEdit={canWrite}
                          editTitle="Editar recordatorio"
                          editAction={saveReminderAction}
                          editFields={<ReminderFields d={r} today={today} />}
                          deleteAction={deleteReminderAction.bind(null, r.id)}
                          deleteLabel="este recordatorio"
                          extra={
                            canWrite ? (
                              <ConfirmButton
                                title="¿Marcar como hecho?"
                                action={completeReminderAction.bind(null, r.id)}
                                confirmLabel="Hecho"
                                trigger={<Button variant="ghost" size="icon" className="size-8" aria-label="Marcar como hecho" title="Hecho"><Check className="size-3.5" /></Button>}
                              />
                            ) : null
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
