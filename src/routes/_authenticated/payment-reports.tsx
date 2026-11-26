import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Layers, ReceiptText, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";
import { StatCard } from "@/components/hospital/ui";
import { DeptSelect } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { detailView, groupView, ReportShell, SelectFilter, TopCard } from "@/components/hospital/reports/ReportKit";
import { dateLabel, int, money } from "@/lib/hospital/format";
import { TX_SOURCE_LABELS } from "@/lib/hospital/model";
import { paymentsReport, type PaymentLine } from "@/lib/hospital/reports";
import { useHospitalDB } from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/payment-reports")({
  head: () => ({
    meta: [
      { title: "تقارير المدفوعات بالتفصيل | مستشفى الرحمة التخصصي" },
      { name: "description", content: "كل مبلغ خرج من خزائن المستشفى: حسب النوع والبند والقسم والخزينة والمستفيد واليوم، مع تصدير PDF وExcel." },
      { property: "og:title", content: "تقارير المدفوعات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تفصيل مدفوعات المستشفى لأي فترة مع تصدير PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentReportsPage,
});

function PaymentReportsPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth);
  const [department, setDepartment] = useState("all");
  const [source, setSource] = useState("all");
  const [box, setBox] = useState("all");
  const r = useMemo(() => paymentsReport(db, { ...range, department, source, box }), [db, range, department, source, box]);
  const t = r.totals;
  const views = [
    groupView("source", "حسب نوع الصرف", r.bySource, "نوع الصرف"),
    groupView("category", "حسب بند المصروف", r.byCategory, "البند"),
    groupView("dept", "حسب القسم", r.byDepartment, "القسم"),
    groupView("box", "حسب الخزينة", r.byBox, "الخزينة / الحساب"),
    groupView("paidTo", "حسب المستفيد", r.byPaidTo, "المستفيد"),
    groupView("day", "يومي", r.byDay, "اليوم", { dates: true }),
    detailView<PaymentLine>("detail", "تفصيل المدفوعات", r.lines, [
      { label: "التاريخ", get: (l) => dateLabel(l.date) },
      { label: "رقم المستند", get: (l) => l.number },
      { label: "البيان", get: (l) => l.description, wide: true },
      { label: "النوع", get: (l) => l.sourceLabel },
      { label: "البند", get: (l) => l.categoryLabel },
      { label: "القسم", get: (l) => l.departmentName },
      { label: "الخزينة", get: (l) => l.boxName },
      { label: "المستفيد", get: (l) => l.paidTo },
      { label: "بواسطة", get: (l) => l.by || "—" },
      { label: "المبلغ", get: (l) => l.amount, money: true },
    ]),
  ];
  const facts: [string, string][] = [
    ["إجمالي المدفوعات", money(t.total)],
    ["عدد المستندات", int(t.count)],
    ["متوسط الصرف في اليوم", money(t.perDay)],
    ["أكبر بند صرف", t.largest],
    ...r.bySource.map((g): [string, string] => [g.label, money(g.total)]),
  ];
  const sources = [...new Set(db.transactions.filter((x) => x.kind === "out" && x.source !== "shift").map((x) => x.source))];

  return (
    <ReportShell
      eyebrow="التقارير التفصيلية"
      title="تقارير المدفوعات"
      description="كل جنيه خرج من الخزائن والبنوك: مصروفات، موردين، أطباء، رواتب، أوامر صرف، مرتجعات، سلف ونثريات — حسب النوع والبند والقسم والمستفيد."
      fileBase="تقرير-المدفوعات"
      from={range.from}
      to={range.to}
      summaryFacts={facts}
      views={views}
      filters={
        <>
          <RangePicker value={range} onChange={setRange} />
          <DeptSelect value={department} onChange={setDepartment} allowAll className="w-52" />
          <SelectFilter label="نوع الصرف" value={source} onChange={setSource} allLabel="كل الأنواع" options={sources.map((s) => [s, TX_SOURCE_LABELS[s] ?? s])} />
          <SelectFilter label="الخزينة" value={box} onChange={setBox} allLabel="كل الخزائن والبنوك" options={db.cashboxes.map((b) => [b.id, b.name])} />
        </>
      }
      summary={
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="إجمالي المدفوعات" value={money(t.total)} icon={TrendingDown} tone="expense" />
            <StatCard label="عدد المستندات" value={int(t.count)} icon={ReceiptText} />
            <StatCard label="متوسط الصرف اليومي" value={money(t.perDay)} icon={CalendarDays} tone="copper" />
            <StatCard label="أكبر بند" value={t.largest} icon={Layers} tone="primary" />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <TopCard title="حسب نوع الصرف" rows={r.bySource} />
            <TopCard title="أكبر البنود" rows={r.byCategory} />
            <TopCard title="أكبر المستفيدين" rows={r.byPaidTo} />
          </div>
        </div>
      }
    />
  );
}
