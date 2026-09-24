import "server-only";

export type FxRate = {
  /** Lempiras por 1 USD. */
  hnlPerUsd: number;
  /** Fecha de la tasa (YYYY-MM-DD) según la fuente. */
  asOf: string;
  source: "open.er-api.com" | "respaldo";
};

// Última tasa conocida, por si la API no responde. Se reemplaza por la fila más reciente
// de `exchange_rates` cuando la BD esté conectada.
const FALLBACK: FxRate = { hnlPerUsd: 26.86, asOf: "2026-09-22", source: "respaldo" };

/**
 * Tasa USD→HNL del día. La fuente publica una vez al día; la revisamos cada 6 h.
 * Sin API key. Al conectar la BD, un job diario guardará cada tasa en `exchange_rates`
 * para poder convertir cada movimiento con la tasa de SU fecha.
 */
export async function getUsdHnlRate(): Promise<FxRate> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 60 * 60 * 6 } });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as { result: string; time_last_update_unix: number; rates: Record<string, number> };
    const hnl = data.rates?.HNL;
    if (data.result !== "success" || !hnl) return FALLBACK;
    return {
      hnlPerUsd: hnl,
      asOf: new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10),
      source: "open.er-api.com",
    };
  } catch {
    return FALLBACK;
  }
}
