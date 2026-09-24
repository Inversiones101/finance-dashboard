import { cn } from "@/lib/utils";

const TONES = {
  good: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-danger/15 text-danger",
  muted: "bg-surface-2 text-muted-foreground",
  info: "bg-highlight/10 text-foreground",
} as const;

export function StatusBadge({ label, tone = "muted" }: { label: string; tone?: keyof typeof TONES }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone])}>{label}</span>;
}
