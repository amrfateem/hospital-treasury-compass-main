import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPT_GROUPS, deptColor, findDepartment } from "@/lib/hospital/constants";
import { int, monthName } from "@/lib/hospital/format";
import { exportOfficialPdf } from "@/lib/hospital/pdf";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const YEARS = Array.from({ length: 11 }, (_, i) => 2020 + i);

/** Wraps the off-screen document ref + busy state + toast feedback for PDF exports. */
export function usePdfExport() {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  async function run(filename: string, success: string) {
    if (!ref.current) return;
    setBusy(true);
    try {
      await exportOfficialPdf(ref.current, filename);
      toast.success(success);
    } catch (e) {
      console.error(e);
      toast.error("تعذّر إنشاء ملف PDF، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }
  return { ref, busy, run };
}

export function MonthYearPicker({
  period,
  onChange,
  showMonth = true,
  allowAll = false,
}: {
  period: string; // "YYYY-MM" or "all"
  onChange: (p: string) => void;
  showMonth?: boolean;
  allowAll?: boolean;
}) {
  const isAll = period === "all";
  const year = isAll ? new Date().getFullYear() : Number(period.slice(0, 4));
  const month = isAll ? "all" : String(Number(period.slice(5, 7)));
  return (
    <div className="flex flex-wrap gap-2">
      {showMonth && (
        <Select
          value={month}
          onValueChange={(v) => onChange(v === "all" ? "all" : `${year}-${v.padStart(2, "0")}`)}
        >
          <SelectTrigger className="w-32" aria-label="الشهر">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {allowAll && <SelectItem value="all">كل الشهور</SelectItem>}
            {Array.from({ length: 12 }, (_, i) => (
              <SelectItem key={i} value={String(i + 1)}>
                {monthName(i + 1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={String(year)}
        onValueChange={(v) => onChange(`${v}-${(isAll ? "01" : period.slice(5, 7)) || "01"}`)}
        disabled={isAll && showMonth}
      >
        <SelectTrigger className="w-28" aria-label="السنة">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {YEARS.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {int(y)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Searchable department picker grouped by the hospital's organisational structure. */
export function DeptSelect({
  value,
  onChange,
  allowAll = false,
  className,
  label = "القسم",
  allLabel = "كل الأقسام",
  placeholder = "اختر القسم",
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  className?: string;
  label?: string;
  /** Text of the "all" choice (e.g. "بدون مركز تكلفة"). */
  allLabel?: string;
  /** Shown while no department is chosen yet (value ""). */
  placeholder?: string;
}) {
  const { departments } = useHospitalDB();
  const [open, setOpen] = useState(false);
  const visible = departments.filter((d) => d.active || d.id === value);
  const current = value === "all" || value === "" ? null : findDepartment(departments, value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {current ? (
              <>
                <span className={cn("size-2 shrink-0 rounded-full", current.dot)} />
                <span className="truncate">{current.name}</span>
              </>
            ) : (
              <span className="truncate text-muted-foreground">{value === "" ? placeholder : allLabel}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="ابحث باسم القسم أو الكود..." />
          <CommandList className="max-h-80">
            <CommandEmpty>لا يوجد قسم بهذا الاسم.</CommandEmpty>
            {allowAll && (
              <CommandGroup>
                <CommandItem value={`${allLabel} all`} onSelect={() => pick("all")}>
                  <Check className={cn("size-4", value === "all" ? "opacity-100" : "opacity-0")} />
                  {allLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {DEPT_GROUPS.map((g) => {
              const items = visible.filter((d) => d.group === g.id);
              if (!items.length) return null;
              return (
                <CommandGroup key={g.id} heading={g.name}>
                  {items.map((d) => (
                    <CommandItem
                      key={d.id}
                      value={`${d.name} ${d.code} ${d.id}`}
                      onSelect={() => pick(d.id)}
                    >
                      <Check
                        className={cn("size-4", value === d.id ? "opacity-100" : "opacity-0")}
                      />
                      <span
                        className={cn("size-2 shrink-0 rounded-full", deptColor(d.color).dot)}
                      />
                      <span className="flex-1">{d.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                        {d.code}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full", className)}>
      <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 bg-card pr-9"
        aria-label={placeholder}
      />
    </div>
  );
}

/** Case-insensitive "contains" across several fields. */
/** Lower-cases and folds Arabic spelling variants (أ/إ/آ → ا، ة → ه، ى → ي، no diacritics). */
export function normalizeSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

export function matches(q: string, ...fields: (string | undefined)[]) {
  const n = normalizeSearch(q);
  return !n || fields.some((f) => !!f && normalizeSearch(f).includes(n));
}

/** Filter bar used above every register: period / department / search side by side. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="ledger-card mb-6 flex flex-col gap-3 p-3 md:flex-row md:flex-wrap md:items-center">
      {children}
    </div>
  );
}

export function TableCard({
  minWidth = 900,
  children,
}: {
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div className="ledger-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function HeadRow({ children }: { children: ReactNode }) {
  return <tr className="border-b bg-secondary/60 text-xs text-secondary-foreground">{children}</tr>;
}

export function Th({
  children,
  num,
  className,
}: {
  children?: ReactNode;
  num?: boolean;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-3 font-semibold whitespace-nowrap",
        num ? "text-left" : "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  num,
  className,
  colSpan,
}: {
  children?: ReactNode;
  num?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-3 py-3", num && "num text-left", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-14 text-center text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

export function FieldRow({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function DocInfoGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <div
      data-pdf-break
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "4px 24px",
        fontSize: 12.5,
        marginBottom: 12,
      }}
    >
      {items.map(([k, v]) => (
        <div key={k}>
          <span style={{ color: "var(--doc-muted)" }}>{k}: </span>
          <span style={{ fontWeight: 700 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Cash box picker (main treasury + sub drawers). */
export function BoxSelect({
  value,
  onChange,
  allowAll = false,
  cashOnly = false,
  className,
  label = "الخزينة",
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  cashOnly?: boolean;
  className?: string;
  label?: string;
}) {
  const { cashboxes } = useHospitalDB();
  const visible = cashboxes.filter(
    (b) => (b.active || b.id === value) && (!cashOnly || b.kind !== "bank"),
  );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("bg-card", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent dir="rtl">
        {allowAll && <SelectItem value="all">كل الخزائن</SelectItem>}
        {visible.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Payment method picker from settings → lists.paymentMethods. */
export function MethodSelect({
  value,
  onChange,
  className,
  label = "طريقة الدفع",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  label?: string;
}) {
  const { lists } = useHospitalDB();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("bg-card", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent dir="rtl">
        {lists.paymentMethods.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Searchable store-item picker grouped by store category. Items of `preferDept` (the requesting
 * department) are listed first so each department finds its own consumables quickly.
 */
export function StockItemSelect({
  value,
  onChange,
  balances,
  preferDept,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  balances: Record<string, number>;
  preferDept?: string;
  className?: string;
}) {
  const { stockItems, lists, departments } = useHospitalDB();
  const [open, setOpen] = useState(false);
  const current = stockItems.find((i) => i.id === value);
  const active = stockItems.filter((i) => i.active || i.id === value);
  const mine = preferDept ? active.filter((i) => i.department === preferDept) : [];
  const groups = lists.stockCategories
    .map((c) => ({ c, items: active.filter((i) => i.category === c.id && i.department !== preferDept) }))
    .filter((g) => g.items.length);
  const row = (i: (typeof stockItems)[number]) => (
    <CommandItem
      key={i.id}
      value={`${i.name} ${findDepartment(departments, i.department).name} ${i.id}`}
      onSelect={() => {
        onChange(i.id);
        setOpen(false);
      }}
    >
      <Check className={cn("size-4", value === i.id ? "opacity-100" : "opacity-0")} />
      <span className="flex-1 truncate">{i.name}</span>
      <span className={cn("num text-[10px]", (balances[i.id] ?? 0) > 0 ? "text-muted-foreground" : "text-destructive")}>
        {int(balances[i.id] ?? 0)} {i.unit}
      </span>
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="الصنف"
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className,
          )}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current ? `${current.name} — المتاح ${int(balances[current.id] ?? 0)} ${current.unit}` : "اختر الصنف"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="ابحث باسم الصنف أو القسم..." />
          <CommandList className="max-h-80">
            <CommandEmpty>لا يوجد صنف بهذا الاسم.</CommandEmpty>
            {mine.length > 0 && (
              <CommandGroup heading={`مستهلكات ${findDepartment(departments, preferDept!).name}`}>{mine.map(row)}</CommandGroup>
            )}
            {groups.map((g) => (
              <CommandGroup key={g.c.id} heading={g.c.name}>
                {g.items.map(row)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
