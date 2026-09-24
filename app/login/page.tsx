import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BRAND } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(users);
  const mode = n === 0 ? "setup" : "login";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-accent/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-primary/15 blur-3xl" />
      <ThemeToggle className="absolute top-4 right-4" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="relative flex size-14 -rotate-6 items-center justify-center rounded-2xl bg-highlight font-heading text-xl font-bold text-highlight-foreground shadow-card">
            101
            <span className="absolute -top-1 -right-1 size-4 rounded-full border-4 border-background bg-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{mode === "setup" ? "¡Bienvenido!" : "Hola de nuevo"}</h1>
            <p className="text-sm text-muted-foreground">
              {mode === "setup" ? `Crea la cuenta de administrador de ${BRAND.company}.` : `Entra a las finanzas de ${BRAND.company}.`}
            </p>
          </div>
        </div>
        <div className="rounded-3xl border bg-surface p-6 shadow-card">
          <LoginForm mode={mode} next={typeof next === "string" ? next : undefined} needsSetupToken={mode === "setup" && !!process.env.SETUP_TOKEN} />
        </div>
      </div>
    </div>
  );
}
