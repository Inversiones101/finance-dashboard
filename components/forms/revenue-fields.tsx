import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";
import type { FormOptions } from "@/lib/data/options";
import { CURRENCY_OPTIONS, INTERVAL_OPTIONS, REVENUE_STATUS, toOptions } from "@/lib/labels";

type RevenueDefaults = Partial<{
  id: string;
  revenueDate: string;
  productId: string | null;
  categoryId: string;
  customerName: string | null;
  billingInterval: string;
  serviceStart: string | null;
  currency: string;
  grossCents: number;
  processorFeeCents: number;
  affiliateFeeCents: number;
  status: string;
  depositAccountId: string | null;
  notes: string | null;
}>;

export function RevenueFields({ o, d = {}, today, defaultDeposit }: { o: FormOptions; d?: RevenueDefaults; today: string; defaultDeposit?: string }) {
  return (
    <>
      {d.id && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <SelectField label="Producto" name="productId" options={o.productOptions} defaultValue={d.productId} placeholder="(sin producto)" hint="Define la categoría automáticamente." />
        <SelectField label="Categoría" name="categoryId" options={o.revenueCategories} defaultValue={d.productId ? "" : d.categoryId} placeholder="(según el producto)" />
      </FieldRow>
      <FieldRow>
        <TextField label="Fecha del cobro" name="revenueDate" type="date" defaultValue={d.revenueDate ?? today} required />
        <SelectField label="Tipo de cobro" name="billingInterval" options={INTERVAL_OPTIONS} defaultValue={d.billingInterval ?? "monthly"} hint="Mensual/anual suman al MRR." />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Monto bruto (facturado)" name="grossCents" defaultCents={d.grossCents} required />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d.currency ?? "USD"} />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Comisión de la plataforma" name="processorFeeCents" defaultCents={d.processorFeeCents} hint="Skool, Stripe…" />
        <MoneyField label="Comisión de afiliados" name="affiliateFeeCents" defaultCents={d.affiliateFeeCents} />
      </FieldRow>
      <FieldRow>
        <SelectField
          label="¿Dónde cayó el dinero?"
          name="depositAccountId"
          options={o.depositAccounts}
          defaultValue={d.id ? o.depositValue(d.depositAccountId) : defaultDeposit}
          placeholder="(aún no se cobra)"
          hint="Skool: queda por cobrar hasta el payout. Al dueño ⇒ retiro del dueño."
        />
        <SelectField label="Estado" name="status" options={toOptions(REVENUE_STATUS)} defaultValue={d.status ?? "available"} />
      </FieldRow>
      <FieldRow>
        <TextField label="Cliente" name="customerName" defaultValue={d.customerName} placeholder="(opcional)" />
        <TextField label="Inicio del servicio" name="serviceStart" type="date" defaultValue={d.serviceStart} hint="Para repartir el anual en el MRR. Vacío = fecha del cobro." />
      </FieldRow>
      <TextareaField label="Notas" name="notes" defaultValue={d.notes} />
    </>
  );
}
