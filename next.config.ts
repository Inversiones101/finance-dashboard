import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite carga su WASM desde el disco; si Next lo empaqueta, pierde la ruta.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
