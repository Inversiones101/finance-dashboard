import { brandIcon } from "@/lib/pwa/brand-icon";

const SIZES = new Set([192, 512]);

/** Íconos del manifest: /pwa-icon/192, /pwa-icon/512 (y ?maskable=1 con margen para Android). */
export async function GET(req: Request, ctx: { params: Promise<{ size: string }> }) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const res = brandIcon(size, { padded: new URL(req.url).searchParams.has("maskable") });
  res.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return res;
}
