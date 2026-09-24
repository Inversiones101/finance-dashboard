import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { logout } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export default async function SinAccesoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-2xl font-bold">Aún no tienes acceso</h1>
      <p className="text-muted-foreground">Tu rol no tiene permisos en ningún módulo. Pídele a un administrador que te los asigne.</p>
      <form action={logout}>
        <Button variant="outline">Cerrar sesión</Button>
      </form>
    </div>
  );
}
