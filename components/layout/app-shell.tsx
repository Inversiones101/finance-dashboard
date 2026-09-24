"use client";

import { useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Permissions } from "@/lib/auth/permissions";
import { Brand } from "./brand";
import { NavList } from "./nav-list";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { useSidebarCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

type ShellUser = { name: string; email: string; roleName: string; title: string | null; isOwner: boolean; permissions: Permissions };

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { collapsed, toggle } = useSidebarCollapsed();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside className={cn("hidden shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-64")}>
        <div className={cn("flex h-16 items-center", collapsed ? "justify-center" : "px-5")}>
          <Brand iconOnly={collapsed} />
        </div>
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          <NavList permissions={user.permissions} collapsed={collapsed} />
        </div>
        <div className={cn("flex gap-2 border-t py-3", collapsed ? "flex-col items-center px-2" : "items-center justify-between px-4")}>
          <ThemeToggle vertical={collapsed} />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={toggle}
            aria-label={collapsed ? "Mostrar nombres del menú" : "Mostrar solo íconos"}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            <ToggleIcon className="size-4" />
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetHeader className="border-b px-5 py-4">
                <SheetTitle asChild>
                  <div>
                    <Brand />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                <NavList permissions={user.permissions} onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="flex items-center justify-between border-t px-5 py-3">
                <span className="text-xs text-muted-foreground">Tema</span>
                <ThemeToggle />
              </div>
            </SheetContent>
          </Sheet>

          <div className="lg:hidden">
            <Brand compact />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle className="hidden sm:inline-flex lg:hidden" />
            <UserMenu name={user.name} email={user.email} subtitle={user.title ?? user.roleName} isOwner={user.isOwner} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-24 md:px-8 md:pt-8">{children}</div>
        </main>
        <AssistantPanel />
      </div>
    </div>
  );
}
