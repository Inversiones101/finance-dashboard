"use client";

import { useState } from "react";
import { FieldRow, SelectField, type Option } from "@/components/crud/fields";

const IN: Option[] = [
  { value: "owner_contribution", label: "Depósito o aporte de capital del dueño" },
  { value: "revenue", label: "Ingreso por ventas" },
  { value: "other_income", label: "Cashback o intereses" },
];
const OUT: Option[] = [
  { value: "expense", label: "Gasto de la LLC" },
  { value: "owner_draw", label: "Retiro del dueño" },
  { value: "bank_fee", label: "Comisión bancaria" },
];
const HINT: Record<string, string> = {
  owner_contribution: "Dinero tuyo que entra a la LLC (depósito inicial, fondeo). Suma a tu capital; no es ingreso.",
  revenue: "Ventas: aparece en Ingresos y en el estado de resultados.",
  other_income: "Otros ingresos: cashback de la tarjeta o intereses del banco.",
  expense: "Aparece en Gastos con la categoría que elijas.",
  owner_draw: "Dinero que sacas de la LLC para ti. Reduce tu capital.",
  bank_fee: "Comisiones del banco: gasto operativo.",
  adjustment: "Déjalo como ajuste solo si es una diferencia de conciliación.",
  payout: "Dinero que Skool te pasa al banco: baja el saldo de Skool y sube el del banco. No es ingreso nuevo (ya se contó al cobrar).",
  match: "Ya lo registraste a mano: solo se enlaza con el banco, sin duplicarlo.",
  transfer: "Movimiento entre tus propias cuentas: no es ingreso ni gasto.",
  ignore: "No se registra en los libros (ej. un duplicado o algo ya contado de otra forma).",
};

/**
 * Qué es un movimiento del banco. `direction` fija si entra o sale (al clasificar uno existente);
 * sin él (movimiento nuevo) se muestran todas las opciones.
 */
export function ClassifyFields({
  products,
  categories,
  direction,
  extra = [],
  defaults,
}: {
  products: Option[];
  categories: Option[];
  direction?: "in" | "out";
  /** Opciones adicionales al inicio (bandeja del banco: payout, ya registrado, transferencia, ignorar). */
  extra?: Option[];
  defaults?: { as?: string | null; categoryId?: string | null; productId?: string | null };
}) {
  const base = direction === "in" ? IN : direction === "out" ? OUT : [...IN, ...OUT];
  const options = [...extra, ...base];
  const [as, setAs] = useState(defaults?.as && options.some((o) => o.value === defaults.as) ? defaults.as : options[0].value);
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          ¿Qué es este movimiento?<span className="text-danger"> *</span>
        </span>
        <select
          name="as"
          value={as}
          onChange={(e) => setAs(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {direction ? (
            options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ) : (
            <>
              <optgroup label="Entra dinero">
                {IN.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Sale dinero">
                {OUT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>
        <span className="text-xs text-muted-foreground">{HINT[as]}</span>
      </label>
      {(as === "revenue" || as === "expense") && (
        <FieldRow>
          {as === "revenue" ? (
            <SelectField label="Producto" name="productId" options={products} placeholder="Otros ingresos" defaultValue={defaults?.productId} />
          ) : (
            <SelectField label="Categoría del gasto" name="categoryId" options={categories} placeholder="Elige…" required defaultValue={defaults?.categoryId} />
          )}
        </FieldRow>
      )}
    </>
  );
}
