import { brandIcon } from "@/lib/pwa/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iPhone: "Agregar a pantalla de inicio" usa este ícono (iOS redondea las esquinas solo). */
export default function AppleIcon() {
  return brandIcon(180, { padded: true });
}
