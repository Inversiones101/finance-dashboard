import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite carga su WASM desde el disco; si Next lo empaqueta, pierde la ruta.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Recibos (fotos comprimidas o PDF) de hasta 4 MB; Vercel acepta hasta 4.5 MB por request.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
