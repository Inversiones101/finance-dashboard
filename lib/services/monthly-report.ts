/**
 * Informe mensual redactado por Claude a partir de los números del mes (report-facts). Salida
 * estructurada (JSON con esquema) para mostrarlo con el diseño de la app y sin inventar cifras.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { ReportFacts } from "@/lib/finance/report-facts";
import type { Tx } from "./ledger";

export const REPORT_MODEL = "claude-opus-5";

export const ReportSchema = z.object({
  titular: z.string(),
  resumen: z.string(),
  secciones: z.array(z.object({ titulo: z.string(), contenido: z.string(), puntos: z.array(z.string()) })),
  vigilar: z.array(z.string()),
  proximos_pasos: z.array(z.string()),
});
export type MonthlyReport = z.infer<typeof ReportSchema>;

// Esquema JSON para la salida estructurada (objetos cerrados, todos los campos requeridos).
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titular", "resumen", "secciones", "vigilar", "proximos_pasos"],
  properties: {
    titular: { type: "string", description: "Una línea que resume el mes." },
    resumen: { type: "string", description: "Dos o tres frases: lo más importante del mes." },
    secciones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "contenido", "puntos"],
        properties: { titulo: { type: "string" }, contenido: { type: "string" }, puntos: { type: "array", items: { type: "string" } } },
      },
    },
    vigilar: { type: "array", items: { type: "string" }, description: "Riesgos o señales a vigilar el próximo mes." },
    proximos_pasos: { type: "array", items: { type: "string" }, description: "Acciones concretas recomendadas." },
  },
} as const;

const SYSTEM = `Eres el analista financiero de una LLC que opera una comunidad de pago en Skool. Escribes el informe mensual para el fundador, en español, con el tono de una carta a inversionistas: claro, directo y honesto.

Reglas:
- Usa solo los números del JSON que recibes. No inventes cifras, fechas, ni causas que los datos no respalden; si algo no se puede saber con los datos, dilo.
- Montos en dólares con formato $1,234.56. Porcentajes con un decimal cuando ayude.
- "Puesta en marcha" es capital inicial del dueño gastado antes de operar: no es gasto de la operación; no lo presentes como pérdida operativa.
- El saldo en Skool es dinero por cobrar (llega por payout), no caja.
- Si "churn_es_supuesto" es verdadero, aclara que el churn aún no se ha medido.
- Si el mes no está completo ("mes_completo": false), dilo en el resumen y no compares como si lo estuviera.
- Secciones sugeridas (omite las que no tengan datos): Resultados, Comunidad y MRR, Caja y liquidez, Gastos. Dos a cuatro puntos concretos por sección.
- "vigilar": 2 a 4 señales de riesgo reales según los datos. "proximos_pasos": 2 a 4 acciones concretas y alcanzables.
- No des asesoría legal ni fiscal; si algo toca impuestos, sugiere confirmarlo con el contador.`;

export async function generateMonthlyReport(tx: Tx, facts: ReportFacts, userId: string | null) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en Vercel.");
  const client = new Anthropic();
  const response = await client.beta.messages
    .create({
    model: REPORT_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: JSON_SCHEMA } }, // medium: cabe en los 60 s de Vercel
    system: SYSTEM,
    messages: [{ role: "user", content: `Números del mes (JSON):\n\n${JSON.stringify(facts, null, 1)}\n\nRedacta el informe de ${facts.mes}.` }],
    })
    .catch((e: unknown) => {
      if (e instanceof Anthropic.RateLimitError) throw new Error("El servicio de IA está ocupado; intenta en un momento.");
      if (e instanceof Anthropic.AuthenticationError) throw new Error("La clave de Anthropic no es válida.");
      if (e instanceof Anthropic.APIConnectionError) throw new Error("No se pudo conectar con el servicio de IA.");
      if (e instanceof Anthropic.APIError) throw new Error(`Error del servicio de IA (${e.status ?? "red"}).`);
      throw e;
    });
  if (response.stop_reason === "refusal") throw new Error("El modelo no pudo redactar el informe. Intenta de nuevo.");
  if (response.stop_reason === "max_tokens") throw new Error("El informe quedó incompleto. Intenta de nuevo.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = ReportSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("La respuesta del modelo no tuvo el formato esperado. Intenta de nuevo.");

  const values = { content: parsed.data, facts, model: response.model, createdBy: userId, updatedAt: new Date() };
  await tx
    .insert(s.monthlyReports)
    .values({ month: facts.mes, ...values })
    .onConflictDoUpdate({ target: s.monthlyReports.month, set: values });
  return parsed.data;
}

export async function getMonthlyReport(tx: Tx, month: string) {
  const [row] = await tx.select().from(s.monthlyReports).where(eq(s.monthlyReports.month, month));
  return row ? { ...row, content: ReportSchema.parse(row.content) } : null;
}
