import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { MODULE_LABELS, MODULES, can } from "@/lib/auth/permissions";
import { ASSISTANT_TOOLS, runTool, type Proposal } from "@/lib/assistant/tools";
import { BRAND } from "@/lib/config";
import { todayIn } from "@/lib/today";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-5";
const MAX_TURNS = 8;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40),
});

const SYSTEM = `Eres el asistente financiero dentro del sistema de ${BRAND.company} (marca ${BRAND.name}), una LLC de Wyoming con una comunidad de educación financiera en Skool.

Cómo trabajas:
- Responde en español, breve y claro. Montos en USD salvo que se pida otra cosa.
- Antes de dar cualquier número, consulta las herramientas de lectura; no inventes cifras.
- Para cambiar algo (registrar un gasto o ingreso, dar de baja o reactivar un miembro, crear recordatorios, presupuestos o metas, clasificar movimientos bancarios) usa las herramientas "proponer_*". Una propuesta NO aplica nada: el usuario la confirma con un botón. Nunca digas que algo quedó registrado; di que está listo para confirmar.
- Si te faltan datos para una propuesta (monto, fecha, categoría, con qué se pagó), pregúntalos o consulta "catalogos" para obtener los ids.
- Reglas contables del sistema: la caja son solo los bancos de la LLC (Mercury); el saldo de Skool es facturación por cobrar que solo sale por payout; lo que el dueño paga con dinero personal es un aporte de capital. No hables de cuentas o tarjetas personales del dueño.
- Cuando te pidan consejo, basa tus sugerencias en las métricas (margen, burn, churn, MRR, presupuestos, metas). No des asesoría de inversión personalizada ni fiscal definitiva: sugiere confirmar con su contador.`;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "El asistente aún no está configurado: falta la variable ANTHROPIC_API_KEY en Vercel." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Mensaje inválido." }, { status: 400 });

  const allowed = MODULES.filter((m) => m !== "owner_equity" && can(user.permissions, m)).map((m) => `${MODULE_LABELS[m]}${can(user.permissions, m, "write") ? " (puede editar)" : " (solo ver)"}`);
  const context = `Hoy es ${todayIn()}. Usuario: ${user.name}${user.title ? `, ${user.title}` : ""}. Acceso: ${allowed.join(", ")}.`;

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = parsed.data.messages.map((m) => ({ role: m.role, content: m.content }));
  const proposals: Proposal[] = [];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: context },
        ],
        tools: ASSISTANT_TOOLS,
        messages,
      });

      if (response.stop_reason === "refusal") {
        return Response.json({ reply: "No puedo ayudar con esa solicitud. Intenta reformularla.", proposals });
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      if (response.stop_reason !== "tool_use") {
        return Response.json({ reply: text || (proposals.length ? "Listo, revisa la propuesta." : "…"), proposals });
      }

      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(
        toolUses.map(async (t) => {
          try {
            const r = await runTool(t.name, t.input, user);
            if (r.proposal) proposals.push(r.proposal);
            return { type: "tool_result" as const, tool_use_id: t.id, content: r.result, is_error: r.isError };
          } catch (e) {
            return { type: "tool_result" as const, tool_use_id: t.id, content: `Error: ${e instanceof Error ? e.message : "desconocido"}`, is_error: true };
          }
        })
      );
      messages.push({ role: "user", content: results });
    }
    return Response.json({ reply: "Me tomó demasiados pasos. ¿Puedes hacer la pregunta más específica?", proposals });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "El asistente está ocupado; intenta en un momento." }, { status: 429 });
    if (e instanceof Anthropic.AuthenticationError) return Response.json({ error: "La clave de la API de Anthropic no es válida." }, { status: 503 });
    if (e instanceof Anthropic.APIError) return Response.json({ error: `Error del asistente (${e.status ?? "red"}).` }, { status: 502 });
    throw e;
  }
}
