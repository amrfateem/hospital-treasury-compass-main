import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BedDouble,
  BookOpen,
  CalendarDays,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { DeptBadge, KindBadge } from "@/components/hospital/ui";
import { MoneyAtAGlance } from "@/components/hospital/dashboard/MoneyAtAGlance";
import { HOSPITAL } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { approvableCount } from "@/lib/hospital/approvals";
import { controlAlerts } from "@/lib/hospital/control";
import { can } from "@/lib/hospital/permissions";
import { computeMonthlyPayroll, isEmployedInPeriod, sumPayroll } from "@/lib/hospital/payroll-tax";
import { useHospitalDB, useHospitalSession, withRunningBalance } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم المالية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "نظام محاسبة وضرائب وحركة خزينة مستشفى الرحمة التخصصي موزعًا على خمسة مراكز تكلفة.",
      },
      { property: "og:title", content: "لوحة التحكم المالية | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "الإيرادات والمصروفات والأجور والضرائب لأقسام المستشفى في مكان واحد.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const START_STEPS = [
  {
    to: "/settings",
    title: "بيانات المستشفى والأقسام",
    hint: "العنوان والرقم الضريبي ومراجعة الأقسام والبنود",
  },
  { to: "/treasury", title: "الرصيد الافتتاحي", hint: "سجّل رصيد الخزينة الحالي كقيد إيراد" },
  { to: "/payroll", title: "إضافة الموظفين", hint: "الأجر الثابت والمتغير لكل موظف" },
  { to: "/billing", title: "أول فاتورة مريض", hint: "تُسجَّل تلقائيًا في الخزينة" },
] as const;

const hourGreeting = (h: number) => (h < 12 ? "صباح الخير" : "مساء الخير");
const todayFmt = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Welcome banner: today's receipts, inpatients and waiting approvals, with quick actions. */
function TodayBanner({ period }: { period: string }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const today = isoDate(new Date());
  const todays = db.patientInvoices.filter((i) => i.date === today);
  const paidToday = todays.reduce((s, i) => s + invoiceAmounts(i).paidNow, 0);
  const inpatients = db.admissions.filter((a) => a.status === "open").length;
  const waiting = me ? approvableCount(db, me) : 0;
  const actions = [
    { to: "/billing", label: "إيصال مريض جديد", icon: Receipt, ok: !!me && can(me, "billing", "view") },
    { to: "/admissions", label: "المرضى المقيمين", icon: BedDouble, ok: !!me && can(me, "billing", "view") },
    { to: "/treasury", label: "الخزائن", icon: Wallet, ok: !!me && can(me, "treasury", "view") },
    { to: "/financial-reports", label: "القوائم المالية", icon: BookOpen, ok: !!me && can(me, "accounting", "view") },
  ] as const;
  const kpis = [
    { label: "إيصالات اليوم", value: int(todays.length), icon: Receipt },
    { label: "محصّل اليوم (ج.م)", value: money(paidToday), icon: Wallet },
    { label: "مرضى مقيمون الآن", value: int(inpatients), icon: BedDouble },
    { label: "طلبات بانتظار اعتمادك", value: int(waiting), icon: ShieldCheck },
  ];
  return (
    <section className="hero-banner mb-8 p-6 md:p-8">
      <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="hero-chip">
              <CalendarDays className="size-3.5" /> {todayFmt.format(new Date())}
            </span>
            <span className="hero-chip">ملخص شهر {monthLabel(period)}</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {hourGreeting(new Date().getHours())}{me ? `، ${me.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-2 max-w-xl text-sm opacity-85">
            {HOSPITAL.name} — {HOSPITAL.owner}. كل جنيه داخل وخارج متسجل ومتابَع لحظة بلحظة.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            {actions
              .filter((a) => a.ok)
              .map((a) => (
                <Link key={a.to} to={a.to} className="hero-action">
                  <a.icon className="size-4 shrink-0" />
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="hero-action flex-col items-start gap-1 hover:translate-y-0">
              <dt className="flex items-center gap-1.5 text-xs font-medium opacity-85">
                <k.icon className="size-3.5" /> {k.label}
              </dt>
              <dd className="num font-display text-2xl font-bold">{k.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Tells the director / finance manager when this month has money movements to look at. */
function ControlNotice({ period }: { period: string }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const allowed = !!me && can(me, "approvals", "view");
  const today = isoDate(new Date());
  const high = allowed ? controlAlerts(db, `${period}-01`, `${period}-31`, today).filter((a) => a.level === "high") : [];
  if (!high.length) return null;
  return (
    <Link to="/control" className="ledger-card lift mb-8 flex items-center gap-3 border-expense/30 bg-expense/5 p-4">
      <span className="stat-icon bg-expense/10 text-expense">
        <ShieldAlert className="size-5" />
      </span>
      <span className="flex-1">
        <span className="block font-semibold">{int(high.length)} تنبيه رقابة مهم الشهر ده</span>
        <span className="block text-xs text-muted-foreground">
          {high.slice(0, 2).map((a) => a.title).join(" • ")}
        </span>
      </span>
      <span className="text-sm font-semibold text-primary">افتح صفحة الرقابة</span>
    </Link>
  );
}

function Dashboard() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const period = periodOf(new Date());
  const today = isoDate(new Date());
  const ledger = withRunningBalance(db.transactions);
  const monthTx = db.transactions.filter((t) => t.date.startsWith(period));
  const staff = db.employees.filter((e) => isEmployedInPeriod(e.hireDate, period));
  const payroll = sumPayroll(
    staff.map((e) => computeMonthlyPayroll(e.fixedSalary, e.variableSalary, db.settings)),
  );
  /** Only departments with movement this month, busiest first. */
  const deptStats = db.departments
    .map((d) => {
      const t = monthTx.filter((x) => x.department === d.id && x.source !== "opening");
      const inn = t.filter((x) => x.kind === "in").reduce((s, x) => s + x.amount, 0);
      const out = t.filter((x) => x.kind === "out").reduce((s, x) => s + x.amount, 0);
      return { d, inn, out, net: inn - out };
    })
    .filter((x) => x.inn + x.out > 0)
    .sort((a, b) => b.inn + b.out - (a.inn + a.out));
  const maxDept = Math.max(1, ...deptStats.map((x) => Math.max(x.inn, x.out)));
  const isEmpty = !db.transactions.length && !db.employees.length;

  return (
    <div className="mx-auto max-w-7xl">
      <TodayBanner period={period} />
      <ControlNotice period={period} />

      {isEmpty && (
        <section className="ledger-card mb-8 p-5">
          <h2 className="text-xl font-bold">ابدأ تشغيل النظام</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            النظام فارغ وجاهز. ابدأ بهذه الخطوات بالترتيب:
          </p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {START_STEPS.map((step, i) => (
              <li key={step.to}>
                <Link
                  to={step.to}
                  className="flex h-full items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary hover:bg-secondary/40"
                >
                  <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {int(i + 1)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{step.title}</span>
                    <span className="block text-xs text-muted-foreground">{step.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <MoneyAtAGlance
        today={today}
        showTreasury={!!me && can(me, "treasury", "view")}
        showTotals={!!me && (can(me, "accounting", "view") || can(me, "expenses", "view"))}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="ledger-card p-5 lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-bold">مراكز التكلفة هذا الشهر</h2>
            <div className="flex gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-income" /> داخل
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-expense" /> خارج
              </span>
            </div>
          </div>
          <div className="space-y-5">
            {!deptStats.length && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                لا توجد حركات على الأقسام هذا الشهر.
              </p>
            )}
            {deptStats.map(({ d, inn, out, net }) => {
              return (
                <div key={d.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <DeptBadge id={d.id} />
                    <span
                      className={cn("num font-bold", net >= 0 ? "text-income" : "text-expense")}
                    >
                      {money(net)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-income"
                        style={{ width: `${(inn / maxDept) * 100}%` }}
                      />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-expense"
                        style={{ width: `${(out / maxDept) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ledger-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">آخر الحركات</h2>
            <Link
              to="/treasury"
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              الخزينة <ArrowLeft className="size-3.5" />
            </Link>
          </div>
          <ul className="divide-y">
            {[...ledger]
              .reverse()
              .slice(0, 7)
              .map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <p className="num text-[11px] text-muted-foreground">{dateLabel(t.date)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "num text-sm font-bold",
                        t.kind === "in" ? "text-income" : "text-expense",
                      )}
                    >
                      {t.kind === "in" ? "+" : "−"}
                      {money(t.amount)}
                    </span>
                    <KindBadge kind={t.kind} />
                  </div>
                </li>
              ))}
            {!ledger.length && (
              <li className="py-8 text-center text-sm text-muted-foreground">لا توجد حركات بعد.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="ledger-card mt-6 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">أجور الشهر والضريبة والتأمينات المستحقة</h2>
          <p className="num mt-1 text-sm text-muted-foreground">
            صافي الأجور: {money(payroll.net)} ج.م ({int(staff.length)} موظف) •{" "}
            ضريبة كسب العمل: {money(payroll.incomeTax)} ج.م • تأمينات (عامل + صاحب عمل):{" "}
            {money(payroll.socialInsurance + payroll.employerInsurance)} ج.م
          </p>
        </div>
        <Link
          to="/payroll"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          بيان الأجور <ArrowLeft className="size-4" />
        </Link>
      </section>
    </div>
  );
}
