import { cn } from "@/lib/utils";

/**
 * Campos de formulario sin estado: funcionan dentro de FormDialog y se pueden renderizar
 * en el servidor. Los <select> son nativos (accesibles y confiables en móvil).
 */

const control =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

type Base = { label: string; name: string; hint?: string; required?: boolean; className?: string };

function Wrap({ label, name, hint, required, className, children }: Base & { children: React.ReactNode }) {
  return (
    <label htmlFor={name} className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextField({
  type = "text",
  defaultValue,
  placeholder,
  ...base
}: Base & { type?: "text" | "email" | "password" | "date" | "number" | "month"; defaultValue?: string | number | null; placeholder?: string }) {
  return (
    <Wrap {...base}>
      <input
        id={base.name}
        name={base.name}
        type={type}
        // Sin step, el navegador solo acepta enteros y rechaza porcentajes como 2.9.
        step={type === "number" ? "any" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        required={base.required}
        className={control}
      />
    </Wrap>
  );
}

/** Monto en dólares/lempiras con 2 decimales. Recibe centavos. */
export function MoneyField({ defaultCents, ...base }: Base & { defaultCents?: number | null }) {
  return (
    <Wrap {...base}>
      <input
        id={base.name}
        name={base.name}
        inputMode="decimal"
        defaultValue={defaultCents !== undefined && defaultCents !== null ? (defaultCents / 100).toFixed(2) : undefined}
        placeholder="0.00"
        required={base.required}
        className={cn(control, "tabular")}
      />
    </Wrap>
  );
}

export type Option = { value: string; label: string; group?: string };

export function SelectField({ options, defaultValue, placeholder, ...base }: Base & { options: Option[]; defaultValue?: string | null; placeholder?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const render = (opts: Option[]) =>
    opts.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  return (
    <Wrap {...base}>
      <select id={base.name} name={base.name} defaultValue={defaultValue ?? ""} required={base.required} className={control}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g} label={g || "Otros"}>
                {render(options.filter((o) => (o.group ?? "") === g))}
              </optgroup>
            ))
          : render(options)}
      </select>
    </Wrap>
  );
}

export function TextareaField({ defaultValue, ...base }: Base & { defaultValue?: string | null }) {
  return (
    <Wrap {...base}>
      <textarea
        id={base.name}
        name={base.name}
        defaultValue={defaultValue ?? undefined}
        rows={2}
        className={cn(control, "h-auto py-2")}
      />
    </Wrap>
  );
}

export function CheckboxField({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
