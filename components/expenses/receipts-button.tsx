"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteReceiptAction, uploadReceiptAction } from "@/lib/actions/attachments";
import { cn } from "@/lib/utils";

type Receipt = { id: string; fileName: string; contentType: string; sizeBytes: number };

const MAX = 4 * 1024 * 1024;

/** Fotos del celular: se reducen a 2000 px en JPEG para que suban rápido y quepan en el límite. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_200_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // formato que el navegador no sabe leer (ej. HEIC fuera de Safari): se sube tal cual
  }
}

export function ReceiptsButton({ expenseId, label, receipts, canWrite }: { expenseId: string; label: string; receipts: Receipt[]; canWrite: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const upload = (files: FileList | null) =>
    start(async () => {
      for (const original of Array.from(files ?? [])) {
        const file = await shrink(original);
        if (file.size > MAX) {
          toast.error(`${original.name}: pasa de 4 MB`);
          continue;
        }
        const form = new FormData();
        form.set("expenseId", expenseId);
        form.set("file", file);
        const r = await uploadReceiptAction(form);
        if (r.ok) toast.success(r.message ?? "Recibo guardado");
        else toast.error(r.error);
      }
      if (input.current) input.current.value = "";
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const r = await deleteReceiptAction(id);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });

  if (!canWrite && receipts.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative size-8", receipts.length ? "text-foreground" : "text-muted-foreground/60")}
          aria-label={receipts.length ? `${receipts.length} recibo(s)` : "Adjuntar recibo"}
          title={receipts.length ? `${receipts.length} recibo(s)` : "Adjuntar recibo"}
        >
          <Paperclip className="size-3.5" />
          {receipts.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">{receipts.length}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recibos</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        {receipts.length > 0 ? (
          <ul className="divide-y rounded-2xl border">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {r.contentType === "application/pdf" ? <FileText className="size-4 shrink-0 text-muted-foreground" /> : <ImageIcon className="size-4 shrink-0 text-muted-foreground" />}
                <a href={`/api/adjuntos/${r.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:underline">
                  {r.fileName}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">{Math.max(1, Math.round(r.sizeBytes / 1024))} KB</span>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-danger" disabled={pending} onClick={() => remove(r.id)} aria-label={`Eliminar ${r.fileName}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin recibos todavía.</p>
        )}

        {canWrite && (
          <label className={cn("flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-dashed bg-surface-2 px-4 py-5 text-center text-sm hover:bg-surface-2/70", pending && "pointer-events-none opacity-60")}>
            {pending ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5 text-muted-foreground" />}
            <span className="font-medium">{pending ? "Subiendo…" : "Subir PDF o foto"}</span>
            <span className="text-xs text-muted-foreground">Desde el celular puedes tomar la foto directo · máx. 4 MB</span>
            <input ref={input} type="file" accept="application/pdf,image/*" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
        )}
      </DialogContent>
    </Dialog>
  );
}
