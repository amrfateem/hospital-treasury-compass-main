import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileDown,
  Landmark,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmployeeDialog } from "@/components/hospital/payroll/EmployeeDialog";
import { PayrollDocument, type PayrollRow } from "@/components/hospital/payroll/PayrollDocument";
import { findDepartment, sortDepartments, type DepartmentId } from "@/lib/hospital/constants";
import { DeptSelect, matches, SearchBox } from "@/components/hospital/kit";
import {
  dateLabel,
  egp,
  int,
  isoDate,
  lastDayOfPeriod,
  money,
  monthLabel,
  monthName,
  periodOf,
  workDuration,
} from "@/lib/hospital/format";
import {
  computeMonthlyPayroll,
  isEmployedInPeriod,
  monthsEmployedInYear,
  scalePayroll,
  sumPayroll,
} from "@/lib/hospital/payroll-tax";
import { exportOfficialPdf } from "@/lib/hospital/pdf";
import {
  deleteEmployee,
  postPayrollToTreasury,
  unpostPayroll,
  useHospitalDB,
  type Employee,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({
    meta: [
      { title: "الأجور والمرتبات وضريبة كسب العمل | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "إدارة أجور العاملين الثابتة والمتغيرة واحتساب التأمينات وضريبة كسب العمل وتصدير بيان الأجور الرسمي.",
      },
      { property: "og:title", content: "الأجور والمرتبات | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "احتساب الأجر الثابت والمتغير والتأمينات وضريبة كسب العمل وصافي المرتب لكل قسم.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayrollPage,
});

const YEARS = Array.from({ length: 11 }, (_, i) => 2020 + i);

function PayrollPage() {
  const db = useHospitalDB();
  const { settings } = db;
  const [mode, setMode] = useState<"monthly" | "annual">("monthly");
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [dept, setDept] = useState<"all" | DepartmentId>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Employee | null>(null);
  const [confirmPost, setConfirmPost] = useState<"post" | "unpost" | null>(null);
  const [exporting, setExporting] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const annual = mode === "annual";
  const yearEnd = `${year}-12`;

  const deptOrder = useMemo(
    () => sortDepartments(db.departments).map((d) => d.id),
    [db.departments],
  );
  /** All employees on payroll for the selected period, before UI filters. */
  const allRows: PayrollRow[] = useMemo(() => {
    return db.employees
      .map((e) => {
        const monthly = computeMonthlyPayroll(e.fixedSalary, e.variableSalary, settings);
        const months = annual
          ? monthsEmployedInYear(e.hireDate, year)
          : isEmployedInPeriod(e.hireDate, period)
            ? 1
            : 0;
        return {
          employee: e,
          months,
          line: annual ? scalePayroll(monthly, months) : monthly,
          duration: workDuration(e.hireDate, annual ? yearEnd : period),
        };
      })
      .filter((r) => r.months > 0)
      .sort(
        (a, b) =>
          deptOrder.indexOf(a.employee.department) - deptOrder.indexOf(b.employee.department) ||
          b.line.gross - a.line.gross,
      );
  }, [db.employees, settings, annual, year, period, yearEnd, deptOrder]);

  const deptRows = dept === "all" ? allRows : allRows.filter((r) => r.employee.department === dept);
  const q = query.trim();
  const visibleRows = q
    ? deptRows.filter((r) =>
        matches(q, r.employee.name, r.employee.jobTitle, r.employee.nationalId),
      )
    : deptRows;
  const totals = sumPayroll(deptRows.map((r) => r.line));
  const posted = db.payrollPostings.includes(period);
  const notOnPayroll = db.employees.length - allRows.length;

  const periodText = annual ? `عن السنة المالية ${int(year)}` : `عن شهر ${monthLabel(period)}`;
  const docTitle = annual
    ? "بيان أجور ومرتبات العاملين السنوي"
    : "بيان أجور ومرتبات العاملين الشهري";
  const docSubtitle = `${periodText} — ${dept === "all" ? "جميع الأقسام (مراكز التكلفة)" : `قسم ${findDepartment(db.departments, dept).name}`}`;

  async function handleExport() {
    if (!deptRows.length) {
      toast.error("لا يوجد موظفون في هذه الفترة لتصدير البيان.");
      return;
    }
    if (!docRef.current) return;
    setExporting(true);
    try {
      await exportOfficialPdf(
        docRef.current,
        `بيان-الأجور-${annual ? year : period}${dept === "all" ? "" : `-${dept}`}.pdf`,
      );
      toast.success("تم تصدير بيان الأجور بالترويسة الرسمية.");
    } catch (err) {
      console.error(err);
      toast.error("تعذّر إنشاء ملف PDF، حاول مرة أخرى.");
    } finally {
      setExporting(false);
    }
  }

  function handlePost() {
    const ids = [...new Set(allRows.map((r) => r.employee.department))];
    const byDept = ids.map((id) => {
      const d = findDepartment(db.departments, id);
      const net = sumPayroll(
        allRows.filter((r) => r.employee.department === id).map((r) => r.line),
      ).net;
      return {
        department: id,
        code: d.code,
        net,
        label: `صرف صافي رواتب ${monthLabel(period)} — قسم ${d.name}`,
      };
    });
    postPayrollToTreasury(period, lastDayOfPeriod(period), byDept);
    toast.success(`تم ترحيل صافي رواتب ${monthLabel(period)} إلى الخزينة كمصروف.`);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الأجور والمرتبات الثابتة والمتغيرة"
        title="الأجور وضريبة كسب العمل"
        description="الأجر الإجمالي = الأساسي الثابت + المتغير. تُحتسب التأمينات الاجتماعية وضريبة كسب العمل تلقائيًا للوصول إلى صافي الأجر."
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> إضافة موظف
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              <FileDown /> {exporting ? "جارٍ التصدير..." : "تصدير بيان الأجور PDF"}
            </Button>
          </>
        }
      />

      {/* Period controls */}
      <div className="ledger-card mb-6 flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="نوع البيان"
          >
            {(["monthly", "annual"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "monthly" ? "شهري" : "سنوي"}
              </button>
            ))}
          </div>
          {!annual && (
            <Select
              value={String(month)}
              onValueChange={(v) => setPeriod(`${year}-${v.padStart(2, "0")}`)}
            >
              <SelectTrigger className="w-32" aria-label="الشهر">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
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
            onValueChange={(v) => setPeriod(`${v}-${String(month).padStart(2, "0")}`)}
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

        {!annual &&
          (posted ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-income/10 px-3 py-1 text-sm font-medium text-income">
                <CheckCircle2 className="size-4" /> تم ترحيل الصافي إلى الخزينة
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmPost("unpost")}>
                <Undo2 /> إلغاء الترحيل
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setConfirmPost("post")}
              disabled={!allRows.length}
            >
              <Landmark /> ترحيل صافي رواتب الشهر للخزينة
            </Button>
          ))}
      </div>

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="الأجر الأساسي الثابت" value={money(totals.fixed)} icon={Wallet} />
        <StatCard
          label="الأجر المتغير والبدلات"
          value={money(totals.variable)}
          icon={Wallet}
          tone="copper"
        />
        <StatCard
          label="إجمالي الأجور"
          value={money(totals.gross)}
          icon={Users}
          tone="primary"
          hint={`${int(deptRows.length)} موظف`}
        />
        <StatCard
          label="التأمينات (حصة العامل)"
          value={money(totals.socialInsurance)}
          icon={ShieldCheck}
          tone="expense"
          hint={`حصة صاحب العمل: ${money(totals.employerInsurance)}`}
        />
        <StatCard
          label="ضريبة كسب العمل"
          value={money(totals.incomeTax)}
          icon={Landmark}
          tone="expense"
        />
        <StatCard
          label="صافي الأجور المستحقة"
          value={money(totals.net)}
          icon={CheckCircle2}
          tone="income"
          hint="بالجنيه المصري"
        />
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <DeptSelect value={dept} onChange={setDept} allowAll className="md:w-64" />
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="بحث بالاسم أو الوظيفة أو الرقم القومي"
          className="md:w-72"
        />
      </div>

      {/* Table */}
      <div className="ledger-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="border-b bg-secondary/60 text-xs text-secondary-foreground">
                <Th className="text-right">الموظف</Th>
                <Th className="text-right">القسم</Th>
                <Th className="text-right">مدة العمل</Th>
                {annual && <Th>الأشهر</Th>}
                <Th>الأساسي الثابت</Th>
                <Th>المتغير / البدلات</Th>
                <Th className="bg-primary/5">إجمالي الأجر</Th>
                <Th>التأمينات</Th>
                <Th>ضريبة كسب العمل</Th>
                <Th className="bg-income/5">صافي الأجر</Th>
                <Th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.employee.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-3">
                    <p className="font-semibold">{r.employee.name}</p>
                    <p className="text-xs text-muted-foreground">{r.employee.jobTitle}</p>
                  </td>
                  <td className="px-3 py-3">
                    <DeptBadge id={r.employee.department} />
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <p className="whitespace-nowrap text-foreground">{r.duration}</p>
                    <p className="num">منذ {dateLabel(r.employee.hireDate)}</p>
                  </td>
                  {annual && <Td>{int(r.months)}</Td>}
                  <Td>{money(r.line.fixed)}</Td>
                  <Td>{money(r.line.variable)}</Td>
                  <Td className="bg-primary/5 font-semibold">{money(r.line.gross)}</Td>
                  <Td className="text-expense">{money(r.line.socialInsurance)}</Td>
                  <Td className="text-expense">{money(r.line.incomeTax)}</Td>
                  <Td className="bg-income/5 font-bold text-income">{money(r.line.net)}</Td>
                  <td className="px-2 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`تعديل ${r.employee.name}`}
                        onClick={() => {
                          setEditing(r.employee);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف ${r.employee.name}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setToDelete(r.employee)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleRows.length && (
                <tr>
                  <td
                    colSpan={annual ? 11 : 10}
                    className="px-3 py-14 text-center text-muted-foreground"
                  >
                    لا يوجد موظفون مطابقون في هذه الفترة.
                  </td>
                </tr>
              )}
            </tbody>
            {visibleRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-copper/40 bg-accent/60 font-bold text-accent-foreground">
                  <td className="px-3 py-3" colSpan={annual ? 4 : 3}>
                    الإجمالي ({int(deptRows.length)} موظف)
                  </td>
                  <Td>{money(totals.fixed)}</Td>
                  <Td>{money(totals.variable)}</Td>
                  <Td>{money(totals.gross)}</Td>
                  <Td>{money(totals.socialInsurance)}</Td>
                  <Td>{money(totals.incomeTax)}</Td>
                  <Td>{money(totals.net)}</Td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        التأمينات: {int(settings.siEmployeeRate * 100)}٪ من أجر الاشتراك (حد أدنى{" "}
        {money(settings.siMinWage)} — حد أقصى {money(settings.siMaxWage)} ج.م شهريًا). الضريبة:
        شرائح القانون ٧ لسنة ٢٠٢٤ بعد خصم التأمينات والإعفاء الشخصي{" "}
        {money(settings.personalExemption)} ج.م سنويًا. يمكن تعديل هذه القيم من صفحة الإعدادات.
        {notOnPayroll > 0 &&
          ` (${int(notOnPayroll)} موظف تاريخ تعيينه بعد هذه الفترة ولا يظهر في البيان.)`}
      </p>

      <EmployeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={editing}
        defaultDepartment={dept === "all" ? "general" : dept}
        settings={settings}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>حذف الموظف؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف {toDelete?.name} من سجل الأجور. القيود المرحّلة سابقًا للخزينة لن تتأثر.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toDelete) deleteEmployee(toDelete.id);
                setToDelete(null);
              }}
            >
              حذف
            </AlertDialogAction>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmPost} onOpenChange={(o) => !o && setConfirmPost(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>
              {confirmPost === "post"
                ? `ترحيل رواتب ${monthLabel(period)}؟`
                : `إلغاء ترحيل رواتب ${monthLabel(period)}؟`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPost === "post"
                ? `سيُسجَّل صافي الرواتب (${egp(sumPayroll(allRows.map((r) => r.line)).net)}) كمصروف "خارج" في الخزينة، قيد لكل قسم، بتاريخ ${dateLabel(lastDayOfPeriod(period))}.`
                : "سيتم حذف قيود صرف الرواتب الخاصة بهذا الشهر من حركة الخزينة."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => {
                if (confirmPost === "post") handlePost();
                else {
                  unpostPayroll(period);
                  toast.success("تم إلغاء ترحيل الرواتب.");
                }
                setConfirmPost(null);
              }}
            >
              تأكيد
            </AlertDialogAction>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayrollDocument
        ref={docRef}
        settings={settings}
        departments={db.departments}
        rows={deptRows}
        annual={annual}
        title={docTitle}
        subtitle={docSubtitle}
        issuedOn={dateLabel(isoDate(new Date()))}
      />
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-3 py-3 text-left font-semibold whitespace-nowrap", className)}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("num px-3 py-3 text-left", className)}>{children}</td>;
}
