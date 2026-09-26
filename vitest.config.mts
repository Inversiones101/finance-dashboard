import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "."), "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } },
  // Cada archivo crea su base PGlite y corre todas las migraciones: en paralelo puede tardar.
  test: { environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
});
