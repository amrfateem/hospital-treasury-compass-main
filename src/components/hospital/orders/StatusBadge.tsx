import { cn } from "@/lib/utils";

const TONES = {
  pending: "bg-copper/15 text-copper",
  approved: "bg-primary/10 text-primary",
  partial: "bg-primary/10 text-primary",
  paid: "bg-income/10 text-income",
  received: "bg-income/10 text-income",
  issued: "bg-income/10 text-income",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
} as const;

export function StatusBadge({ status, label }: { status: keyof typeof TONES; label: string }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[status])}>
      {label}
    </span>
  );
}
