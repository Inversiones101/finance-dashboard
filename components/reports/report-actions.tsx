"use client";

import { Download, Printer, Sparkles } from "lucide-react";
import type { MonthlyReport } from "@/lib/services/monthly-report";
import { generateReportAction } from "@/lib/actions/monthly-report";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/crud/action-button";

function toMarkdown(title: string, r: MonthlyReport) {
  return [
    `# ${title}`,
    "",
    `**${r.titular}**`,
    "",
    r.resumen,
    ...r.secciones.flatMap((s) => ["", `## ${s.titulo}`, "", s.contenido, "", ...s.puntos.map((p) => `- ${p}`)]),
    "",
    "## Qué vigilar",
    "",
    ...r.vigilar.map((p) => `- ${p}`),
    "",
    "## Próximos pasos",
    "",
    ...r.proximos_pasos.map((p) => `- ${p}`),
    "",
  ].join("\n");
}

/** Generar / regenerar, imprimir (o guardar como PDF) y descargar en Markdown. */
export function ReportActions({ month, title, report, canWrite }: { month: string; title: string; report: MonthlyReport | null; canWrite: boolean }) {
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([toMarkdown(title, report)], { type: "text/markdown" }));
    Object.assign(document.createElement("a"), { href: url, download: `informe-${month}.md` }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {report && (
        <>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Imprimir o PDF
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="size-3.5" /> Descargar
          </Button>
        </>
      )}
      {canWrite && (
        <ActionButton action={generateReportAction.bind(null, month)} size="sm" variant={report ? "ghost" : "default"} pendingLabel="Redactando… (hasta 1 min)">
          <Sparkles className="size-3.5" /> {report ? "Volver a redactar" : "Redactar informe con IA"}
        </ActionButton>
      )}
    </div>
  );
}
