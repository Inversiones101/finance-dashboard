import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { deleteExpense, saveExpense, type Tx } from "@/lib/services/ledger";
import { errorMessage } from "@/lib/actions/result";
import { closeChecklist, closedThrough, closeMonth, nextToClose, reopenMonth } from "@/lib/services/month-close";

let db: Tx;
let categoryId: string;
let checking: string;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  [{ id: categoryId }] = await db.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.kind, "opex")).limit(1);
  const [chk] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Mercury Checking"));
  await db.update(s.financialAccounts).set({ status: "active" }).where(eq(s.financialAccounts.id, chk.id));
  checking = chk.id;
});

/** Lo que vería el usuario: el mensaje ya desenvuelto. */
const blocked = (p: Promise<unknown>) => expect(p.catch((e) => Promise.reject(new Error(errorMessage(e))))).rejects.toThrow(/El mes 2026-09 está cerrado/);

const expense = (date: string, status: "paid" | "pending" = "paid") =>
  saveExpense(db, {
    expenseDate: date, description: "Prueba", categoryId, vendorId: null, frequency: "one_time", currency: "USD", amountCents: 1000,
    paymentAccountId: checking, status, dueDate: null, paidOn: status === "paid" ? date : null, notes: null,
  });

describe("cierre de mes", () => {
  it("se cierra en orden y nunca el mes en curso", async () => {
    await db.delete(s.settings).where(eq(s.settings.key, "books_closed_through"));
    expect(await nextToClose(db, "2026-10-05")).toBe("2026-09");
    await expect(closeMonth(db, "2026-10", "2026-10-05")).rejects.toThrow(/Primero cierra 2026-09/);
    await closeMonth(db, "2026-09", "2026-10-05");
    expect(await closedThrough(db)).toBe("2026-09");
    expect(await nextToClose(db, "2026-10-05")).toBeNull();
  });

  it("bloquea crear, editar y borrar con fecha del mes cerrado, en la base", async () => {
    const sep = await expense("2026-09-10");
    await closeMonth(db, "2026-09", "2026-10-05");

    await blocked(expense("2026-09-28"));
    await blocked(db.update(s.expenses).set({ amountCents: 5 }).where(eq(s.expenses.id, sep)).then(() => undefined));
    await blocked(deleteExpense(db, sep));
    // Octubre sigue abierto.
    await expect(expense("2026-10-02")).resolves.toBeTruthy();
    // Cambios operativos que no mueven números sí se permiten (ej. notas, enlazar con el banco).
    await db.update(s.expenses).set({ notes: "revisado" }).where(eq(s.expenses.id, sep));
    await db.update(s.cashMovements).set({ externalId: "mercury-1" }).where(eq(s.cashMovements.expenseId, sep));

    await reopenMonth(db);
    await expect(db.update(s.expenses).set({ amountCents: 1500 }).where(eq(s.expenses.id, sep))).resolves.toBeDefined();
  });

  it("la revisión previa avisa de lo pendiente", async () => {
    await expense("2026-09-12", "pending");
    await db.insert(s.bankInbox).values({ accountId: checking, externalId: "t1", postedOn: "2026-09-20", amountCents: -500 });
    const list = await closeChecklist(db, "2026-09");
    expect(list.filter((c) => !c.ok).map((c) => c.label)).toEqual(["Movimientos de Mercury clasificados", "Gastos del mes pagados"]);
  });
});
