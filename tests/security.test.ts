import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { base32Decode, base32Encode, currentStep, decryptSecret, encryptSecret, totpCode, verifyTotp } from "@/lib/auth/totp";
import type { Tx } from "@/lib/services/ledger";
import { beginTotpSetup, checkSecondFactor, confirmTotpSetup, isThrottled, MAX_FAILS_PER_EMAIL, recordAttempt } from "@/lib/services/security";
import { buildBackup } from "@/lib/services/backup";

beforeAll(() => {
  process.env.APP_SECRET = "x".repeat(40);
});

describe("TOTP", () => {
  it("coincide con el vector de prueba del RFC 6238", () => {
    // Secreto "12345678901234567890", T = 59 s → paso 1 → 94287082 (8 dígitos) → 287082 (6).
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 1)).toBe("287082");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("acepta ±30 s de desfase y no deja reusar el mismo código", () => {
    const secret = base32Encode(Buffer.from("abcdefghijabcdefghij"));
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    const step = currentStep(now);
    expect(verifyTotp(secret, totpCode(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 3), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, "12345", { nowMs: now })).toBeNull();
  });

  it("el secreto se guarda cifrado y se recupera igual", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
  });
});

describe("acceso", () => {
  let db: Tx;
  let userId: string;

  beforeEach(async () => {
    const d = drizzle(new PGlite(), { schema: s });
    await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
    await seed(d);
    db = d as unknown as Tx;
    const [role] = await db.select().from(s.roles).limit(1);
    [{ id: userId }] = await db.insert(s.users).values({ name: "Ana", email: "ana@x.com", passwordHash: "x", roleId: role.id }).returning({ id: s.users.id });
  });

  it("bloquea tras 5 intentos fallidos y lo cuenta en la base (no en memoria)", async () => {
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
      expect(await isThrottled(db, "ana@x.com", "1.1.1.1")).toBe(false);
      await recordAttempt(db, "ana@x.com", "1.1.1.1", false);
    }
    expect(await isThrottled(db, "ana@x.com", "1.1.1.1")).toBe(true);
    expect(await isThrottled(db, "otro@x.com", "2.2.2.2")).toBe(false);
  });

  it("activación, código de la app y códigos de recuperación de un solo uso", async () => {
    const secret = await beginTotpSetup(db, userId);
    await expect(confirmTotpSetup(db, userId, "000000")).rejects.toThrow(/no coincide/);
    const codes = await confirmTotpSetup(db, userId, totpCode(secret, currentStep()));
    expect(codes).toHaveLength(8);

    const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
    expect(u.totpEnabledAt).not.toBeNull();
    expect(JSON.stringify(u)).not.toContain(codes[0]); // solo se guarda el hash

    // El mismo código de la activación no se puede reusar para entrar.
    expect(await checkSecondFactor(db, userId, totpCode(secret, currentStep()))).toBeNull();
    expect(await checkSecondFactor(db, userId, codes[0].toUpperCase())).toBe("recovery");
    expect(await checkSecondFactor(db, userId, codes[0])).toBeNull(); // ya se gastó
  });

  it("el respaldo incluye todas las tablas menos sesiones e intentos de login", async () => {
    await recordAttempt(db, "ana@x.com", null, false);
    const b = await buildBackup(db);
    const json = JSON.parse(gunzipSync(b.gz).toString());
    expect(Object.keys(json.tables)).toEqual(expect.arrayContaining(["expenses", "revenues", "members", "users", "member_events"]));
    expect(json.tables.sessions).toBeUndefined();
    expect(json.tables.login_attempts).toBeUndefined();
    expect(json.tables.users[0].email).toBeDefined();
  });
});
