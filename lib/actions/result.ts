import { z } from "zod";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: string): ActionResult => ({ ok: false, error });

// ── Parsers de formularios ──────────────────────────────────────────────────
const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export const zText = z.string().trim().min(1, "Campo obligatorio");
export const zOptText = z.preprocess(emptyToNull, z.string().trim().nullable());
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const zOptDate = z.preprocess(emptyToNull, zDate.nullable());
export const zId = z.string().uuid("Selecciona una opción");
export const zOptId = z.preprocess((v) => (v === undefined || v === "" || v === "personal" ? null : v), z.string().uuid().nullable());
/** "1,234.56" → 123456 centavos. */
export const zMoney = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.replace(/[,$\sL]/g, "")) : v),
  z.number({ message: "Monto inválido" }).finite("Monto inválido").nonnegative("El monto no puede ser negativo").transform((n) => Math.round(n * 100))
);
export const zOptMoney = z.preprocess((v) => (v === "" || v === null || v === undefined ? "0" : v), zMoney);
export const zInt = z.preprocess(emptyToNull, z.coerce.number().int().nullable());
export const zCurrency = z.enum(["USD", "HNL"]);
export const zInterval = z.enum(["one_time", "monthly", "quarterly", "annual"]);

/** Valida un FormData contra un esquema y devuelve el primer error en español. */
export function parseForm<T extends z.ZodTypeAny>(schema: T, form: FormData): { data: z.infer<T>; error: null } | { data: null; error: string } {
  const raw = Object.fromEntries(form.entries());
  const r = schema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  const issue = r.error.issues[0];
  const field = issue.path.join(".");
  return { data: null, error: field ? `${field}: ${issue.message}` : issue.message };
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Ocurrió un error inesperado";
}
