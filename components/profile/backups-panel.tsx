import { Archive, Download, HardDriveDownload } from "lucide-react";
import { blobConfigured, listBackups } from "@/lib/services/backup";
import { backupNowAction } from "@/lib/actions/backup";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/crud/page-header";
import { ActionButton } from "@/components/crud/action-button";

/** Respaldos: los automáticos de cada domingo (Vercel Blob privado) y descarga manual. */
export async function BackupsPanel() {
  const configured = blobConfigured();
  const backups = await listBackups().catch(() => []);
  const last = backups[0];

  return (
    <Panel
      className="mt-4"
      title="Respaldos"
      description={
        configured
          ? "Cada domingo se guarda un respaldo completo en tu almacenamiento privado de Vercel (se conservan los últimos 12)."
          : "Conecta Vercel Blob (Vercel → Storage → Blob, acceso privado) para respaldos automáticos cada domingo."
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href="/api/respaldo" download>
              <HardDriveDownload className="size-3.5" /> Descargar uno ahora
            </a>
          </Button>
          {configured && (
            <ActionButton action={backupNowAction} size="sm" pendingLabel="Respaldando…">
              <Archive className="size-3.5" /> Respaldar ahora
            </ActionButton>
          )}
        </div>
      }
    >
      {configured && (
        <>
          <p className="mb-2 text-sm">
            {last ? (
              <>
                Último respaldo: <span className="font-medium">{new Date(last.uploadedAt).toLocaleString("es-HN", { dateStyle: "long", timeStyle: "short", timeZone: "America/Tegucigalpa" })}</span>
              </>
            ) : (
              "Aún no hay respaldos guardados. El primero se hace el domingo, o ahora con el botón."
            )}
          </p>
          {backups.length > 0 && (
            <ul className="divide-y rounded-2xl border text-sm">
              {backups.map((b) => (
                <li key={b.pathname} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate">{b.name}</span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    {(b.size / 1024).toFixed(0)} KB
                    <a href={`/api/respaldo?archivo=${encodeURIComponent(b.pathname)}`} className="inline-flex items-center gap-1 text-foreground hover:underline">
                      <Download className="size-3.5" /> Descargar
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
