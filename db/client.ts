import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Conexión a la base de datos.
 *  - Con DATABASE_URL (Neon en producción) → Postgres real.
 *  - Sin DATABASE_URL (desarrollo local) → PGlite: Postgres embebido en un archivo local,
 *    fuera de iCloud para que la sincronización no lo corrompa. Se migra y se siembra solo.
 */
export type DB = ReturnType<typeof drizzlePostgres<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzlePostgres(postgres(url, { prepare: false }), { schema });
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(os.homedir(), ".inversiones101", "pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });

  const { seedIfEmpty } = await import("./seed");
  // Los dos drivers exponen la misma API de consultas de Drizzle.
  const typed = db as unknown as DB;
  await seedIfEmpty(typed);
  return typed;
}

export function getDb(): Promise<DB> {
  globalForDb.__db ??= connect().catch((err) => {
    globalForDb.__db = undefined; // reintentar en la próxima petición
    throw err;
  });
  return globalForDb.__db;
}
