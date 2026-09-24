import Link from "next/link";
import { ArrowRight, Store } from "lucide-react";
import { formatUSD } from "@/lib/format";

/** Saldo en plataformas de cobro (Skool): dinero facturado que aún no llega al banco. */
export function PlatformCard({ total, accounts }: { total: number; accounts: { name: string; status: string; balance: number | null }[] }) {
  return (
    <div className="flex h-full flex-col justify-between gap-4 rounded-3xl border bg-surface p-6 shadow-card">
      <div>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Store className="size-4" /> Por cobrar en plataformas
          </p>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">Facturación</span>
        </div>
        <p className="mt-3 font-heading text-4xl font-bold tabular">{formatUSD(total, { cents: true })}</p>
        <p className="mt-1 text-xs text-muted-foreground">Lo cobrado en Skool que aún no se transfiere. Solo sale por payout.</p>
      </div>
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div key={a.name} className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Store className="size-3.5 text-muted-foreground" /> {a.name}
            </span>
            <span className="font-medium tabular">{a.balance === null ? "inactiva" : formatUSD(a.balance, { cents: true })}</span>
          </div>
        ))}
        <Link href="/cuentas?seccion=plataformas" className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary hover:underline">
          Registrar payout <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
