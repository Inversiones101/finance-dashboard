/** Hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function todayIn(timeZone = "America/Tegucigalpa") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
