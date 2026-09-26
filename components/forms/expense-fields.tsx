import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";
import type { FormOptions } from "@/lib/data/options";
import { CURRENCY_OPTIONS, INTERVAL_OPTIONS } from "@/lib/labels";

type ExpenseDefaults = Partial<{
  id: string;
  expenseDate: string;
  description: string;
  categoryId: string;
  vendorId: string | null;
  frequency: string;
  currency: string;
  amountCents: number;
  paymentAccountId: string | null;
  fundingSource: string;
  status: string;
  dueDate: string | null;
  paidOn: string | null;
  subscriptionId: string | null;
  contractId: string | null;
  productId: string | null;
  notes: string | null;
}>;

export function ExpenseFields({ o, d = {}, today }: { o: FormOptions; d?: ExpenseDefaults; today: string }) {
  // Un gasto guardado sin cuenta pero pagado por el dueño se muestra como "Otra cuenta personal".
  const account = d.id ? o.paymentValue(d.paymentAccountId) : undefined;
  return (
    <>
      {d.id && <Hidden name="id" value={d.id} />}
      {d.subscriptionId && <Hidden name="subscriptionId" value={d.subscriptionId} />}
      {d.contractId && <Hidden name="contractId" value={d.contractId} />}
      <TextField label="Descripción" name="description" defaultValue={d.description} required placeholder="Ej. Loom, diseño de portada…" />
      <FieldRow>
        <TextField label="Fecha del cargo" name="expenseDate" type="date" defaultValue={d.expenseDate ?? today} required />
        <SelectField label="Categoría" name="categoryId" options={o.expenseCategories} defaultValue={d.categoryId} placeholder="Elige…" required />
      </FieldRow>
      <SelectField
        label="¿De qué producto?"
        name="productId"
        options={o.productOptions}
        defaultValue={d.productId}
        placeholder="General (no es de un producto)"
        hint="Opcional. Ej. publicidad de un curso. Sirve para ver la rentabilidad de cada producto en Reportes."
      />
      <FieldRow>
        <MoneyField label="Monto" name="amountCents" defaultCents={d.amountCents} required />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d.currency ?? "USD"} />
      </FieldRow>
      <SelectField
        label="¿Con qué se pagó?"
        name="paymentAccountId"
        options={o.paymentAccounts}
        defaultValue={account}
        placeholder="Elige…"
        required
        hint="Aporte del dueño ⇒ no sale de la caja de la LLC. Mercury IO ⇒ queda por pagar hasta pagar la tarjeta."
      />
      <FieldRow>
        <SelectField
          label="Estado"
          name="status"
          options={[
            { value: "paid", label: "Pagado" },
            { value: "pending", label: "Por pagar (tarjeta o factura de la LLC)" },
          ]}
          defaultValue={d.status === "pending" ? "pending" : "paid"}
        />
        <TextField label="Vence el" name="dueDate" type="date" defaultValue={d.dueDate} hint="Solo para lo que la LLC aún debe. Vacío = día de pago de la tarjeta." />
      </FieldRow>
      <FieldRow>
        <SelectField label="Frecuencia" name="frequency" options={INTERVAL_OPTIONS} defaultValue={d.frequency ?? "one_time"} />
        <SelectField label="Proveedor" name="vendorId" options={o.vendorOptions} defaultValue={d.vendorId} placeholder="(opcional)" />
      </FieldRow>
      <TextareaField label="Notas" name="notes" defaultValue={d.notes} />
    </>
  );
}
