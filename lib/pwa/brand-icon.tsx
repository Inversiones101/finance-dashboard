import { ImageResponse } from "next/og";

/**
 * Ícono de la app (pantalla de inicio, pestaña del navegador): el "101" sobre verde bosque con
 * el punto lima, igual que el logo del login. `padded` deja margen para íconos "maskable" (Android
 * los recorta en círculo o cuadro redondeado).
 */
export function brandIcon(size: number, { padded = false }: { padded?: boolean } = {}) {
  const inner = padded ? size * 0.72 : size;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#003028" }}>
        <div style={{ position: "relative", width: inner, height: inner, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#f5f5ef", fontSize: inner * 0.42, fontWeight: 800, letterSpacing: -inner * 0.02 }}>101</span>
          <div
            style={{
              position: "absolute",
              top: inner * 0.2,
              right: inner * 0.16,
              width: inner * 0.12,
              height: inner * 0.12,
              borderRadius: inner,
              background: "#a5e20d",
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
