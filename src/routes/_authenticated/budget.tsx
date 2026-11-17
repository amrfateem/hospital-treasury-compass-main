import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, FilterBar, HeadRow, MonthYearPicker, TableCard, Td, Th } from "@/components/hospital/kit";
import { findDepartment } from "@/lib/hospital/constants";
import { costCenters } from "@/lib/hospital/finance";
import { int, money, monthLabel, periodOf } from "@/lib/hospital/format";
import { saveBudget, useCan, useHospitalDB } from "@/lib/hospital/store";
import type { Budget } from "@/lib/hospital/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/budget")({
  head: () => ({
    meta: [
      { title: "الموازنة التقديرية — المخطط مقابل الفعلي | مستشفى الرحمة التخصصي" },
      { name: "description", content: "موازنة إيرادات ومصروفات كل قسم شهريًا ومقارنتها بالفعلي ونسبة الانحراف." },
      { property: "og:title", content: "الموازنة التقديرية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "المخطط مقابل الفعلي لكل قسم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BudgetPage,
});

type Mode = "month" | "ytd" | "year";
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
const pct = (actual: number, plan: number) => (plan > 0 ? Math.round(((actual - plan) / plan) * 1000) / 10 : null);

function BudgetPage() {
  const db = useHospitalDB();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [mode, setMode] = useState<Mode>("ytd");
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = useCan("costCenters", "edit");
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const months = mode === "month" ? [month] : mode === "ytd" ? Array.from({ length: month }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);

  const actual = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number }>();
    for (const m of months) {
      const r = costCenters(
        { invoices: db.patientInvoices, supplierInvoices: db.supplierInvoices, transactions: db.transactions, assets: db.assets },
        `${year}-${String(m).padStart(2, "0")}`,
      );
      for (const x of r.rows) {
        const cur = map.get(x.dept) ?? { revenue: 0, expense: 0 };
        map.set(x.dept, { revenue: cur.revenue + x.revenue, expense: cur.expense + x.expenses });
      }
    }
    return map;
  }, [db.patientInvoices, db.supplierInvoices, db.transactions, db.assets, year, months.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const budgets = db.budgets.filter((b) => b.year === year);
  const planOf = (dept: string) => {
    const b = budgets.find((x) => x.department === dept);
    return { revenue: b ? sum(months.map((m) => b.revenue[m - 1] ?? 0)) : 0, expense: b ? sum(months.map((m) => b.expense[m - 1] ?? 0)) : 0 };
  };
  const depts = db.departments.filter((d) => d.active || budgets.some((b) => b.department === d.id) || actual.has(d.id));
  const rows = depts
    .map((d) => ({ dept: d.id, plan: planOf(d.id), act: actual.get(d.id) ?? { revenue: 0, expense: 0 } }))
    .filter((r) => r.plan.revenue || r.plan.expense || r.act.revenue || r.act.expense || canEdit);
  const t = rows.reduce(
    (s, r) => ({ pr: s.pr + r.plan.revenue, pe: s.pe + r.plan.expense, ar: s.ar + r.act.revenue, ae: s.ae + r.act.expense }),
    { pr: 0, pe: 0, ar: 0, ae: 0 },
  );
  const label = mode === "month" ? monthLabel(period) : mode === "ytd" ? `من يناير حتى ${MONTHS[month - 1]} ${int(year)}` : `سنة ${int(year)}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="التقارير"
        title="الموازنة التقديرية — المخطط مقابل الفعلي"
        description="حدد لكل قسم الإيراد والمصروف المتوقع لكل شهر، والنظام يقارنه بالفعلي من الإيصالات والمصروفات ويبين نسبة الانحراف."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="الإيراد المخطط" value={money(t.pr)} icon={Target} hint={label} />
        <StatCard label="الإيراد الفعلي" value={money(t.ar)} icon={TrendingUp} tone="income" hint={pct(t.ar, t.pr) === null ? "—" : `${pct(t.ar, t.pr)! > 0 ? "+" : ""}${pct(t.ar, t.pr)}٪ عن المخطط`} />
        <StatCard label="المصروف المخطط" value={money(t.pe)} icon={Target} />
        <StatCard label="المصروف الفعلي" value={money(t.ae)} icon={TrendingDown} tone="expense" hint={pct(t.ae, t.pe) === null ? "—" : `${pct(t.ae, t.pe)! > 0 ? "+" : ""}${pct(t.ae, t.pe)}٪ عن المخطط`} />
      </div>
      <FilterBar>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} dir="rtl">
          <TabsList>
            <TabsTrigger value="month">الشهر</TabsTrigger>
            <TabsTrigger value="ytd">من أول السنة</TabsTrigger>
            <TabsTrigger value="year">السنة كاملة</TabsTrigger>
          </TabsList>
        </Tabs>
        <MonthYearPicker period={period} onChange={setPeriod} showMonth={mode !== "year"} />
      </FilterBar>
      <TableCard minWidth={1050}>
        <thead>
          <HeadRow>
            <Th>القسم</Th>
            <Th num>إيراد مخطط</Th>
            <Th num>إيراد فعلي</Th>
            <Th num>الانحراف</Th>
            <Th num>مصروف مخطط</Th>
            <Th num>مصروف فعلي</Th>
            <Th num>الانحراف</Th>
            <Th num>ربح مخطط</Th>
            <Th num>ربح فعلي</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rv = pct(r.act.revenue, r.plan.revenue);
            const ev = pct(r.act.expense, r.plan.expense);
            return (
              <tr key={r.dept} className="border-b last:border-0 hover:bg-muted/40">
                <Td><DeptBadge id={r.dept} /></Td>
                <Td num>{money(r.plan.revenue)}</Td>
                <Td num className="font-semibold text-income">{money(r.act.revenue)}</Td>
                <Td num className={cn("text-xs", rv !== null && (rv < 0 ? "text-destructive" : "text-income"))}>{rv === null ? "—" : `${rv > 0 ? "+" : ""}${rv}٪`}</Td>
                <Td num>{money(r.plan.expense)}</Td>
                <Td num className="font-semibold text-expense">{money(r.act.expense)}</Td>
                <Td num className={cn("text-xs", ev !== null && (ev > 0 ? "text-destructive" : "text-income"))}>{ev === null ? "—" : `${ev > 0 ? "+" : ""}${ev}٪`}</Td>
                <Td num>{money(r.plan.revenue - r.plan.expense)}</Td>
                <Td num className={cn("font-bold", r.act.revenue - r.act.expense < 0 ? "text-destructive" : "text-primary")}>{money(r.act.revenue - r.act.expense)}</Td>
                <Td>{canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(r.dept)}><Pencil /> الموازنة</Button>}</Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={10} text="لا توجد موازنة أو حركات لهذه الفترة." />}
          {rows.length > 0 && (
            <tr className="bg-secondary/60 font-bold">
              <Td>الإجمالي</Td>
              <Td num>{money(t.pr)}</Td>
              <Td num>{money(t.ar)}</Td>
              <Td />
              <Td num>{money(t.pe)}</Td>
              <Td num>{money(t.ae)}</Td>
              <Td />
              <Td num>{money(t.pr - t.pe)}</Td>
              <Td num>{money(t.ar - t.ae)}</Td>
              <Td />
            </tr>
          )}
        </tbody>
      </TableCard>
      <p className="mt-2 text-[11px] text-muted-foreground">انحراف الإيراد بالسالب = أقل من المتوقع؛ انحراف المصروف بالموجب = صرف أكثر من المخطط.</p>
      {editing && (
        <BudgetDialog
          key={`${editing}-${year}`}
          year={year}
          budget={budgets.find((b) => b.department === editing) ?? { year, department: editing, revenue: Array(12).fill(0), expense: Array(12).fill(0) }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetDialog({ year, budget, onClose }: { year: number; budget: Budget; onClose: () => void }) {
  const { departments } = useHospitalDB();
  const [rev, setRev] = useState(budget.revenue.map(String));
  const [exp, setExp] = useState(budget.expense.map(String));
  const [annualRev, setAnnualRev] = useState("");
  const [annualExp, setAnnualExp] = useState("");
  const spread = (v: string) => Array.from({ length: 12 }, () => String(Math.round(((Number(v) || 0) / 12) * 100) / 100));
  const save = () => {
    if (saveBudget({ year, department: budget.department, revenue: rev.map(Number), expense: exp.map(Number) })) {
      toast.success("تم حفظ الموازنة.");
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-2xl">موازنة {findDepartment(departments, budget.department).name} — {int(year)}</DialogTitle>
          <DialogDescription>اكتب المتوقع لكل شهر، أو اكتب الرقم السنوي ووزعه بالتساوي.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <Input type="number" min="0" placeholder="إيراد سنوي" aria-label="إيراد سنوي" value={annualRev} onChange={(e) => setAnnualRev(e.target.value)} />
            <Button variant="outline" size="sm" onClick={() => setRev(spread(annualRev))}>وزّع الإيراد</Button>
          </div>
          <div className="flex items-end gap-2">
            <Input type="number" min="0" placeholder="مصروف سنوي" aria-label="مصروف سنوي" value={annualExp} onChange={(e) => setAnnualExp(e.target.value)} />
            <Button variant="outline" size="sm" onClick={() => setExp(spread(annualExp))}>وزّع المصروف</Button>
          </div>
        </div>
        <TableCard minWidth={520}>
          <thead><HeadRow><Th>الشهر</Th><Th num>الإيراد المتوقع</Th><Th num>المصروف المتوقع</Th></HeadRow></thead>
          <tbody>
            {MONTHS.map((m, i) => (
              <tr key={m} className="border-b last:border-0">
                <Td>{m}</Td>
                <Td><Input type="number" min="0" aria-label={`إيراد ${m}`} className="h-8" value={rev[i]} onChange={(e) => setRev(rev.map((x, j) => (j === i ? e.target.value : x)))} /></Td>
                <Td><Input type="number" min="0" aria-label={`مصروف ${m}`} className="h-8" value={exp[i]} onChange={(e) => setExp(exp.map((x, j) => (j === i ? e.target.value : x)))} /></Td>
              </tr>
            ))}
            <tr className="bg-secondary/60 font-bold">
              <Td>الإجمالي</Td>
              <Td num>{money(sum(rev.map(Number)))}</Td>
              <Td num>{money(sum(exp.map(Number)))}</Td>
            </tr>
          </tbody>
        </TableCard>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save}>حفظ الموازنة</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
