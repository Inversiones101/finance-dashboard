import { BookOpen } from "lucide-react";
import { GLOSSARY } from "@/lib/finance/terms";

/** "¿Qué significa cada concepto?": el vocabulario de los estados financieros en lenguaje simple. */
export function Glossary() {
  return (
    <details className="group rounded-3xl border bg-surface px-4 py-3 shadow-card md:px-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <BookOpen className="size-4 text-muted-foreground" /> ¿Qué significa cada concepto?
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Ver glosario</span>
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Contabilidad según US GAAP (la LLC es de EE. UU.): ingresos por ASC 606, puesta en marcha por ASC 720-15. Nombres en español según las NIF. Para impuestos, tu contador puede usar otra base (ver paquete del contador).
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-sm md:grid-cols-2">
        {GLOSSARY.map((g) => (
          <div key={g.term}>
            <dt className="font-medium">{g.term}</dt>
            <dd className="text-muted-foreground">{g.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
