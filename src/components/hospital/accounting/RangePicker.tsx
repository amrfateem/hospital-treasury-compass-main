import { Input } from "@/components/ui/input";
import { isoDate } from "@/lib/hospital/format";
import { cn } from "@/lib/utils";

export interface Range {
  from: string;
  to: string;
}
export function thisMonth(): Range {
  const d = new Date();
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}
export function thisYear(): Range {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
function lastMonth(): Range {
  const d = new Date();
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth(), 0)) };
}

/** Period chips + from / to dates for financial reports. */
export function RangePicker({ value, onChange, single }: { value: Range; onChange: (r: Range) => void; single?: boolean }) {
  const presets: [string, Range][] = [
    ["هذا الشهر", thisMonth()],
    ["الشهر الماضي", lastMonth()],
    ["هذه السنة", thisYear()],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(([label, r]) => {
        const active = single ? value.to === r.to : value.from === r.from && value.to === r.to;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(r)}
            className={cn("chip-filter", active && "chip-filter-active")}
          >
            {label}
          </button>
        );
      })}
      {!single && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          من
          <Input type="date" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="h-9 w-40 bg-card" aria-label="من تاريخ" />
        </label>
      )}
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        {single ? "في تاريخ" : "إلى"}
        <Input type="date" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="h-9 w-40 bg-card" aria-label="إلى تاريخ" />
      </label>
    </div>
  );
}
