import "server-only";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { authorize } from "@/lib/auth/session";
import type { Level, Module } from "@/lib/auth/permissions";
import { audit, type Tx } from "@/lib/services/ledger";
import { errorMessage, fail, ok, type ActionResult } from "./result";

/**
 * Envoltura común de toda escritura: verifica permiso en el servidor, corre en una transacción,
 * deja rastro en la bitácora y refresca las pantallas.
 */
export async function mutate(
  module: Module,
  level: Level,
  entity: string,
  action: "create" | "update" | "delete" | string,
  fn: (tx: Tx, userId: string) => Promise<{ id?: string | null; message?: string; diff?: unknown } | void>
): Promise<ActionResult> {
  const { user, error } = await authorize(module, level);
  if (!user) return fail(error);
  try {
    const db = await getDb();
    const result = await db.transaction(async (t) => {
      const tx = t as unknown as Tx;
      const r = (await fn(tx, user.id)) ?? {};
      await audit(tx, user.id, action, entity, r.id ?? null, r.diff);
      return r;
    });
    revalidatePath("/", "layout");
    return ok(result.message);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export const checkbox = (form: FormData, name: string) => form.get(name) === "on";
