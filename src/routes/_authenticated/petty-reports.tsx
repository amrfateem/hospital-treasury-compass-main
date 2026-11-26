import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Coins, Hourglass, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { StatCard } from "@/components/hospital/ui";
import { DeptSelect, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { detailView, groupView, ReportShell, SelectFilter, TopCard } from "@/components/hospital/reports/ReportKit";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, money } from "@/lib/hospital/format";
import { listLabel, ORDER_STATUS_LABELS, type PettyRequest } from "@/lib/hospital/model";
import { pettyReport, type PettyLine } from "@/lib/hospital/reports";
import { useHospitalDB } from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/petty-reports")({
  head: () => ({
    meta: [
      { title: "تقارير النثريات بالتفصيل | مستشفى الرحمة التخصصي" },
      { name: "description", content: "النثريات المصروفة وطلباتها: حسب البند والقسم ومقدم الطلب والخزينة والشهر، مع مسار الاعتماد وتصدير PDF وExcel." },
      { property: "og:title", content: "تقارير النثريات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تفصيل النثريات وطلباتها لأي فترة مع تصدير PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PettyReportsPage,
});

const stamp = (ms?: number) => (ms ? new Date(ms).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "");

function PettyReportsPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth);
  const [department, setDepartment] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const r = useMemo(() => pettyReport(db, { ...range, department, category, status }), [db, range, department, category, status]);
  const t = r.totals;
  const views = [
    groupView("category", "حسب البند", r.byCategory, "بند النثريات"),
    groupView("dept", "حسب القسم", r.byDepartment, "القسم"),
    groupView("requester", "حسب مقدم الطلب", r.byRequester, "مقدم الطلب"),
    groupView("box", "حسب الخزينة", r.byBox, "الخزينة"),
    groupView("month", "شهري", r.byMonth, "الشهر", { dates: true }),
    groupView("day", "يومي", r.byDay, "اليوم", { dates: true }),
    detailView<PettyLine>("detail", "تفصيل المصروف", r.lines, [
      { label: "التاريخ", get: (l) => dateLabel(l.date) },
      { label: "رقم المستند", get: (l) => l.number },
      { label: "رقم الطلب", get: (l) => l.requestNumber || "صرف مباشر" },
      { label: "البيان", get: (l) => l.description, wide: true },
      { label: "البند", get: (l) => l.categoryLabel },
      { label: "القسم", get: (l) => l.departmentName },
      { label: "مقدم الطلب", get: (l) => l.requestedBy },
      { label: "المستلم", get: (l) => l.paidTo },
      { label: "صرف بواسطة", get: (l) => l.by || "—" },
      { label: "المبلغ", get: (l) => l.amount, money: true },
    ]),
    detailView<PettyRequest>("requests", "الطلبات ومسار الاعتماد", r.requests, [
      { label: "التاريخ", get: (q) => dateLabel(q.date) },
      { label: "رقم الطلب", get: (q) => q.number },
      { label: "البيان", get: (q) => q.description, wide: true },
      { label: "البند", get: (q) => listLabel(db.lists.pettyCategories, q.category) },
      { label: "القسم", get: (q) => findDepartment(db.departments, q.department).name },
      { label: "مقدم الطلب", get: (q) => q.requestedBy },
      { label: "الحالة", get: (q) => ORDER_STATUS_LABELS[q.status] },
      { label: "القرار", get: (q) => (q.decidedBy ? `${q.decidedBy} ${stamp(q.decidedAt)}${q.decisionNote ? ` — ${q.decisionNote}` : ""}` : "—"), wide: true },
      { label: "الصرف", get: (q) => (q.paidBy ? `${q.paidBy} ${q.paidOn ? dateLabel(q.paidOn) : ""}` : "—") },
      { label: "المبلغ", get: (q) => q.amount, money: true },
    ]),
  ];
  const facts: [string, string][] = [
    ["إجمالي النثريات المصروفة", money(t.total)],
    ["عدد عمليات الصرف", int(t.count)],
    ["متوسط العملية", money(t.average)],
    ...r.byStatus.map((s): [string, string] => [`طلبات: ${s.label}`, `${int(s.count)} — ${money(s.amount)}`]),
  ];

  return (
    <ReportShell
      eyebrow="التقارير التفصيلية"
      title="تقارير النثريات"
      description="كل مصروف نثري خرج من الخزينة وكل طلب نثريات واعتماده: حسب البند والقسم ومقدم الطلب والخزينة والشهر."
      fileBase="تقرير-النثريات"
      from={range.from}
      to={range.to}
      summaryFacts={facts}
      views={views}
      filters={
        <>
          <RangePicker value={range} onChange={setRange} />
          <DeptSelect value={department} onChange={setDepartment} allowAll className="w-52" />
          <SelectFilter label="البند" value={category} onChange={setCategory} allLabel="كل البنود" options={db.lists.pettyCategories.map((c) => [c.id, c.name])} />
          <SelectFilter label="حالة الطلب" value={status} onChange={setStatus} allLabel="كل الحالات" options={Object.entries(ORDER_STATUS_LABELS)} />
        </>
      }
      summary={
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="النثريات المصروفة" value={money(t.total)} icon={Coins} tone="expense" hint={`${int(t.count)} عملية — متوسط ${money(t.average)}`} />
            <StatCard label="طلبات بانتظار الاعتماد" value={money(t.pending.amount)} icon={Hourglass} tone="copper" hint={`${int(t.pending.count)} طلب`} />
            <StatCard label="معتمدة ولم تُصرف" value={money(t.approved.amount)} icon={CheckCircle2} tone="primary" hint={`${int(t.approved.count)} طلب`} />
            <StatCard label="طلبات مرفوضة" value={money(t.rejected.amount)} icon={XCircle} hint={`${int(t.rejected.count)} طلب`} />
          </div>
          <TableCard minWidth={560}>
            <thead>
              <HeadRow>
                <Th>حالة الطلبات</Th>
                <Th num>العدد</Th>
                <Th num>المبلغ</Th>
              </HeadRow>
            </thead>
            <tbody>
              {r.byStatus.map((s) => (
                <tr key={s.status} className="border-b last:border-0">
                  <Td>{s.label}</Td>
                  <Td num>{int(s.count)}</Td>
                  <Td num>{money(s.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
          <div className="grid gap-6 lg:grid-cols-3">
            <TopCard title="أكبر البنود" rows={r.byCategory} />
            <TopCard title="حسب القسم" rows={r.byDepartment} />
            <TopCard title="حسب مقدم الطلب" rows={r.byRequester} />
          </div>
        </div>
      }
    />
  );
}
