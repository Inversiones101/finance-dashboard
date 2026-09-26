import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { authorize } from "@/lib/auth/session";
import { readAttachment } from "@/lib/services/attachments";

/** Muestra un recibo (privado) solo a quien puede ver Gastos. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user } = await authorize("expenses", "read");
  if (!user) return new Response("No autorizado", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const db = await getDb();
  const [row] = await db.select().from(s.expenseAttachments).where(eq(s.expenseAttachments.id, id));
  if (!row) return new Response("No encontrado", { status: 404 });
  const stream = await readAttachment(row.blobPath);
  if (!stream) return new Response("El archivo ya no existe", { status: 404 });
  return new Response(stream, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
