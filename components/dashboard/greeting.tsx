"use client";

import { useSyncExternalStore } from "react";
import { Coffee, Moon, Sun, Sunset } from "lucide-react";

type Slot = "morning" | "afternoon" | "evening" | "night";

const COPY: Record<Slot, { hello: string; ask: string; icon: typeof Sun }> = {
  morning: { hello: "¡Buenos días", ask: "¿Qué hacemos hoy?", icon: Coffee },
  afternoon: { hello: "¡Buenas tardes", ask: "Así va el negocio hoy.", icon: Sun },
  evening: { hello: "¡Buenas noches", ask: "Cerremos el día con números claros.", icon: Sunset },
  night: { hello: "¡Hola, noctámbulo", ask: "Los números también trasnochan.", icon: Moon },
};

function currentSlot(): Slot {
  // Hora de Honduras, sin importar dónde corra el navegador.
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Tegucigalpa" }).format(new Date())
  );
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

const noopSubscribe = () => () => {};

export function Greeting({ name }: { name: string }) {
  // En el servidor no sabemos la hora del usuario → saludo neutro y se completa al hidratar.
  const slot = useSyncExternalStore(noopSubscribe, currentSlot, () => null);
  const copy = slot ? COPY[slot] : null;
  const Icon = copy?.icon ?? Sun;

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 hidden size-11 shrink-0 -rotate-6 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-card sm:flex">
        <Icon className="size-5" />
      </div>
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">
          {copy ? copy.hello : "¡Hola"}, {name}!
        </h1>
        <p className="mt-0.5 text-muted-foreground">{copy ? copy.ask : "Así va el negocio hoy."}</p>
      </div>
    </div>
  );
}
