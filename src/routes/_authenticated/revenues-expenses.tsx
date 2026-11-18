import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Coins, FileDown, FileSpreadsheet, Scale, TrendingDown, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, FilterBar, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { useJournal } from "@/components/hospital/accounting/drill";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, isoDate, money, monthLabel } from "@/lib/hospital/format";
import { dailyCashFlow, incomeStatement } from "@/lib/hospital/ledger";
import { revenueExpenseCsv, revenueExpenseReport, type Group } from "@/lib/hospital/income-expense";
import { CashDetails } from "@/components/hospital/finance/CashDetails";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/revenues-expenses")({
  head: () => ({
    meta: [
      { title: "إدارة الإيرادات والمصروفات والنثريات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "كل إيراد ومصروف ونثرية بالتفصيل حسب الحساب والقسم والشهر، مطابقة لقائمة الدخل ومربوطة بالمستند الأصلي.",
      },
      { property: "og:title", content: "الإيرادات والمصروفات والنثريات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تفصيل الإيرادات والمصروفات والنثريات ونتيجة النشاط لأي فترة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevenuesExpensesPage,
});

type Tab = "summary" | "revenue" | "expenses" | "petty";
const TAB_TITLE: Record<Tab, string> = {
  summary: "ملخص الإيرادات والمصروفات والنثريات",
  revenue: "تفصيل الإيرادات",
  expenses: "تفصيل المصروفات",
  petty: "تفصيل النثريات",
};

function RevenuesExpensesPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth);
  const [tab, setTab] = useState<Tab>("summary");
  const { entries, accounts } = useJournal(range.to);
  const centerName = (id: string) => findDepartment(db.departments, id).name;
  const report = useMemo(
    () => revenueExpenseReport(entries, accounts, range.from, range.to, centerName),
    [entries, accounts, range.from, range.to, db.departments], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Cross-check with the income statement and the cash book for the same dates.
  const income = useMemo(() => incomeStatement(entries, range.from, range.to), [entries, range.from, range.to]);
  const cash = useMemo(() => dailyCashFlow(entries, range.from, range.to), [entries, range.from, range.to]);
  const matchesIncome =
    Math.abs(income.totalRevenue - report.revenue.total) < 0.01 && Math.abs(income.totalExpenses - report.totalExpenses) < 0.01;
  const pdf = usePdfExport();
  const scope = `من ${dateLabel(range.from)} إلى ${dateLabel(range.to)}`;

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([revenueExpenseCsv(report, centerName)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `الإيرادات-والمصروفات-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير ملف Excel.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الإدارة المالية"
        title="إدارة الإيرادات والمصروفات والنثريات"
        description="كل جنيه دخل وكل جنيه خرج بالتفصيل: حسب الحساب والقسم والشهر. الأرقام طالعة من نفس قيود اليومية بتاعة القوائم المالية، وأي سطر بيفتح القيد والمستند الأصلي."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <FileSpreadsheet /> Excel
            </Button>
            <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`${TAB_TITLE[tab]}-${range.from}-${range.to}.pdf`, "تم تصدير التقرير.")}>
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير PDF"}
            </Button>
          </>
        }
      />
      <FilterBar>
        <RangePicker value={range} onChange={setRange} />
      </FilterBar>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي الإيرادات" value={money(report.revenue.total)} icon={TrendingUp} tone="income" hint={`${report.revenue.lines.length} قيد`} />
        <StatCard label="المصروفات (بدون النثريات)" value={money(report.expenses.total)} icon={TrendingDown} tone="expense" hint={`${report.expenses.lines.length} قيد`} />
        <StatCard label="النثريات" value={money(report.petty.total)} icon={Coins} tone="copper" hint={`${report.petty.lines.length} عملية صرف`} />
        <StatCard
          label={report.net >= 0 ? "صافي الربح" : "صافي الخسارة"}
          value={money(report.net)}
          icon={Scale}
          tone={report.net >= 0 ? "primary" : "expense"}
          hint={report.revenue.total ? `هامش ${money((report.net / report.revenue.total) * 100)}%` : "ج.م"}
        />
      </div>

      <div
        className={cn(
          "mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border p-3 text-sm",
          matchesIncome ? "border-income/30 bg-income/5" : "border-destructive/40 bg-destructive/5",
        )}
      >
        <span className={cn("flex items-center gap-1.5 font-semibold", matchesIncome ? "text-income" : "text-destructive")}>
          {matchesIncome ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
          {matchesIncome ? "مطابق لقائمة الدخل لنفس الفترة" : "غير مطابق لقائمة الدخل — راجع القيود"}
        </span>
        <span className="text-muted-foreground">
          <Wallet className="ml-1 inline size-4" />
          النقدية والبنوك: أول المدة <b className="num text-foreground">{money(cash.opening)}</b> + داخل{" "}
          <b className="num text-income">{money(cash.inflow)}</b> − خارج <b className="num text-expense">{money(cash.outflow)}</b> = آخر المدة{" "}
          <b className="num text-foreground">{money(cash.closing)}</b>
        </span>
        <Link to="/financial-reports" className="drill-link text-xs">
          فتح القوائم المالية
        </Link>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} dir="rtl">
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="summary">الملخص</TabsTrigger>
          <TabsTrigger value="revenue">الإيرادات بالتفصيل</TabsTrigger>
          <TabsTrigger value="expenses">المصروفات بالتفصيل</TabsTrigger>
          <TabsTrigger value="petty">النثريات بالتفصيل</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="grid gap-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <GroupCard title="الإيرادات حسب الحساب" rows={report.revenue.byAccount} total={report.revenue.total} tone="income" />
            <GroupCard title="المصروفات حسب الحساب" rows={report.expenses.byAccount} total={report.expenses.total} tone="expense" />
            <GroupCard title="النثريات حسب البند" rows={report.petty.byAccount} total={report.petty.total} tone="expense" />
          </div>
          <CentersTable report={report} />
          <MonthsTable months={report.months} />
        </TabsContent>

        <TabsContent value="revenue">
          <CashDetails tab="revenue" from={range.from} to={range.to} ledgerTotal={report.revenue.total} />
        </TabsContent>
        <TabsContent value="expenses">
          <CashDetails tab="expenses" from={range.from} to={range.to} ledgerTotal={report.expenses.total} />
        </TabsContent>
        <TabsContent value="petty">
          <CashDetails tab="petty" from={range.from} to={range.to} ledgerTotal={report.petty.total} />
        </TabsContent>
      </Tabs>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title={TAB_TITLE[tab]} subtitle={scope} issuedOn={dateLabel(isoDate(new Date()))} orientation="landscape">
        {tab === "summary" ? (
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>البند</th>
                <th>العدد</th>
                <th>المبلغ</th>
                <th>النسبة</th>
              </tr>
            </thead>
            <tbody>
              <DocGroup title="الإيرادات" rows={report.revenue.byAccount} total={report.revenue.total} />
              <DocGroup title="المصروفات" rows={report.expenses.byAccount} total={report.expenses.total} />
              <DocGroup title="النثريات" rows={report.petty.byAccount} total={report.petty.total} />
              <tr className="doc-total" data-pdf-break>
                <td colSpan={2} className="text-start">إجمالي المصروفات شاملة النثريات</td>
                <td>{money(report.totalExpenses)}</td>
                <td />
              </tr>
              <tr className="doc-total" data-pdf-break>
                <td colSpan={2} className="text-start">{report.net >= 0 ? "صافي الربح" : "صافي الخسارة"}</td>
                <td>{money(report.net)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>التاريخ</th>
                <th>رقم المستند</th>
                <th>البيان</th>
                <th>الحساب</th>
                <th>مركز التكلفة</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {(tab === "revenue" ? report.revenue : tab === "expenses" ? report.expenses : report.petty).lines.map((l) => (
                <tr key={l.id} data-pdf-break>
                  <td>{dateLabel(l.date)}</td>
                  <td dir="ltr">{l.number}</td>
                  <td className="text-start">{l.description}</td>
                  <td>{l.accountLabel}</td>
                  <td>{l.costCenter ? centerName(l.costCenter) : "—"}</td>
                  <td>{money(l.amount)}</td>
                </tr>
              ))}
              <tr className="doc-total" data-pdf-break>
                <td colSpan={5} className="text-start">الإجمالي</td>
                <td>{money((tab === "revenue" ? report.revenue : tab === "expenses" ? report.expenses : report.petty).total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <SignatureBlock roles={["المحاسب المختص", "المراجع الداخلي", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function GroupCard({ title, rows, total, tone }: { title: string; rows: Group[]; total: number; tone: "income" | "expense" }) {
  return (
    <section className="ledger-card overflow-hidden">
      <h2 className="border-b bg-secondary/60 px-4 py-3 font-bold">{title}</h2>
      {rows.length ? (
        <ul className="divide-y text-sm">
          {rows.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{g.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {g.count} قيد • {Math.round(g.share * 100)}٪
                </span>
              </span>
              <span className={cn("num font-semibold", g.total < 0 && "text-destructive")}>{money(g.total)}</span>
            </li>
          ))}
          <li className={cn("flex items-center justify-between bg-muted/40 px-4 py-2.5 font-bold", tone === "income" ? "text-income" : "text-expense")}>
            <span>الإجمالي</span>
            <span className="num">{money(total)}</span>
          </li>
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">مفيش حركة في الفترة دي.</p>
      )}
    </section>
  );
}

function CentersTable({ report }: { report: ReturnType<typeof revenueExpenseReport> }) {
  const rows = useMemo(() => {
    const map = new Map<string, { id: string; label: string; revenue: number; expenses: number; petty: number }>();
    const add = (gs: Group[], k: "revenue" | "expenses" | "petty") => {
      for (const g of gs) {
        const r = map.get(g.id) ?? { id: g.id, label: g.label, revenue: 0, expenses: 0, petty: 0 };
        r[k] += g.total;
        map.set(g.id, r);
      }
    };
    add(report.revenue.byCenter, "revenue");
    add(report.expenses.byCenter, "expenses");
    add(report.petty.byCenter, "petty");
    return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.expenses - a.expenses);
  }, [report]);
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">حسب القسم (مركز التكلفة)</h2>
      <TableCard minWidth={720}>
        <thead>
          <HeadRow>
            <Th>القسم</Th>
            <Th num>الإيرادات</Th>
            <Th num>المصروفات</Th>
            <Th num>النثريات</Th>
            <Th num>النتيجة</Th>
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((r) => {
            const net = r.revenue - r.expenses - r.petty;
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-medium">{r.label}</Td>
                <Td num className="text-income">{money(r.revenue)}</Td>
                <Td num className="text-expense">{money(r.expenses)}</Td>
                <Td num className="text-expense">{money(r.petty)}</Td>
                <Td num className={cn("font-bold", net < 0 && "text-destructive")}>{money(net)}</Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={5} text="مفيش حركة في الفترة دي." />}
          {rows.length > 0 && (
            <tr className="border-t-2 bg-muted/40 font-bold">
              <Td>الإجمالي</Td>
              <Td num>{money(report.revenue.total)}</Td>
              <Td num>{money(report.expenses.total)}</Td>
              <Td num>{money(report.petty.total)}</Td>
              <Td num>{money(report.net)}</Td>
            </tr>
          )}
        </tbody>
      </TableCard>
      <p className="mt-2 text-xs text-muted-foreground">
        بنود من غير قسم (زي الإهلاك العام أو قيود عامة) بتظهر في سطر «بدون مركز تكلفة» — والتوزيع على الأقسام موجود في صفحة مراكز التكلفة.
      </p>
    </section>
  );
}

function MonthsTable({ months }: { months: ReturnType<typeof revenueExpenseReport>["months"] }) {
  if (months.length < 2) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">شهر بشهر</h2>
      <TableCard minWidth={640}>
        <thead>
          <HeadRow>
            <Th>الشهر</Th>
            <Th num>الإيرادات</Th>
            <Th num>المصروفات شاملة النثريات</Th>
            <Th num>منها نثريات</Th>
            <Th num>النتيجة</Th>
          </HeadRow>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.period} className="border-b last:border-0 hover:bg-muted/50">
              <Td>{monthLabel(m.period)}</Td>
              <Td num className="text-income">{money(m.revenue)}</Td>
              <Td num className="text-expense">{money(m.expenses)}</Td>
              <Td num>{money(m.petty)}</Td>
              <Td num className={cn("font-bold", m.net < 0 && "text-destructive")}>{money(m.net)}</Td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </section>
  );
}

function DocGroup({ title, rows, total }: { title: string; rows: Group[]; total: number }) {
  return (
    <>
      <tr className="doc-subtotal" data-pdf-break>
        <td colSpan={4} className="text-start">{title}</td>
      </tr>
      {rows.map((g) => (
        <tr key={g.id} data-pdf-break>
          <td className="text-start">{g.label}</td>
          <td>{g.count}</td>
          <td>{money(g.total)}</td>
          <td>{Math.round(g.share * 100)}٪</td>
        </tr>
      ))}
      <tr className="doc-subtotal" data-pdf-break>
        <td colSpan={2} className="text-start">إجمالي {title}</td>
        <td>{money(total)}</td>
        <td />
      </tr>
    </>
  );
}
