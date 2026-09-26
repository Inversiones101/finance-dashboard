import Link from "next/link";
import { Eye, ListChecks, Sparkles } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getMonthlyReport } from "@/lib/services/monthly-report";
import type { Tx } from "@/lib/services/ledger";
import { closedThrough } from "@/lib/services/month-close";
import { todayIn } from "@/lib/today";
import { BRAND } from "@/lib/config";
import { PageHeader, Empty } from "@/components/crud/page-header";
import { ReportActions } from "@/components/reports/report-actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const name = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const prev = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

export default async function InformesPage({ searchParams }: PageProps<"/informes">) {
  const user = await requirePage("reports");
  const canWrite = can(user.permissions, "reports", "write");
  const db = (await getDb()) as unknown as Tx;
  const current = todayIn().slice(0, 7);
  const [closed, saved] = await Promise.all([closedThrough(db), db.select({ month: s.monthlyReports.month }).from(s.monthlyReports)]);

  // Meses con operación: desde agosto 2026 hasta el mes en curso.
  const months: string[] = [];
  for (let m = current; m >= "2026-08" && months.length < 24; m = prev(m)) months.push(m);
  const { mes } = await searchParams;
  const month = typeof mes === "string" && months.includes(mes) ? mes : (closed && months.includes(closed) ? closed : months[1] ?? months[0]);
  const report = await getMonthlyReport(db, month);
  const done = new Set(saved.map((r) => r.month));
  const title = `Informe de ${name(month)} · ${BRAND.company}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader title="Informe mensual" description="Un resumen del mes redactado por la IA con tus números: qué pasó, por qué, qué vigilar y qué hacer. Ideal al cerrar el mes." />
      </div>

      <nav className="flex flex-wrap gap-1.5 print:hidden" aria-label="Mes">
        {months.map((m) => (
          <Link key={m} href={`/informes?mes=${m}`} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm capitalize", m === month ? "bg-surface font-medium shadow-card" : "text-muted-foreground")}>
            {done.has(m) && <span className="size-1.5 rounded-full bg-success" aria-label="con informe" />}
            {name(m)}
            {m === current && <span className="text-[10px] text-muted-foreground">(en curso)</span>}
          </Link>
        ))}
      </nav>

      <article className="rounded-3xl border bg-surface p-6 shadow-card md:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex flex-col gap-3 border-b pb-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{BRAND.company}</p>
            <h2 className="mt-1 font-heading text-2xl font-bold capitalize">Informe de {name(month)}</h2>
            {report && (
              <p className="mt-1 text-xs text-muted-foreground">
                Redactado el {report.updatedAt.toLocaleDateString("es-HN", { dateStyle: "long", timeZone: "America/Tegucigalpa" })} con IA a partir de tus números. Revísalo antes de compartirlo.
              </p>
            )}
          </div>
          <ReportActions month={month} title={title} report={report?.content ?? null} canWrite={canWrite} />
        </header>

        {!report ? (
          <Empty>
            {month === current ? "El mes está en curso: puedes redactar un avance, pero el informe final conviene al cerrarlo." : "Aún no hay informe de este mes."}
          </Empty>
        ) : (
          <div className="flex max-w-3xl flex-col gap-6">
            <div>
              <p className="font-heading text-xl leading-snug font-semibold">{report.content.titular}</p>
              <p className="mt-2 text-base leading-relaxed text-foreground/85">{report.content.resumen}</p>
            </div>
            {report.content.secciones.map((sec) => (
              <section key={sec.titulo}>
                <h3 className="mb-1.5 text-base font-semibold">{sec.titulo}</h3>
                <p className="text-sm leading-relaxed text-foreground/85">{sec.contenido}</p>
                {sec.puntos.length > 0 && (
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
                    {sec.puntos.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { title: "Qué vigilar", icon: Eye, items: report.content.vigilar, tone: "bg-warning/10" },
                { title: "Próximos pasos", icon: ListChecks, items: report.content.proximos_pasos, tone: "bg-success/10" },
              ].map((b) => (
                <section key={b.title} className={cn("rounded-2xl p-4", b.tone)}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <b.icon className="size-4" /> {b.title}
                  </h3>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                    {b.items.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" /> Generado por IA con los números del sistema. No es asesoría fiscal ni legal.
            </p>
          </div>
        )}
      </article>
    </div>
  );
}
