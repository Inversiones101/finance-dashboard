"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { executeProposalAction } from "@/lib/actions/assistant";
import type { Proposal } from "@/lib/assistant/tools";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; proposals?: Proposal[] };

const SUGGESTIONS = [
  "¿Cómo va el negocio este mes?",
  "¿Qué gastos tuve este mes?",
  "Registra un gasto de $20 de Claude Pro pagado con la Mercury IO",
  "¿Qué miembros anuales renuevan pronto?",
];

/** Texto simple con **negritas** y saltos de línea, sin HTML arbitrario. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className={cn(line.trim() === "" && "h-2")}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : part))}
        </p>
      ))}
    </>
  );
}

function ProposalCard({ p, onDone }: { p: Proposal; onDone: (status: "applied" | "dismissed") => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="mt-2 rounded-2xl border bg-surface p-3 text-sm shadow-card">
      <p className="font-medium">{p.title}</p>
      {p.lines.map((l) => (
        <p key={l} className="text-xs text-muted-foreground">
          {l}
        </p>
      ))}
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await executeProposalAction({ kind: p.kind, payload: p.payload });
              if (r.ok) {
                toast.success(r.message ?? "Aplicado");
                onDone("applied");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Confirmar
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDone("dismissed")}>
          <X className="size-3.5" /> Descartar
        </Button>
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<Record<string, "applied" | "dismissed">>({});
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // scrollIntoView devuelve una promesa en navegadores recientes: no debe ser el retorno del efecto.
    void bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Solo texto: las propuestas y resultados de herramientas se quedan en el cliente.
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json()) as { reply?: string; proposals?: Proposal[]; error?: string };
      setMessages((m) => [...m, { role: "assistant", content: data.error ?? data.reply ?? "…", proposals: data.proposals }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "No pude conectar con el asistente. Intenta de nuevo." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="fixed right-5 bottom-5 z-40 h-12 rounded-full px-4 shadow-card" aria-label="Abrir asistente">
          <Sparkles className="size-4" /> Asistente
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Sparkles className="size-3.5" />
            </span>
            Asistente
          </SheetTitle>
          <SheetDescription>Pregunta por tus números o pide un cambio. Nada se aplica sin que lo confirmes.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {messages.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Prueba con:</p>
              {SUGGESTIONS.map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2">
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[90%] space-y-1 rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-2")}>
                <RichText text={m.content} />
                {m.proposals?.map((p) =>
                  resolved[p.id] ? (
                    <p key={p.id} className="mt-2 text-xs text-muted-foreground">
                      {resolved[p.id] === "applied" ? "✓ Aplicado" : "Descartado"}: {p.title}
                    </p>
                  ) : (
                    <ProposalCard key={p.id} p={p} onDone={(st) => setResolved((r) => ({ ...r, [p.id]: st }))} />
                  )
                )}
              </div>
            </div>
          ))}
          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Revisando tus números…
            </p>
          )}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Escribe tu pregunta…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Enviar">
            <Send className="size-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
