import { createFileRoute } from "@tanstack/react-router";
import { FileDown, ListTree, PieChart, Share2, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DrillProvider, useDrill, useJournal } from "@/components/hospital/accounting/drill";
import { costCenterLines, ENTRY_SOURCE_LABELS, typeOf } from "@/lib/hospital/ledger";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, FilterBar, HeadRow, MonthYearPicker, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { findDepartment } from "@/lib/hospital/constants";
import { allocateSharedCosts, costCenters } from "@/lib/hospital/finance";
import { dbForBranch } from "@/lib/hospital/branches";
import { BranchSelect } from "@/components/hospital/BranchSelect";
import { dateLabel, int, isoDate, lastDayOfPeriod, money, monthLabel, periodOf } from "@/lib/hospital/format";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cost-centers")({
  head: () => ({
    meta: [
      { title: "مراكز التكلفة والربحية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "إيرادات ومصروفات وإهلاك وصافي ربح كل قسم في المستشفى شهريًا أو سنويًا، وأكثر الأقسام ربحًا وتكلفة.",
      },
      { property: "og:title", content: "مراكز التكلفة والربحية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "ربحية كل قسم: الإيرادات مقابل التكاليف والإهلاك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostCentersPage,
});

function CostCentersPage() {
  const db = useHospitalDB();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const pdf = usePdfExport();
  const prefix = mode === "year" ? period.slice(0, 4) : period;
  const label = mode === "year" ? `سنة ${int(Number(prefix))}` : `شهر ${monthLabel(prefix)}`;
  const [branch, setBranch] = useState("all");
  const r = useMemo(() => {
    const b = dbForBranch(db, branch);
    return costCenters(
      {
        invoices: b.patientInvoices,
        supplierInvoices: b.supplierInvoices,
        transactions: b.transactions,
        assets: b.assets,
      },
      prefix,
      db.departments.map((d) => d.id),
    );
  }, [db.patientInvoices, db.supplierInvoices, db.transactions, db.assets, db.departments, db.cashboxes, prefix, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => findDepartment(db.departments, id).name;
  const [allocate, setAllocate] = useState(false);
  const [drill, setDrill] = useState<string | null>(null);
  const from = mode === "year" ? `${prefix}-01-01` : `${prefix}-01`;
  const to = mode === "year" ? `${prefix}-12-31` : lastDayOfPeriod(prefix);
  const journal = useJournal(to);
  const shared = useMemo(
    () => new Set(db.departments.filter((d) => d.group === "admin" || d.group === "services" || d.id === "general").map((d) => d.id)),
    [db.departments],
  );
  const alloc = useMemo(() => allocateSharedCosts(r.rows, shared), [r.rows, shared]);
  const allocOf = (dept: string) => alloc.rows.find((x) => x.dept === dept);
  const maxRevenue = Math.max(1, ...r.rows.map((x) => Math.max(x.revenue, x.expenses)));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="التقارير"
        title="مراكز التكلفة والربحية"
        description="كل قسم مركز تكلفة: إيراداته من إيصالات المرضى (نصيب المريض والتأمين)، ومصروفاته من الموردين والرواتب والأطباء والمصروفات والنثريات وأوامر الصرف، وإهلاك أصوله."
        actions={
          <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`مراكز-التكلفة-${prefix}.pdf`, "تم تصدير تقرير مراكز التكلفة.")}>
            <FileDown /> تصدير PDF
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي الإيرادات" value={money(r.totals.revenue)} icon={TrendingUp} tone="income" hint="ج.م" />
        <StatCard label="إجمالي التكاليف" value={money(r.totals.expenses)} icon={TrendingDown} tone="expense" hint="ج.م" />
        <StatCard
          label="صافي الربح"
          value={money(r.totals.profit)}
          icon={PieChart}
          tone={r.totals.profit >= 0 ? "primary" : "expense"}
          hint={r.totals.revenue ? `هامش ${money((r.totals.profit / r.totals.revenue) * 100)}%` : "ج.م"}
        />
        <StatCard
          label="أعلى قسم ربحًا"
          value={r.mostProfitable ? name(r.mostProfitable.dept) : "—"}
          icon={Trophy}
          tone="copper"
          hint={r.highestExpense ? `أعلى تكلفة: ${name(r.highestExpense.dept)}` : undefined}
        />
      </div>

      <FilterBar>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "month" | "year")} dir="rtl">
          <TabsList>
            <TabsTrigger value="month">شهري</TabsTrigger>
            <TabsTrigger value="year">سنوي</TabsTrigger>
          </TabsList>
        </Tabs>
        <MonthYearPicker period={period} onChange={setPeriod} showMonth={mode === "month"} />
        <BranchSelect value={branch} onChange={setBranch} />
        <label className="flex items-center gap-2 text-sm md:ms-auto">
          <Switch checked={allocate} onCheckedChange={setAllocate} aria-label="توزيع التكاليف المشتركة" />
          <Share2 className="size-4 text-primary" />
          توزيع تكاليف الإدارات والخدمات المعاونة على الأقسام (بنسبة الإيراد)
        </label>
      </FilterBar>
      {allocate && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          مجمع التكاليف المشتركة {money(alloc.pool)} ج.م يُحمّل على الأقسام المنتجة للإيراد حسب نصيب كل قسم من الإيرادات، ليظهر الربح الحقيقي لكل قسم.
        </p>
      )}

      <TableCard minWidth={1100}>
        <thead>
          <HeadRow>
            <Th>القسم</Th>
            <Th num>الإيرادات</Th>
            <Th num>موردين</Th>
            <Th num>رواتب</Th>
            <Th num>أطباء</Th>
            <Th num>مصروفات أخرى</Th>
            <Th num>إهلاك</Th>
            <Th num>إجمالي التكلفة</Th>
            <Th num>صافي الربح</Th>
            {allocate && <Th num>نصيب التكاليف المشتركة</Th>}
            {allocate && <Th num>الربح بعد التوزيع</Th>}
            <Th num>الهامش</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.dept} className="border-b last:border-0 hover:bg-muted/50">
              <Td>
                <DeptBadge id={x.dept} />
                <div className="mt-1.5 flex h-1.5 w-32 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="bg-income" style={{ width: `${(x.revenue / maxRevenue) * 100}%` }} />
                </div>
                <div className="mt-0.5 flex h-1.5 w-32 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="bg-expense" style={{ width: `${(x.expenses / maxRevenue) * 100}%` }} />
                </div>
              </Td>
              <Td num className="font-semibold text-income">{money(x.revenue)}</Td>
              <Td num>{money(x.supplies)}</Td>
              <Td num>{money(x.payroll)}</Td>
              <Td num>{money(x.doctors)}</Td>
              <Td num>{money(x.other)}</Td>
              <Td num>{money(x.depreciation)}</Td>
              <Td num className="font-semibold text-expense">{money(x.expenses)}</Td>
              <Td num className={cn("font-bold", x.profit < 0 ? "text-destructive" : "text-primary")}>{money(x.profit)}</Td>
              {allocate && (
                <Td num className="text-copper">
                  {shared.has(x.dept) ? <span title="تم توزيع تكلفته على الأقسام">({money(-(allocOf(x.dept)?.allocated ?? 0))})</span> : money(allocOf(x.dept)?.allocated ?? 0)}
                </Td>
              )}
              {allocate && (
                <Td num className={cn("font-bold", (allocOf(x.dept)?.afterAllocation ?? 0) < 0 ? "text-destructive" : "text-primary")}>
                  {money(allocOf(x.dept)?.afterAllocation ?? 0)}
                </Td>
              )}
              <Td num className="text-xs">{x.margin === null ? "—" : `${money(x.margin)}%`}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setDrill(x.dept)} aria-label={`قيود ${name(x.dept)}`}>
                  <ListTree /> القيود
                </Button>
              </Td>
            </tr>
          ))}
          {!r.rows.length && <EmptyRow cols={allocate ? 13 : 11} text="لا توجد إيرادات أو مصروفات في هذه الفترة." />}
          {r.rows.length > 0 && (
            <tr className="bg-secondary/60 font-bold">
              <Td>الإجمالي</Td>
              <Td num>{money(r.totals.revenue)}</Td>
              <Td num colSpan={5} />
              <Td num>{money(r.totals.expenses)}</Td>
              <Td num>{money(r.totals.profit)}</Td>
              {allocate && <Td />}
              {allocate && <Td num>{money(alloc.rows.reduce((t, x) => t + x.afterAllocation, 0))}</Td>}
              <Td colSpan={2} />
            </tr>
          )}
        </tbody>
      </TableCard>
      <p className="mt-2 text-[11px] text-muted-foreground">
        التحويلات بين الخزائن وتغذية النثريات لا تُحسب تكلفة — التكلفة تُحسب فقط عند الصرف الفعلي.
      </p>

      <DrillProvider entries={journal.entries}>
        <CostCenterSheet dept={drill} from={from} to={to} onClose={() => setDrill(null)} />
      </DrillProvider>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title="تقرير مراكز التكلفة والربحية" subtitle={label} issuedOn={dateLabel(isoDate(new Date()))}>
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>القسم</th>
              <th>الإيرادات</th>
              <th>التكاليف</th>
              <th>منها إهلاك</th>
              <th>صافي الربح</th>
              <th>الهامش</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.dept} data-pdf-break>
                <td className="text-start">{name(x.dept)}</td>
                <td>{money(x.revenue)}</td>
                <td>{money(x.expenses)}</td>
                <td>{money(x.depreciation)}</td>
                <td>{money(x.profit)}</td>
                <td>{x.margin === null ? "—" : `${money(x.margin)}%`}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td className="text-start">الإجمالي</td>
              <td>{money(r.totals.revenue)}</td>
              <td>{money(r.totals.expenses)}</td>
              <td>{money(r.totals.depreciation)}</td>
              <td>{money(r.totals.profit)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["المحاسب", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function CostCenterSheet({ dept, from, to, onClose }: { dept: string | null; from: string; to: string; onClose: () => void }) {
  const db = useHospitalDB();
  const { openEntry } = useDrill();
  const { entries, name } = useJournal(to);
  const lines = useMemo(() => (dept ? costCenterLines(entries, dept, from, to) : []), [entries, dept, from, to]);
  const rev = lines.filter((l) => typeOf(l.line.account) === "revenue").reduce((s, l) => s + l.line.credit - l.line.debit, 0);
  const exp = lines.filter((l) => typeOf(l.line.account) === "expense").reduce((s, l) => s + l.line.debit - l.line.credit, 0);
  return (
    <Sheet open={!!dept} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="text-right">
          <SheetTitle className="font-display text-2xl">قيود مركز التكلفة: {dept ? findDepartment(db.departments, dept).name : ""}</SheetTitle>
          <SheetDescription>
            من {dateLabel(from)} إلى {dateLabel(to)} — إيرادات {money(rev)} • مصروفات {money(exp)} (القيود بدون ضريبة المدخلات القابلة للخصم). اضغط أي سطر لفتح القيد.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <TableCard minWidth={620}>
            <thead>
              <HeadRow>
                <Th>التاريخ</Th>
                <Th>المستند</Th>
                <Th>الحساب</Th>
                <Th num>إيراد</Th>
                <Th num>مصروف</Th>
              </HeadRow>
            </thead>
            <tbody>
              {lines.map((x, i) => (
                <tr key={`${x.entry.id}-${i}`} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => openEntry(x.entry)}>
                  <Td num className="text-right">{dateLabel(x.entry.date)}</Td>
                  <Td className="font-mono text-xs">
                    <span dir="ltr">{x.entry.number}</span>
                    <p className="max-w-52 truncate font-sans text-[11px] text-muted-foreground">{ENTRY_SOURCE_LABELS[x.entry.source]} — {x.entry.description}</p>
                  </Td>
                  <Td className="text-xs">{name(x.line.account)}</Td>
                  <Td num className="text-income">{typeOf(x.line.account) === "revenue" ? money(x.line.credit - x.line.debit) : ""}</Td>
                  <Td num className="text-expense">{typeOf(x.line.account) === "expense" ? money(x.line.debit - x.line.credit) : ""}</Td>
                </tr>
              ))}
              {!lines.length && <EmptyRow cols={5} text="لا توجد قيود لهذا المركز في الفترة." />}
            </tbody>
          </TableCard>
          <p className="mt-2 text-[11px] text-muted-foreground">{int(lines.length)} سطر قيد</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
