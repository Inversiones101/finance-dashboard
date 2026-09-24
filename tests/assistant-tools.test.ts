import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionUser } from "@/lib/auth/session";
import { MODULES, type Permissions } from "@/lib/auth/permissions";

// Base temporal propia (PGlite) y sin llamadas a la red para la tasa de cambio.
process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "i101-assistant-"));
vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));

const { runTool } = await import("@/lib/assistant/tools");
const perms = (level: "admin" | "read" | "none") => Object.fromEntries(MODULES.map((m) => [m, level])) as Permissions;
const admin: SessionUser = { id: "u1", name: "Ricardo", email: "r@x.test", roleId: "r", roleName: "Administrador", title: "Fundador", isOwner: true, permissions: perms("admin") };
const reader: SessionUser = { ...admin, id: "u2", isOwner: false, permissions: perms("read") };

let catalog: { categorias: { id: string; nombre: string; tipo: string }[]; cuentas_llc: { id: string; nombre: string; tipo: string }[] };

beforeAll(async () => {
  catalog = JSON.parse((await runTool("catalogos", {}, admin)).result);
}, 60_000);

describe("herramientas del asistente", () => {
  it("el resumen trae KPIs reales y nada personal", async () => {
    const r = await runTool("resumen_financiero", {}, admin);
    const d = JSON.parse(r.result);
    expect(d.kpis.revenueGross).toBeGreaterThan(0);
    expect(r.result).not.toMatch(/AMEX|Visa Infinite|BAC/);
  });

  it("proponer un gasto NO lo registra: devuelve una propuesta", async () => {
    const software = catalog.categorias.find((c) => c.nombre === "Software y herramientas")!;
    const io = catalog.cuentas_llc.find((c) => c.nombre === "Mercury IO")!;
    const r = await runTool("proponer_gasto", { descripcion: "Claude Pro", monto: 20, moneda: "USD", fecha: "2026-09-21", categoria_id: software.id, pago: io.id }, admin);
    expect(r.proposal).toMatchObject({ kind: "expense", payload: { amount: 20, account: io.id, card: true } });
    expect(r.result).toMatch(/NO está aplicada/);
    const after = JSON.parse((await runTool("listar_movimientos", { tipo: "gastos", mes: "2026-09" }, admin)).result);
    expect(after.some((e: { descripcion: string }) => e.descripcion === "Claude Pro")).toBe(false);
  });

  it("rechaza datos inválidos y respeta permisos", async () => {
    const skool = catalog.cuentas_llc.find((c) => c.tipo === "processor")!;
    const software = catalog.categorias.find((c) => c.nombre === "Software y herramientas")!;
    const bad = await runTool("proponer_gasto", { descripcion: "x", monto: 5, moneda: "USD", fecha: "2026-09-21", categoria_id: software.id, pago: skool.id }, admin);
    expect(bad.isError).toBe(true); // Skool no paga gastos
    const denied = await runTool("proponer_gasto", { descripcion: "x", monto: 5, moneda: "USD", fecha: "2026-09-21", categoria_id: software.id, pago: "aporte_dueno" }, reader);
    expect(denied).toMatchObject({ isError: true });
    expect(denied.proposal).toBeUndefined();
  });
});
