import { Link } from "@tanstack/react-router";
import { ArrowLeft, Landmark, Vault } from "lucide-react";
import { useMemo } from "react";
import { useJournal } from "@/components/hospital/accounting/drill";
import { boxBalance } from "@/lib/hospital/finance";
import { dateLabel, money, monthLabel } from "@/lib/hospital/format";
import { dashboardTotals, type PeriodTotals } from "@/lib/hospital/income-expense";
import { MAIN_BOX_ID, isBank } from "@/lib/hospital/model";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

const yearFmt = new Intl.NumberFormat("ar-EG", { useGrouping: false });

/**
 * Dashboard money summary: what is left in the main treasury now, and revenue / expenses /
 * petty cash / net for today, this month and this year — the same figures as the
 * revenues & expenses page and the income statement.
 */
export function MoneyAtAGlance({ today, showTreasury, showTotals }: { today: string; showTreasury: boolean; showTotals: boolean }) {
  const db = useHospitalDB();
  const { entries } = useJournal(today);
  const totals = useMemo(() => dashboardTotals(entries, today), [entries, today]);
  const cash = boxBalance(MAIN_BOX_ID, db.transactions, db.transfers);
  const banks = db.cashboxes.filter((b) => isBank(b) && b.active);
  const bankTotal = banks.reduce((s, b) => s + boxBalance(b.id, db.transactions, db.transfers), 0);
  if (!showTreasury && !showTotals) return null;

  const periods: { key: keyof typeof totals; title: string; sub: string }[] = [
    { key: "day", title: "اليوم", sub: dateLabel(today) },
    { key: "month", title: "هذا الشهر", sub: monthLabel(today.slice(0, 7)) },
    { key: "year", title: "هذه السنة", sub: `من أول يناير ${yearFmt.format(Number(today.slice(0, 4)))}` },
  ];

  return (
    <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {showTreasury && (
        <div className="ledger-card relative overflow-hidden p-5 lg:row-span-1">
          <span className="absolute inset-x-0 top-0 h-1 bg-primary" />
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-muted-foreground">الباقي في الخزينة الرئيسية</p>
            <span className="stat-icon text-primary">
              <Vault className="size-4.5" />
            </span>
          </div>
          <p className={cn("num mt-2 font-display text-3xl font-bold", cash < 0 ? "text-expense" : "text-primary")}>{money(cash)}</p>
          <p className="text-xs text-muted-foreground">جنيه مصري — نقدي</p>
          {banks.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
              <Landmark className="size-3.5" /> في البنوك: <strong className="num text-foreground">{money(bankTotal)}</strong>
            </p>
          )}
          <Link to="/treasury" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            حركة الخزينة <ArrowLeft className="size-3.5" />
          </Link>
        </div>
      )}
      {showTotals &&
        periods.map((p) => <PeriodCard key={p.key} title={p.title} sub={p.sub} t={totals[p.key]} />)}
      {showTotals && (
        <Link
          to="/revenues-expenses"
          className="flex items-center justify-center gap-1 text-xs font-semibold text-primary hover:underline sm:col-span-2 lg:col-span-4"
        >
          التفاصيل الكاملة في صفحة الإيرادات والمصروفات والنثريات <ArrowLeft className="size-3.5" />
        </Link>
      )}
    </section>
  );
}

function PeriodCard({ title, sub, t }: { title: string; sub: string; t: PeriodTotals }) {
  const rows = [
    { label: "الإيراد", value: t.revenue, cls: "text-income" },
    { label: "المصروف (بدون النثريات)", value: t.expenses, cls: "text-expense" },
    { label: "النثريات", value: t.petty, cls: "text-copper" },
  ];
  return (
    <div className="ledger-card lift p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        <span className="num text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <dl className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn("num font-semibold", r.cls)}>{money(r.value)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <dt className="text-xs text-muted-foreground">إجمالي المصروف</dt>
          <dd className="num text-xs font-semibold">{money(t.totalExpenses)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="font-semibold">الصافي</dt>
          <dd className={cn("num font-display text-lg font-bold", t.net >= 0 ? "text-income" : "text-expense")}>{money(t.net)}</dd>
        </div>
      </dl>
    </div>
  );
}
