import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPendingMfaSession, getSessionUser } from "@/lib/auth/session";
import { SecondFactorForm } from "@/components/auth/second-factor-form";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export const dynamic = "force-dynamic";

export default async function VerificarPage({ searchParams }: PageProps<"/login/verificar">) {
  if (await getSessionUser()) redirect("/");
  const pending = await getPendingMfaSession();
  if (!pending) redirect("/login");
  const { next } = await searchParams;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-accent/25 blur-3xl" />
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-highlight text-highlight-foreground shadow-card">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Verificación en dos pasos</h1>
            <p className="text-sm text-muted-foreground">Hola, {pending.user.name.split(" ")[0]}. Escribe el código de tu app autenticadora.</p>
          </div>
        </div>
        <div className="rounded-3xl border bg-surface p-6 shadow-card">
          <SecondFactorForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline-offset-2 hover:underline">
            Entrar con otra cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
