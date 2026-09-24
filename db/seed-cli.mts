/** Siembra la BD de DATABASE_URL (Neon) si está vacía: `npm run db:seed`. */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
const client = postgres(url, { prepare: false });
const seeded = await seedIfEmpty(drizzle(client, { schema }));
console.log(seeded ? "Base sembrada." : "La base ya tenía datos; no se tocó.");
await client.end();
