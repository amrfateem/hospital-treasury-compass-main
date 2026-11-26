import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgePercent, CheckCircle2, HandCoins, Receipt, TrendingUp, TriangleAlert, Undo2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { StatCard } from "@/components/hospital/ui";
import { DeptSelect } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { useJournal } from "@/components/hospital/accounting/drill";
import { detailView, groupView, ReportShell, SelectFilter, TopCard } from "@/components/hospital/reports/ReportKit";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, money } from "@/lib/hospital/format";
import { revenueExpenseReport } from "@/lib/hospital/income-expense";
import { revenueReport, type RevenueLine } from "@/lib/hospital/reports";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/revenue-reports")({
  head: () => ({
    meta: [
      { title: "تقارير الإيرادات بالتفصيل | مستشفى الرحمة التخصصي" },
      { name: "description", content: "إيرادات المستشفى حسب القسم والخدمة والطبيب وطريقة الدفع والمحصِّل واليوم، مع تفصيل كل إيصال وتصدير PDF وExcel." },
      { property: "og:title", content: "تقارير الإيرادات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تفصيل إيرادات المستشفى لأي فترة مع تصدير PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevenueReportsPage,
});

function RevenueReportsPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth);
  const [department, setDepartment] = useState("all");
  const [method, setMethod] = useState("all");
  const r = useMemo(() => revenueReport(db, { ...range, department, method }), [db, range, department, method]);
  const { entries, accounts } = useJournal(range.to);
  const ledgerRevenue = useMemo(
    () => revenueExpenseReport(entries, accounts, range.from, range.to, (id) => findDepartment(db.departments, id).name).revenue.total,
    [entries, accounts, range.from, range.to, db.departments],
  );
  const filtered = department !== "all" || method !== "all";
  const t = r.totals;
  const views = [
    groupView("dept", "حسب القسم", r.byDepartment, "القسم", { amount: "صافي الإيراد" }),
    groupView("service", "حسب الخدمة", r.byService, "الخدمة — القسم", { qty: "الكمية", amount: "القيمة قبل الخصم" }),
    groupView("doctor", "حسب الطبيب", r.byDoctor, "الطبيب", { amount: "صافي الإيراد" }),
    groupView("method", "حسب طريقة الدفع", r.byMethod, "طريقة الدفع", { amount: "المدفوع" }),
    groupView("cashier", "حسب الموظف المحصِّل", r.byCashier, "الموظف", { amount: "المحصَّل" }),
    groupView("day", "يومي", r.byDay, "اليوم", { amount: "صافي الإيراد", dates: true }),
    detailView<RevenueLine>("detail", "تفصيل الإيصالات", r.lines, [
      { label: "التاريخ", get: (l) => dateLabel(l.date) },
      { label: "رقم الإيصال", get: (l) => l.number },
      { label: "المريض", get: (l) => l.patient },
      { label: "القسم", get: (l) => l.departmentName },
      { label: "الطبيب", get: (l) => l.doctor || "—" },
      { label: "الخدمات", get: (l) => l.services, wide: true },
      { label: "الإجمالي", get: (l) => l.subtotal, money: true },
      { label: "الخصم", get: (l) => l.discount, money: true },
      { label: "الصافي", get: (l) => l.total, money: true },
      { label: "نصيب التأمين", get: (l) => l.insurer, money: true },
      { label: "المدفوع", get: (l) => l.paid, money: true },
      { label: "المتبقي / آجل", get: (l) => l.remaining, money: true },
      { label: "طريقة الدفع", get: (l) => l.method },
      { label: "المحصِّل", get: (l) => l.cashier },
    ]),
    detailView("refunds", "المرتجعات", r.refunds, [
      { label: "التاريخ", get: (x) => dateLabel(x.paidOn ?? x.date) },
      { label: "رقم المرتجع", get: (x) => x.number },
      { label: "الإيصال الأصلي", get: (x) => x.invoiceNumber },
      { label: "المريض", get: (x) => x.patientName },
      { label: "القسم", get: (x) => findDepartment(db.departments, x.department).name },
      { label: "السبب", get: (x) => x.reason, wide: true },
      { label: "المبلغ", get: (x) => x.amount, money: true },
    ]),
  ];
  const facts: [string, string][] = [
    ["عدد الإيصالات", int(t.count)],
    ["إجمالي الخدمات قبل الخصم", money(t.gross)],
    ["الخصومات", money(t.discount)],
    ["صافي الإيصالات", money(t.net)],
    ["نصيب التأمين والتعاقدات", money(t.insurer)],
    ["المدفوع من المرضى", money(t.paid)],
    ["المتبقي على المرضى / آجل", money(t.remaining)],
    ["المرتجعات المصروفة", money(t.refunds)],
    ["صافي الإيراد بعد المرتجعات", money(t.netAfterRefunds)],
    ["تحصيلات التأمين والآجل في الفترة", money(t.collections)],
  ];
  const matches = Math.abs(ledgerRevenue - t.netAfterRefunds) < 0.01;

  return (
    <ReportShell
      eyebrow="التقارير التفصيلية"
      title="تقارير الإيرادات"
      description="كل جنيه دخل المستشفى من الإيصالات: حسب القسم والخدمة والطبيب وطريقة الدفع والموظف واليوم، وكل إيصال بتفاصيله."
      fileBase="تقرير-الإيرادات"
      from={range.from}
      to={range.to}
      summaryFacts={facts}
      views={views}
      filters={
        <>
          <RangePicker value={range} onChange={setRange} />
          <DeptSelect value={department} onChange={setDepartment} allowAll className="w-52" />
          <SelectFilter label="طريقة الدفع" value={method} onChange={setMethod} allLabel="كل طرق الدفع" options={db.lists.paymentMethods.map((m) => [m.id, m.name])} />
        </>
      }
      summary={
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="صافي الإيصالات" value={money(t.net)} icon={TrendingUp} tone="income" hint={`${int(t.count)} إيصال`} />
            <StatCard label="المدفوع من المرضى" value={money(t.paid)} icon={Wallet} tone="primary" />
            <StatCard label="نصيب التأمين" value={money(t.insurer)} icon={BadgePercent} tone="copper" />
            <StatCard label="المتبقي على المرضى" value={money(t.remaining)} icon={HandCoins} />
            <StatCard label="الخصومات" value={money(t.discount)} icon={Receipt} tone="expense" />
            <StatCard label="المرتجعات" value={money(t.refunds)} icon={Undo2} tone="expense" />
            <StatCard label="صافي الإيراد بعد المرتجعات" value={money(t.netAfterRefunds)} icon={TrendingUp} tone="income" />
            <StatCard label="تحصيلات تأمين وآجل" value={money(t.collections)} icon={HandCoins} hint="فلوس داخلة عن إيصالات سابقة" />
          </div>
          {!filtered && (
            <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm", matches ? "border-income/30 bg-income/5" : "border-copper/40 bg-copper/5")}>
              <span className={cn("flex items-center gap-1.5 font-semibold", matches ? "text-income" : "text-copper")}>
                {matches ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
                {matches ? "مطابق لإيرادات دفتر الأستاذ لنفس الفترة" : `إيرادات دفتر الأستاذ ${money(ledgerRevenue)} — الفرق ${money(ledgerRevenue - t.netAfterRefunds)} (قيود يدوية أو إيرادات أخرى)`}
              </span>
              <Link to="/revenues-expenses" className="drill-link text-xs">فتح إدارة الإيرادات والمصروفات</Link>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <TopCard title="أعلى الأقسام إيرادًا" rows={r.byDepartment} />
            <TopCard title="أعلى الخدمات" rows={r.byService} />
            <TopCard title="حسب طريقة الدفع" rows={r.byMethod} />
          </div>
        </div>
      }
    />
  );
}
