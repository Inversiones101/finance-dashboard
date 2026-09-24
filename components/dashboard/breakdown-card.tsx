import { formatUSD } from "@/lib/format";

/** Lista con barras proporcionales. Se adapta sola a cualquier número de productos o categorías. */
export function BreakdownCard({
  title,
  items,
  color,
  empty,
  max = 5,
}: {
  title: string;
  items: { name: string; amount: number }[];
  color: string;
  empty: string;
  max?: number;
}) {
  // Más de `max` renglones se agrupan en "Otros" para que la tarjeta no crezca sin límite.
  const shown = items.length > max ? [...items.slice(0, max - 1), { name: "Otros", amount: items.slice(max - 1).reduce((s, i) => s + i.amount, 0) }] : items;
  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="rounded-3xl border bg-surface p-5 shadow-card">
      <h2 className="text-base font-semibold">{title}</h2>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {shown.map((i) => (
            <li key={i.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{i.name}</span>
                <span className="font-medium tabular">{formatUSD(i.amount, { cents: i.amount % 1 !== 0 })}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${(i.amount / (total || 1)) * 100}%`, background: color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
