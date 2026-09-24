import { todayIn } from "@/lib/today";
import { BRAND } from "@/lib/config";

/** Lee ?mes=YYYY-MM | todos. Por defecto, el mes actual del negocio. */
export function monthFromParams(mes: string | string[] | undefined): string | null {
  const v = Array.isArray(mes) ? mes[0] : mes;
  if (v === "todos") return null;
  if (v && /^\d{4}-\d{2}$/.test(v)) return v;
  return todayIn(BRAND.timeZone).slice(0, 7);
}

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
