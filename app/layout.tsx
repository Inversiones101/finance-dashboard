import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { getSessionUser } from "@/lib/auth/session";
import { themeInitScript } from "@/lib/theme";
import { BRAND } from "@/lib/config";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });

export const metadata: Metadata = {
  title: BRAND.name,
  description: `Sistema financiero de ${BRAND.company}: P&L, flujo de caja y aportes del propietario.`,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();

  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Aplica el tema antes de pintar para evitar el parpadeo claro → oscuro. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <TooltipProvider delayDuration={200}>
          {user ? (
            <AppShell user={{ name: user.name, email: user.email, roleName: user.roleName, title: user.title, isOwner: user.isOwner, permissions: user.permissions }}>{children}</AppShell>
          ) : (
            children
          )}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
