"use server";

import { getDb } from "@/db/client";
import { authorize } from "@/lib/auth/session";
import type { ImportPlan } from "@/lib/import/skool-csv";
import type { Tx } from "@/lib/services/ledger";
import { applySkoolImport, previewSkoolImport } from "@/lib/services/skool-import";
import { todayIn } from "@/lib/today";
import { mutate } from "./mutate";
import { errorMessage, fail, type ActionResult } from "./result";

const MAX_BYTES = 2_000_000;

/** Solo lee: devuelve lo que cambiaría, para que el usuario lo revise antes de aplicar. */
export async function previewSkoolImportAction(csv: string): Promise<{ plan: ImportPlan; error: null } | { plan: null; error: string }> {
  const { user, error } = await authorize("revenue", "write");
  if (!user) return { plan: null, error };
  if (csv.length > MAX_BYTES) return { plan: null, error: "El archivo es demasiado grande." };
  try {
    const db = await getDb();
    return { plan: await previewSkoolImport(db as unknown as Tx, csv, todayIn()), error: null };
  } catch (e) {
    return { plan: null, error: errorMessage(e) };
  }
}

export async function applySkoolImportAction(csv: string): Promise<ActionResult> {
  if (csv.length > MAX_BYTES) return fail("El archivo es demasiado grande.");
  return mutate("revenue", "write", "members", "import_skool", async (tx, userId) => {
    const c = await applySkoolImport(tx, csv, todayIn(), userId);
    const parts = [
      c.new && `${c.new} nuevos`,
      c.update && `${c.update} actualizados`,
      c.reactivate && `${c.reactivate} reactivados`,
      c.cancel && `${c.cancel} bajas`,
      c.charges && `${c.charges} cobros registrados`,
    ].filter(Boolean);
    return { message: parts.length ? `Importado: ${parts.join(", ")}` : "Todo estaba al día", diff: c };
  });
}
