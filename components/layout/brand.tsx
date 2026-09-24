import { BRAND } from "@/lib/config";

export function Brand({ compact, iconOnly }: { compact?: boolean; iconOnly?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-highlight font-heading text-sm font-bold text-highlight-foreground">
        101
        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-accent" />
      </div>
      <div className={iconOnly ? "sr-only" : "leading-tight whitespace-nowrap"}>
        <p className="font-heading text-sm font-semibold">{BRAND.name}</p>
        <p className={compact ? "hidden text-[11px] text-muted-foreground sm:block" : "text-[11px] text-muted-foreground"}>{BRAND.company}</p>
      </div>
    </div>
  );
}
