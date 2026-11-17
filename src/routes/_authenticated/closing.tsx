import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileDown,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  HeadRow,
  MonthYearPicker,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { FiscalYears } from "@/components/hospital/closing/FiscalYears";
import { findDepartment, sortDepartments } from "@/lib/hospital/constants";
import {
  dateLabel,
  int,
  isoDate,
  money,
  monthLabel,
  monthName,
  periodOf,
} from "@/lib/hospital/format";
import { annualClosing, monthlyClosing } from "@/lib/hospital/finance";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/closing")({
  head: () => ({
    meta: [
      { title: "التقفيل الشهري والسنوي وأرشيف السنوات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "تقارير نهاية الفترة: الداخل والخارج لكل قسم شهريًا وملخص ١٢ شهرًا وصافي الربح أو الخسارة سنويًا.",
      },
      { property: "og:title", content: "التقفيل المالي | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "تقفيل شهري وسنوي لكل مراكز التكلفة بالترويسة الرسمية.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClosingPage,
});

function ClosingPage() {
  const db = useHospitalDB();
  const [mode, setMode] = useState<"monthly" | "annual">("monthly");
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const pdf = usePdfExport();
  const year = Number(period.slice(0, 4));
  const annual = mode === "annual";
  const order = sortDepartments(db.departments).map((d) => d.id);
  const getDepartment = (id: string) => findDepartment(db.departments, id);
  const m = monthlyClosing(db.transactions, period, order);
  const a = annualClosing(db.transactions, year, order);
  const totals = annual ? a : m;
  const profit = totals.net >= 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="نهاية الفترة"
        title="التقفيل المالي الشهري والسنوي"
        description="يُبنى من حركة الخزينة (بدون الرصيد الافتتاحي): إيرادات المرضى، الرواتب، المشتريات وكل القيود اليدوية لكل مركز تكلفة."
        actions={
          <Button
            variant="outline"
            disabled={pdf.busy}
            onClick={() =>
              pdf.run(
                annual ? `التقفيل-السنوي-${year}.pdf` : `التقفيل-الشهري-${period}.pdf`,
                annual ? "تم تصدير التقفيل السنوي." : "تم تصدير التقفيل الشهري.",
              )
            }
          >
            <FileDown />{" "}
            {pdf.busy
              ? "جارٍ التصدير..."
              : annual
                ? "تصدير التقفيل السنوي PDF"
                : "تصدير التقفيل الشهري PDF"}
          </Button>
        }
      />

      <FiscalYears
        onShowYear={(y) => {
          setMode("annual");
          setPeriod(`${y}-12`);
        }}
      />

      <div className="ledger-card mb-6 flex flex-wrap items-center gap-2 p-4">
        <div
          className="inline-flex rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="نوع التقفيل"
        >
          {(["monthly", "annual"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                mode === k
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "monthly" ? "تقفيل شهري" : "تقفيل سنوي"}
            </button>
          ))}
        </div>
        <MonthYearPicker period={period} onChange={setPeriod} showMonth={!annual} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="إجمالي الإيرادات (الداخل)"
          value={money(totals.totalIn)}
          icon={ArrowDownLeft}
          tone="income"
        />
        <StatCard
          label="إجمالي المصروفات (الخارج)"
          value={money(totals.totalOut)}
          icon={ArrowUpRight}
          tone="expense"
        />
        <div
          className={cn(
            "ledger-card col-span-2 p-4 lg:col-span-1",
            profit ? "bg-income/5" : "bg-expense/5",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {profit ? "صافي الربح" : "صافي الخسارة"}
            </p>
            {profit ? (
              <TrendingUp className="size-4 text-income" />
            ) : (
              <TrendingDown className="size-4 text-expense" />
            )}
          </div>
          <p className={cn("num mt-2 text-2xl font-bold", profit ? "text-income" : "text-expense")}>
            {money(Math.abs(totals.net))}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {annual ? `السنة المالية ${int(year)}` : monthLabel(period)}
          </p>
        </div>
      </div>

      {annual ? (
        <>
          <h2 className="mb-3 text-xl font-bold">ملخص ١٢ شهرًا</h2>
          <TableCard minWidth={1000}>
            <thead>
              <HeadRow>
                <Th>الشهر</Th>
                {a.depts.map((d) => (
                  <Th key={d} num>
                    {getDepartment(d).name}
                  </Th>
                ))}
                <Th num>الإيرادات</Th>
                <Th num>المصروفات</Th>
                <Th num>الصافي</Th>
              </HeadRow>
            </thead>
            <tbody>
              {a.months.map((mo, i) => (
                <tr key={mo.period} className="border-b last:border-0 hover:bg-muted/50">
                  <Td className="font-semibold">{monthName(i + 1)}</Td>
                  {mo.byDept.map((v, j) => (
                    <Td
                      key={j}
                      num
                      className={cn(v < 0 && "text-expense", v === 0 && "text-muted-foreground")}
                    >
                      {money(v)}
                    </Td>
                  ))}
                  <Td num className="text-income">
                    {money(mo.totalIn)}
                  </Td>
                  <Td num className="text-expense">
                    {money(mo.totalOut)}
                  </Td>
                  <Td num className={cn("font-bold", mo.net < 0 ? "text-expense" : "text-income")}>
                    {money(mo.net)}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-copper/40 bg-accent/60 font-bold text-accent-foreground">
                <Td>الإجمالي السنوي</Td>
                {a.byDept.map((d) => (
                  <Td key={d.dept} num>
                    {money(d.net)}
                  </Td>
                ))}
                <Td num>{money(a.totalIn)}</Td>
                <Td num>{money(a.totalOut)}</Td>
                <Td num>{money(a.net)}</Td>
              </tr>
            </tfoot>
          </TableCard>

          <h2 className="mt-8 mb-3 text-xl font-bold">نتيجة مراكز التكلفة عن السنة</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {a.byDept.map((d) => (
              <div key={d.dept} className="ledger-card p-4">
                <DeptBadge id={d.dept} />
                <div className="num mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <span className="text-muted-foreground">الإيرادات</span>
                  <span className="text-left text-income">{money(d.totalIn)}</span>
                  <span className="text-muted-foreground">المصروفات</span>
                  <span className="text-left text-expense">{money(d.totalOut)}</span>
                  <span className="font-semibold">{d.net >= 0 ? "ربح" : "خسارة"}</span>
                  <span
                    className={cn(
                      "text-left font-bold",
                      d.net >= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {money(Math.abs(d.net))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {!m.departments.length && (
            <p className="ledger-card p-10 text-center text-sm text-muted-foreground lg:col-span-2">
              لا توجد حركات في هذا الشهر.
            </p>
          )}
          {m.departments.map((d) => (
            <section key={d.dept} className="ledger-card min-w-0 p-4">
              <div className="mb-3 flex items-center justify-between">
                <DeptBadge id={d.dept} className="text-sm" />
                <span
                  className={cn(
                    "num text-sm font-bold",
                    d.net >= 0 ? "text-income" : "text-expense",
                  )}
                >
                  الصافي: {money(d.net)}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <LineList title="ما دخل" tone="income" items={d.ins} total={d.totalIn} />
                <LineList title="ما صُرف" tone="expense" items={d.outs} total={d.totalOut} />
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Scale className="size-3.5" /> الرصيد الافتتاحي للخزينة لا يدخل في حساب الربح والخسارة.
      </p>

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        orientation={annual ? "landscape" : "portrait"}
        title={annual ? "التقفيل المالي السنوي" : "التقفيل المالي الشهري"}
        subtitle={
          annual
            ? `عن السنة المالية ${int(year)} — نتيجة مراكز التكلفة`
            : `عن شهر ${monthLabel(period)} — بيان الداخل والخارج لكل قسم`
        }
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        {annual ? (
          <>
            <table className="doc-table">
              <thead>
                <tr data-pdf-break>
                  <th>الشهر</th>
                  {a.depts.map((d) => (
                    <th key={d}>صافي {getDepartment(d).name}</th>
                  ))}
                  <th>الإيرادات</th>
                  <th>المصروفات</th>
                  <th>صافي الشهر</th>
                </tr>
              </thead>
              <tbody>
                {a.months.map((mo, i) => (
                  <tr key={mo.period} data-pdf-break>
                    <td>{monthName(i + 1)}</td>
                    {mo.byDept.map((v, j) => (
                      <td key={j}>{money(v)}</td>
                    ))}
                    <td>{money(mo.totalIn)}</td>
                    <td>{money(mo.totalOut)}</td>
                    <td style={{ fontWeight: 700 }}>{money(mo.net)}</td>
                  </tr>
                ))}
                <tr className="doc-total" data-pdf-break>
                  <td>الإجمالي</td>
                  {a.byDept.map((d) => (
                    <td key={d.dept}>{money(d.net)}</td>
                  ))}
                  <td>{money(a.totalIn)}</td>
                  <td>{money(a.totalOut)}</td>
                  <td>{money(a.net)}</td>
                </tr>
              </tbody>
            </table>
            <table className="doc-table" style={{ marginTop: 14 }}>
              <thead>
                <tr data-pdf-break>
                  <th>مركز التكلفة</th>
                  <th>إجمالي الإيرادات</th>
                  <th>إجمالي المصروفات</th>
                  <th>صافي الربح / (الخسارة)</th>
                </tr>
              </thead>
              <tbody>
                {a.byDept.map((d) => (
                  <tr key={d.dept} data-pdf-break>
                    <td className="text-start">{getDepartment(d.dept).name}</td>
                    <td>{money(d.totalIn)}</td>
                    <td>{money(d.totalOut)}</td>
                    <td>{d.net < 0 ? `(${money(-d.net)})` : money(d.net)}</td>
                  </tr>
                ))}
                <tr className="doc-total" data-pdf-break>
                  <td className="text-start">
                    {a.net >= 0 ? "صافي ربح السنة" : "صافي خسارة السنة"}
                  </td>
                  <td>{money(a.totalIn)}</td>
                  <td>{money(a.totalOut)}</td>
                  <td>{a.net < 0 ? `(${money(-a.net)})` : money(a.net)}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>التاريخ</th>
                <th>رقم الإيصال</th>
                <th>البيان</th>
                <th>الداخل</th>
                <th>الخارج</th>
              </tr>
            </thead>
            <tbody>
              {m.departments.map((d) => [
                <tr key={`${d.dept}-h`} className="doc-group" data-pdf-break>
                  <td colSpan={5}>مركز التكلفة: {getDepartment(d.dept).name}</td>
                </tr>,
                ...[...d.ins, ...d.outs].map((t) => (
                  <tr key={t.id} data-pdf-break>
                    <td>{dateLabel(t.date)}</td>
                    <td dir="ltr">{t.receiptId}</td>
                    <td className="text-start">{t.description}</td>
                    <td>{t.kind === "in" ? money(t.amount) : "—"}</td>
                    <td>{t.kind === "out" ? money(t.amount) : "—"}</td>
                  </tr>
                )),
                <tr key={`${d.dept}-s`} className="doc-subtotal" data-pdf-break>
                  <td colSpan={3} className="text-start">
                    إجمالي {getDepartment(d.dept).name} — الصافي:{" "}
                    {d.net < 0 ? `(${money(-d.net)})` : money(d.net)}
                  </td>
                  <td>{money(d.totalIn)}</td>
                  <td>{money(d.totalOut)}</td>
                </tr>,
              ])}
              <tr className="doc-total" data-pdf-break>
                <td colSpan={3} className="text-start">
                  {m.net >= 0 ? "صافي ربح الشهر" : "صافي خسارة الشهر"}: {money(Math.abs(m.net))} ج.م
                </td>
                <td>{money(m.totalIn)}</td>
                <td>{money(m.totalOut)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <SignatureBlock roles={["المحاسب المختص", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function LineList({
  title,
  tone,
  items,
  total,
}: {
  title: string;
  tone: "income" | "expense";
  items: { id: string; description: string; amount: number; date: string }[];
  total: number;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "mb-1 text-xs font-semibold",
          tone === "income" ? "text-income" : "text-expense",
        )}
      >
        {title}
      </p>
      <ul className="divide-y text-sm">
        {items.map((t) => (
          <li key={t.id} className="flex justify-between gap-2 py-1.5">
            <span className="min-w-0">
              <span className="block truncate">{t.description}</span>
              <span className="num text-[11px] text-muted-foreground">{dateLabel(t.date)}</span>
            </span>
            <span className="num shrink-0">{money(t.amount)}</span>
          </li>
        ))}
        {!items.length && <li className="py-2 text-xs text-muted-foreground">لا يوجد</li>}
      </ul>
      <div
        className={cn(
          "num mt-1 flex justify-between border-t pt-1.5 text-sm font-bold",
          tone === "income" ? "text-income" : "text-expense",
        )}
      >
        <span>الإجمالي</span>
        <span>{money(total)}</span>
      </div>
    </div>
  );
}
