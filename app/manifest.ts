import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";

/** Instalable en el celular: "Agregar a pantalla de inicio" abre la app en pantalla completa. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.company,
    short_name: BRAND.name,
    description: `Finanzas de ${BRAND.company}`,
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5ef",
    theme_color: "#003028",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Cuentas y bandeja de Mercury", url: "/cuentas" },
      { name: "Miembros", url: "/miembros" },
      { name: "Proyección", url: "/proyeccion" },
    ],
  };
}
