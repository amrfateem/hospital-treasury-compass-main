import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { findDepartment, type LedgerDepartment } from "@/lib/hospital/constants";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow-pill mb-2">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-[2.15rem]">{title}</h1>
        <span className="mt-2 block h-1 w-14 rounded-full bg-gradient-to-l from-primary to-primary-glow" />
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "income" | "expense" | "copper" | "primary";
}) {
  const toneCls = {
    default: "text-foreground",
    income: "text-income",
    expense: "text-expense",
    copper: "text-copper",
    primary: "text-primary",
  }[tone];
  return (
    <div className="ledger-card lift relative overflow-hidden p-4">
      <span className={cn("absolute inset-x-0 top-0 h-0.5 bg-current opacity-60", toneCls)} />
      <div className="flex items-start justify-between gap-2">
        <p className="pt-1 text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("stat-icon", toneCls)}>
            <Icon className="size-4.5" />
          </span>
        )}
      </div>
      <p className={cn("num mt-1 font-display text-2xl font-bold tracking-tight", toneCls)}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function DeptBadge({ id, className }: { id: LedgerDepartment; className?: string }) {
  const { departments } = useHospitalDB();
  const d = findDepartment(departments, id);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        d.soft,
        d.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", d.dot)} />
      {d.name}
    </span>
  );
}

export function KindBadge({ kind }: { kind: "in" | "out" }) {
  return kind === "in" ? (
    <span className="rounded-md bg-income/10 px-2 py-0.5 text-xs font-semibold text-income">
      إيراد
    </span>
  ) : (
    <span className="rounded-md bg-expense/10 px-2 py-0.5 text-xs font-semibold text-expense">
      مصروف
    </span>
  );
}
