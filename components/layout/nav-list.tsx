"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { can, type Permissions } from "@/lib/auth/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_GROUPS } from "./nav-items";

export function NavList({ permissions, onNavigate, collapsed }: { permissions: Permissions; onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(permissions, i.module)) })).filter((g) => g.items.length);

  return (
    <nav className={cn("flex flex-col gap-5 py-4", collapsed ? "items-center px-2" : "px-3")}>
      {groups.map((group) => (
        <div key={group.label} className={cn(collapsed && "flex flex-col items-center")}>
          {collapsed ? (
            <div className="mx-auto mb-1.5 h-px w-6 bg-border" aria-hidden />
          ) : (
            <p className="px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground">{group.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "group flex items-center rounded-xl text-sm transition-colors",
                    collapsed ? "size-10 justify-center" : "gap-2.5 px-2.5 py-2",
                    active ? "bg-primary font-medium text-primary-foreground shadow-card" : "text-foreground/75 hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
