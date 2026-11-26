import { createFileRoute } from "@tanstack/react-router";
import {
  Banknote,
  CalendarClock,
  FileDown,
  HandCoins,
  HeartPulse,
  ListChecks,
  Pencil,
  Plus,
  Stethoscope,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  BoxSelect,
  DeptSelect,
  EmptyRow,
  FieldRow,
  FilterBar,
  HeadRow,
  matches,
  MonthYearPicker,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { findDepartment, GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import {
  DOCTOR_PERCENT_BASES,
  DOCTOR_SHARE_MODES,
  doctorAccount,
  doctorDay,
  doctorDues,
  doctorStatement,
  type DoctorPercentBase,
  type DoctorShareMode,
  type DoctorShareRule,
} from "@/lib/hospital/finance";
import { netOfRefunds } from "@/lib/hospital/refunds";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  canPayDoctorDaily,
  canSpendDirectly,
  deleteDoctor,
  deleteDoctorPayout,
  findBox,
  MAIN_BOX_ID,
  newId,
  payDoctor,
  payDoctorDaily,
  saveDoctor,
  useCan,
  useHospitalDB,
  useHospitalSession,
  type Doctor,
} from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/doctors")({
  head: () => ({
    meta: [
      { title: "الأطباء ومستحقاتهم | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "بيانات الأطباء وشروط التعاقد، وحساب مستحقات كل طبيب شهريًا من الكشوفات والتدخلات (رسم قلب، خياطة...) والعمليات والإشراف، مع المتأخرات وصرفها.",
      },
      { property: "og:title", content: "الأطباء ومستحقاتهم | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "مستحقات الأطباء الشهرية: راتب، نسبة كشف، عمليات، وإشراف.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DoctorsPage,
});

function DoctorsPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("doctors", "add");
  const canEdit = useCan("doctors");
  const direct = !!me && canSpendDirectly(me);
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [query, setQuery] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [editing, setEditing] = useState<Doctor | "new" | null>(null);
  const [paying, setPaying] = useState<Doctor | null>(null);
  const [statementOf, setStatementOf] = useState<Doctor | null>(null);
  const pdf = usePdfExport();

  // Dues count only what the patient kept: refunded lines come off the doctor's share too.
  const invoices = useMemo(
    () => db.patientInvoices.map((i) => netOfRefunds(i, db.refunds)),
    [db.patientInvoices, db.refunds],
  );
  const services = db.lists.services;
  const rows = useMemo(
    () =>
      db.doctors
        .filter((d) =>
          matches(query, d.name, d.specialty, findDepartment(db.departments, d.department).name),
        )
        .map((d) => ({
          doctor: d,
          dues: doctorDues(d, invoices, db.doctorPayouts, period, services),
          account: doctorAccount(d, invoices, db.doctorPayouts, period, services),
        }))
        .filter((r) => r.doctor.active || r.dues.total || r.dues.paid || Math.abs(r.account.balance) > 0.004),
    [db.doctors, invoices, db.doctorPayouts, db.departments, period, query, services],
  );
  const totals = rows.reduce(
    (s, r) => ({
      total: s.total + r.dues.total,
      paid: s.paid + r.dues.paid,
      remaining: s.remaining + r.dues.remaining,
      arrears: s.arrears + r.account.arrears,
      balance: s.balance + r.account.balance,
    }),
    { total: 0, paid: 0, remaining: 0, arrears: 0, balance: 0 },
  );
  /** Every line of the month that earned a doctor money, across all doctors. */
  const shareLog = useMemo(
    () =>
      db.doctors
        .flatMap((d) =>
          doctorStatement(d, invoices, period, services).flatMap((r) => [
            ...r.lines.map((l, i) => ({
              key: `${r.invoice.id}-${d.id}-${i}`,
              date: r.invoice.date,
              number: r.invoice.number,
              patient: r.invoice.patientName,
              doctor: d.name,
              service: l.qty > 1 ? `${l.description} ×${int(l.qty)}` : l.description,
              how: ruleLabel(l.rule, l.source),
              amount: l.amount,
              share: l.share,
            })),
            ...(r.surgery
              ? [{ key: `${r.invoice.id}-${d.id}-s`, date: r.invoice.date, number: r.invoice.number, patient: r.invoice.patientName, doctor: d.name, service: `عمليات ×${int(r.surgeries)}`, how: r.role === "anesthetist" ? "أتعاب تخدير لكل عملية" : "مبلغ لكل عملية", amount: 0, share: r.surgery }]
              : []),
            ...(r.supervision
              ? [{ key: `${r.invoice.id}-${d.id}-v`, date: r.invoice.date, number: r.invoice.number, patient: r.invoice.patientName, doctor: d.name, service: `إشراف ${int(r.supervisionDays)} يوم`, how: "إشراف عن كل يوم إقامة", amount: 0, share: r.supervision }]
              : []),
          ]),
        )
        .filter((l) => matches(logQuery, l.doctor, l.patient, l.service, l.number))
        .sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number)),
    [db.doctors, invoices, period, services, logQuery],
  );
  const payouts = db.doctorPayouts
    .filter((p) => p.period === period)
    .sort((a, b) => b.createdAt - a.createdAt);
  const name = (id: string) => db.doctors.find((d) => d.id === id)?.name ?? "طبيب محذوف";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="الأطباء ومستحقاتهم"
        description="حق كل طبيب يُحسب تلقائيًا من الإيصالات: نسبة الكشف + حقه في كل تدخل طلبه أو عمله (رسم قلب، خياطة...) + العمليات + الإشراف، ويتصرف آخر كل وردية. الراتب الثابت يتصرف آخر الشهر، واللي ما يتصرفش يفضل «متأخرات» لحد ما يتصرف."
        actions={
          <>
            {canAdd && (
              <Button onClick={() => setEditing("new")}>
                <UserPlus /> طبيب جديد
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() =>
                pdf.run(`مستحقات-الأطباء-${period}.pdf`, "تم تصدير كشف مستحقات الأطباء.")
              }
            >
              <FileDown /> تصدير PDF
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="أطباء نشطون"
          value={int(db.doctors.filter((d) => d.active).length)}
          icon={Stethoscope}
        />
        <StatCard
          label={`مستحقات ${monthLabel(period)}`}
          value={money(totals.total)}
          icon={Banknote}
          tone="primary"
          hint="ج.م"
        />
        <StatCard label="تم صرفه" value={money(totals.paid)} icon={Wallet} tone="income" hint="ج.م" />
        <StatCard
          label="متأخرات شهور سابقة"
          value={money(totals.arrears)}
          icon={CalendarClock}
          tone="copper"
          hint="ج.م لم تُصرف"
        />
        <StatCard
          label="إجمالي المستحق للأطباء"
          value={money(totals.balance)}
          icon={Banknote}
          tone="expense"
          hint="ج.م حتى نهاية الشهر"
        />
      </div>

      <WhereMoneyShows />

      <DailyShares invoices={invoices} />

      {!direct && canAdd && (
        <p className="mb-4 rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          صرف المستحقات للمدير المالي أو مدير المستشفى فقط — لأي صرف اعمل أمر صرف من صفحة أوامر
          الصرف.
        </p>
      )}

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} />
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="اسم الطبيب، التخصص أو القسم"
          className="md:flex-1"
        />
      </FilterBar>

      <TableCard minWidth={960}>
        <thead>
          <HeadRow>
            <Th>الطبيب</Th>
            <Th num>الإيصالات</Th>
            <Th className="w-56">من أين جاء المستحق</Th>
            <Th num>مستحق الشهر</Th>
            <Th num>المصروف</Th>
            <Th num>متأخرات سابقة</Th>
            <Th num>إجمالي المستحق له</Th>
            <Th className="w-40" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map(({ doctor: d, dues, account }) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td>
                <p className="font-semibold">
                  {d.name}{" "}
                  {!d.active && (
                    <span className="text-[11px] font-normal text-muted-foreground">(موقوف)</span>
                  )}
                </p>
                <p className="mb-1 text-[11px] text-muted-foreground">{d.specialty}</p>
                <DeptBadge id={d.department} />
              </Td>
              <Td num>{int(dues.invoices)}</Td>
              <Td className="text-xs">
                <ul className="space-y-0.5">
                  <li className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      الكشف {d.consultPercent}%{(d.percentOn ?? "consult") === "all" ? " (كل الخدمات)" : ""}
                    </span>
                    <span className="num">{money(dues.consult)}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-muted-foreground">التدخلات</span>
                    <span className="num font-semibold text-primary">{money(dues.interventions)}</span>
                  </li>
                  {!!(dues.surgery || dues.supervision) && (
                    <li className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        عمليات {int(dues.surgeries)} • إشراف {int(dues.supervisionDays)} يوم
                      </span>
                      <span className="num">{money(dues.surgery + dues.supervision)}</span>
                    </li>
                  )}
                  {!!dues.salary && (
                    <li className="flex justify-between gap-3">
                      <span className="text-muted-foreground">الراتب</span>
                      <span className="num">{money(dues.salary)}</span>
                    </li>
                  )}
                </ul>
              </Td>
              <Td num className="font-bold">
                {money(dues.total)}
              </Td>
              <Td num className="text-income">
                {money(dues.paid)}
              </Td>
              <Td num className={account.arrears > 0.004 ? "font-semibold text-copper" : "text-muted-foreground"}>
                {money(account.arrears)}
                {account.oldestUnpaid && account.oldestUnpaid < period && (
                  <p className="text-[10px]">من {monthLabel(account.oldestUnpaid)}</p>
                )}
              </Td>
              <Td num className="font-bold text-expense">
                {money(account.balance)}
              </Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => setStatementOf(d)}>
                    <ListChecks /> كشف
                  </Button>
                  {direct && canAdd && (account.balance > 0.004 || dues.remaining > 0.004) && (
                    <Button size="sm" onClick={() => setPaying(d)}>
                      صرف
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="تعديل"
                        onClick={() => setEditing(d)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="حذف"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          window.confirm(`حذف ${d.name}؟`) &&
                          deleteDoctor(d.id) &&
                          toast.success("تم الحذف.")
                        }
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && (
            <EmptyRow cols={8} text="لا يوجد أطباء — أضف الأطباء وشروط التعاقد لكل طبيب." />
          )}
        </tbody>
      </TableCard>

      <h2 className="mt-8 mb-3 font-bold">مدفوعات الأطباء — {monthLabel(period)}</h2>
      <TableCard minWidth={720}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>الرقم</Th>
            <Th>الطبيب</Th>
            <Th>الخزينة</Th>
            <Th>ملاحظة</Th>
            <Th num>المبلغ</Th>
            <Th className="w-12" />
          </HeadRow>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right">
                {dateLabel(p.date)}
              </Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{p.number}</span>
              </Td>
              <Td>{name(p.doctorId)}</Td>
              <Td className="text-xs">{findBox(db, p.boxId).name}</Td>
              <Td className="text-xs text-muted-foreground">{p.note}</Td>
              <Td num className="font-semibold">
                {money(p.amount)}
              </Td>
              <Td>
                {canEdit && direct && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف الصرف"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      window.confirm(`حذف ${p.number}؟`) &&
                      deleteDoctorPayout(p.id) &&
                      toast.success("تم حذف الصرف.")
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </Td>
            </tr>
          ))}
          {!payouts.length && <EmptyRow cols={7} text="لا توجد مدفوعات في هذا الشهر." />}
        </tbody>
      </TableCard>

      <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <HeartPulse className="size-4 text-primary" /> سجل حق الأطباء من الإيصالات — {monthLabel(period)}
          </h2>
          <p className="text-xs text-muted-foreground">
            كل خدمة اتحسب منها فلوس لطبيب: الكشف، التدخلات (رسم قلب، خياطة...)، العمليات والإشراف.
          </p>
        </div>
        <SearchBox value={logQuery} onChange={setLogQuery} placeholder="طبيب، مريض، خدمة أو رقم إيصال" className="md:w-80" />
      </div>
      <TableCard minWidth={860}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>الإيصال</Th>
            <Th>المريض</Th>
            <Th>الخدمة</Th>
            <Th>الطبيب</Th>
            <Th>طريقة الحساب</Th>
            <Th num>قيمة الخدمة</Th>
            <Th num>حق الطبيب</Th>
          </HeadRow>
        </thead>
        <tbody>
          {shareLog.map((l) => (
            <tr key={l.key} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right">
                {dateLabel(l.date)}
              </Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{l.number}</span>
              </Td>
              <Td>{l.patient}</Td>
              <Td className="text-xs">{l.service}</Td>
              <Td>د. {l.doctor}</Td>
              <Td className="text-xs text-muted-foreground">{l.how}</Td>
              <Td num>{l.amount ? money(l.amount) : "—"}</Td>
              <Td num className="font-semibold">
                {money(l.share)}
              </Td>
            </tr>
          ))}
          {!shareLog.length && <EmptyRow cols={8} text="لا توجد خدمات بحق للأطباء في هذا الشهر." />}
        </tbody>
      </TableCard>

      <DoctorDialog value={editing} onClose={() => setEditing(null)} />
      <PayDialog doctor={paying} invoices={invoices} period={period} onClose={() => setPaying(null)} />
      <StatementDialog
        doctor={statementOf}
        invoices={invoices}
        period={period}
        onClose={() => setStatementOf(null)}
      />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="كشف مستحقات الأطباء"
        subtitle={`شهر ${monthLabel(period)}`}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>الطبيب</th>
              <th>الراتب</th>
              <th>الكشف</th>
              <th>التدخلات</th>
              <th>العمليات والإشراف</th>
              <th>مستحق الشهر</th>
              <th>المصروف</th>
              <th>متأخرات</th>
              <th>إجمالي المستحق</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doctor: d, dues, account }) => (
              <tr key={d.id} data-pdf-break>
                <td className="text-start">{d.name}</td>
                <td>{money(dues.salary)}</td>
                <td>{money(dues.consult)}</td>
                <td>{money(dues.interventions)}</td>
                <td>{money(dues.surgery + dues.supervision)}</td>
                <td>{money(dues.total)}</td>
                <td>{money(dues.paid)}</td>
                <td>{money(account.arrears)}</td>
                <td>{money(account.balance)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">
                الإجمالي
              </td>
              <td>{money(totals.total)}</td>
              <td>{money(totals.paid)}</td>
              <td>{money(totals.arrears)}</td>
              <td>{money(totals.balance)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["المحاسب", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

/** How a share line was priced, in words. */
function ruleLabel(rule: DoctorShareRule, source: "doctor" | "service" | "general") {
  const how = rule.mode === "percent" ? `${rule.value}٪ من السعر` : `${money(rule.value)} ج.م لكل مرة`;
  return source === "general" ? `نسبة الطبيب ${how}` : source === "doctor" ? `سعر خاص بالطبيب: ${how}` : `حق الخدمة: ${how}`;
}

/** Where a doctor's money shows up in the system, step by step. */
/** Each doctor's shares for one day, paid at the end of the shift/day by the accountant. */
function DailyShares({ invoices }: { invoices: ReturnType<typeof useHospitalDB>["patientInvoices"] }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canPay = !!me && canPayDoctorDaily(me);
  const [day, setDay] = useState(() => isoDate(new Date()));
  const [paying, setPaying] = useState<{ doctor: Doctor; due: number } | null>(null);
  const services = db.lists.services;
  const rows = useMemo(
    () =>
      db.doctors
        .map((d) => ({ doctor: d, day: doctorDay(d, invoices, db.doctorPayouts, day, services) }))
        .filter((r) => r.day.today > 0.004 || r.day.due > 0.004 || r.day.paidToday > 0.004)
        .sort((a, b) => b.day.due - a.day.due),
    [db.doctors, invoices, db.doctorPayouts, day, services],
  );
  const total = rows.reduce((s, r) => s + r.day.due, 0);
  return (
    <section className="mb-8 rounded-xl border-2 border-primary/30 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <HandCoins className="size-5 text-primary" /> حق الأطباء النهارده — يتصرف آخر الوردية
          </h2>
          <p className="text-xs text-muted-foreground">
            حق كل طبيب من الكشف والتدخلات (رسم قلب، خياطة...) في إيصالات اليوم. المحاسب يصرفه من الخزينة قبل ما يقفل ورديته،
            واللي ما اتصرفش يفضل ظاهر هنا في الأيام اللي بعدها.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <FieldRow label="اليوم" htmlFor="dd-day">
            <Input id="dd-day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-44" />
          </FieldRow>
          <div className="text-left">
            <p className="text-xs text-muted-foreground">المطلوب صرفه</p>
            <p className="num text-xl font-bold text-expense">{egp(total)}</p>
          </div>
        </div>
      </div>
      <TableCard minWidth={820}>
        <thead>
          <HeadRow>
            <Th>الطبيب</Th>
            <Th num>إيصالات اليوم</Th>
            <Th num>حقه النهارده</Th>
            <Th num>باقي من أيام سابقة</Th>
            <Th num>اتصرف له النهارده</Th>
            <Th num>المطلوب صرفه الآن</Th>
            <Th className="w-32" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map(({ doctor: d, day: x }) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td className="font-semibold">د. {d.name}</Td>
              <Td num>{int(x.receipts)}</Td>
              <Td num>{money(x.today)}</Td>
              <Td num className={x.earlier > 0.004 ? "font-semibold text-copper" : "text-muted-foreground"}>
                {money(x.earlier)}
              </Td>
              <Td num className="text-income">{money(x.paidToday)}</Td>
              <Td num className="font-bold text-expense">{money(x.due)}</Td>
              <Td>
                {canPay && x.due > 0.004 ? (
                  <Button size="sm" onClick={() => setPaying({ doctor: d, due: x.due })} aria-label={`صرف حق اليوم لـ ${d.name}`}>
                    <HandCoins /> صرف حق اليوم
                  </Button>
                ) : x.due <= 0.004 ? (
                  <span className="text-xs font-semibold text-income">اتصرف بالكامل</span>
                ) : null}
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={7} text="مفيش حق أطباء في إيصالات اليوم ده." />}
        </tbody>
      </TableCard>
      {!canPay && rows.some((r) => r.day.due > 0.004) && (
        <p className="mt-3 text-xs text-muted-foreground">الصرف للمحاسب أو المدير المالي أو المدير.</p>
      )}
      <DailyPayDialog value={paying} day={day} onClose={() => setPaying(null)} />
    </section>
  );
}

function DailyPayDialog({
  value,
  day,
  onClose,
}: {
  value: { doctor: Doctor; due: number } | null;
  day: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!value) return;
    setAmount(String(value.due));
    setBoxId(MAIN_BOX_ID);
    setNote("");
  }, [value]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    const v = Number(amount);
    if (payDoctorDaily({ doctorId: value.doctor.id, period: day.slice(0, 7), date: day, amount: v, boxId, note })) {
      toast.success(`تم صرف ${egp(v)} لـ د. ${value.doctor.name} عن يوم ${dateLabel(day)}.`);
      onClose();
    }
  }
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">صرف حق د. {value?.doctor.name}</DialogTitle>
          <DialogDescription>
            عن يوم {dateLabel(day)} — المطلوب {egp(value?.due ?? 0)}. يتخصم من الخزينة ويظهر في ورديتك.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FieldRow label="المبلغ (ج.م)" htmlFor="dd-amount">
            <Input id="dd-amount" type="number" min="0" step="0.01" max={value?.due} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FieldRow>
          <FieldRow label="من خزينة">
            <BoxSelect value={boxId} onChange={setBoxId} />
          </FieldRow>
          <FieldRow label="ملاحظة (اختياري)" htmlFor="dd-note">
            <Input id="dd-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">صرف</Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WhereMoneyShows() {
  const steps: [string, string][] = [
    ["١. الإيصال", "الخدمة اللي ليها حق طبيب (رسم قلب، خياطة...) ما تتحفظش إلا لما يتحدد الطبيب اللي طلبها أو عملها."],
    ["٢. هنا في كشف الطبيب", "حقه يتسجل في نفس اليوم، سطر سطر بالإيصال والمريض والخدمة — زر «كشف» أو السجل تحت."],
    ["٣. الصرف آخر الوردية", "المحاسب يصرف حق كل طبيب من «حق الأطباء النهارده» فوق. اللي ما اتصرفش يفضل ظاهر في الأيام اللي بعدها، ولو عدّى الشهر ينتقل «متأخرات»."],
    ["٤. القوائم المالية", "يظهر كمصروف «أتعاب الأطباء» يوم الإيصال، وكالتزام «مستحقات الأطباء» باسم كل طبيب في الميزانية لحد الصرف، والصرف نفسه يتخصم من الخزينة والوردية."],
  ];
  return (
    <details className="mb-6 rounded-xl border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">فلوس الأطباء بتظهر فين؟</summary>
      <ol className="mt-3 grid gap-3 md:grid-cols-4">
        {steps.map(([t, d]) => (
          <li key={t} className="rounded-lg bg-muted/50 p-3">
            <p className="font-semibold text-primary">{t}</p>
            <p className="mt-1 text-xs text-muted-foreground">{d}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

const blankDoctor = (): Doctor => ({
  id: newId(),
  name: "",
  specialty: "",
  department: GENERAL_DEPT_ID,
  phone: "",
  active: true,
  monthlySalary: 0,
  consultPercent: 0,
  surgeryFee: 0,
  supervisionPerDay: 0,
});

function DoctorDialog({ value, onClose }: { value: Doctor | "new" | null; onClose: () => void }) {
  const db = useHospitalDB();
  const [d, setD] = useState<Doctor>(blankDoctor);
  useEffect(() => {
    if (value) setD(value === "new" ? blankDoctor() : { ...value });
  }, [value]);
  const num = (k: keyof Doctor) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: Math.max(0, Number(e.target.value) || 0) });
  const shares = d.serviceShares ?? [];
  const setShares = (next: NonNullable<Doctor["serviceShares"]>) => setD({ ...d, serviceShares: next });
  const services = [...db.lists.services].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const svcLabel = (id: string) => {
    const s = db.lists.services.find((x) => x.id === id);
    if (!s) return "خدمة محذوفة";
    return s.department ? `${s.name} — ${findDepartment(db.departments, s.department).name}` : `${s.name} — عامة`;
  };
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = shares.filter((s) => s.serviceId && s.value > 0);
    if (clean.some((s) => s.mode === "percent" && s.value > 100)) {
      toast.error("نسبة الطبيب على الخدمة لا تزيد عن ١٠٠٪.");
      return;
    }
    if (
      saveDoctor({
        ...d,
        name: d.name.trim(),
        specialty: d.specialty.trim(),
        serviceShares: clean.length ? clean : undefined,
      })
    ) {
      toast.success("تم حفظ بيانات الطبيب.");
      onClose();
    }
  }
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {value === "new" ? "طبيب جديد" : "تعديل بيانات الطبيب"}
          </DialogTitle>
          <DialogDescription>
            شروط التعاقد تُستخدم في حساب المستحقات الشهرية تلقائيًا. طبيب العيادة: اختر عيادته في
            «القسم / العيادة» عشان يظهر لوحده في إيصالاتها.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="اسم الطبيب" htmlFor="dr-name">
              <Input id="dr-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </FieldRow>
            <FieldRow label="التخصص" htmlFor="dr-spec">
              <Input id="dr-spec" value={d.specialty} onChange={(e) => setD({ ...d, specialty: e.target.value })} />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="القسم / العيادة">
              <DeptSelect value={d.department} onChange={(v) => setD({ ...d, department: v })} />
            </FieldRow>
            <FieldRow label="الموبايل (اختياري)" htmlFor="dr-phone">
              <Input id="dr-phone" dir="ltr" value={d.phone ?? ""} onChange={(e) => setD({ ...d, phone: e.target.value })} />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="الراتب الشهري الثابت (ج.م)" htmlFor="dr-sal">
              <Input id="dr-sal" type="number" min="0" value={d.monthlySalary} onChange={num("monthlySalary")} />
            </FieldRow>
            <FieldRow label="نسبة الطبيب (%)" htmlFor="dr-pct">
              <Input id="dr-pct" type="number" min="0" max="100" value={d.consultPercent} onChange={num("consultPercent")} />
            </FieldRow>
            <FieldRow label="النسبة محسوبة من">
              <Select value={d.percentOn ?? "consult"} onValueChange={(v) => setD({ ...d, percentOn: v as DoctorPercentBase })}>
                <SelectTrigger aria-label="النسبة محسوبة من">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {(Object.keys(DOCTOR_PERCENT_BASES) as DoctorPercentBase[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DOCTOR_PERCENT_BASES[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="مبلغ لكل عملية (ج.م)" htmlFor="dr-surg">
              <Input id="dr-surg" type="number" min="0" value={d.surgeryFee} onChange={num("surgeryFee")} />
            </FieldRow>
            <FieldRow label="إشراف عن كل يوم إقامة (ج.م)" htmlFor="dr-sup">
              <Input id="dr-sup" type="number" min="0" value={d.supervisionPerDay} onChange={num("supervisionPerDay")} />
            </FieldRow>
          </div>

          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-semibold">سعر خاص للطبيب على تدخلات معينة (اختياري)</legend>
            <p className="text-[11px] text-muted-foreground">
              لو الطبيب متفق على حق مختلف في خدمة (مثلاً رسم القلب ٨٠ جنيه بدل ٥٠)، اكتبه هنا. باقي الخدمات تاخد
              حقها المكتوب في «خدمات الأقسام».
            </p>
            {shares.map((sh, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_11rem_7rem_auto]">
                <Select
                  value={sh.serviceId || "__pick__"}
                  onValueChange={(v) => setShares(shares.map((x, j) => (j === i ? { ...x, serviceId: v } : x)))}
                >
                  <SelectTrigger aria-label="الخدمة">
                    <SelectValue placeholder="اختر الخدمة">{sh.serviceId ? svcLabel(sh.serviceId) : "اختر الخدمة"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent dir="rtl" className="max-h-72">
                    <SelectItem value="__pick__" disabled>
                      اختر الخدمة
                    </SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {svcLabel(s.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sh.mode}
                  onValueChange={(v) => setShares(shares.map((x, j) => (j === i ? { ...x, mode: v as DoctorShareMode } : x)))}
                >
                  <SelectTrigger aria-label="طريقة الحساب">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {(Object.keys(DOCTOR_SHARE_MODES) as DoctorShareMode[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {DOCTOR_SHARE_MODES[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={sh.mode === "percent" ? "النسبة ٪" : "المبلغ"}
                  type="number"
                  min="0"
                  step="0.01"
                  value={sh.value || ""}
                  placeholder={sh.mode === "percent" ? "٪" : "ج.م"}
                  onChange={(e) =>
                    setShares(shares.map((x, j) => (j === i ? { ...x, value: Math.max(0, Number(e.target.value) || 0) } : x)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="حذف السعر الخاص"
                  onClick={() => setShares(shares.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setShares([...shares, { serviceId: "", mode: "fixed", value: 0 }])}
            >
              <Plus /> إضافة سعر خاص
            </Button>
          </fieldset>

          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            الطبيب يعمل حاليًا
            <Switch checked={d.active} onCheckedChange={(active) => setD({ ...d, active })} />
          </label>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ</Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  doctor,
  invoices,
  period,
  onClose,
}: {
  doctor: Doctor | null;
  invoices: ReturnType<typeof useHospitalDB>["patientInvoices"];
  period: string;
  onClose: () => void;
}) {
  const db = useHospitalDB();
  const account = useMemo(
    () => (doctor ? doctorAccount(doctor, invoices, db.doctorPayouts, period, db.lists.services) : null),
    [doctor, invoices, db.doctorPayouts, period, db.lists.services],
  );
  const open = useMemo(() => {
    const m = (account?.months ?? []).filter((x) => x.remaining > 0.004);
    if (!m.some((x) => x.period === period) && doctor) {
      const cur = doctorDues(doctor, invoices, db.doctorPayouts, period, db.lists.services);
      if (cur.remaining > 0.004) m.push({ period, total: cur.total, paid: cur.paid, remaining: cur.remaining });
    }
    return m;
  }, [account, doctor, invoices, db.doctorPayouts, period, db.lists.services]);
  const [month, setMonth] = useState(period);
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!doctor) return;
    const first = open[0];
    setMonth(first?.period ?? period);
    setAmount(first ? String(first.remaining) : "");
    setDate(isoDate(new Date()));
    setBoxId(MAIN_BOX_ID);
    setNote("");
    // Only when the dialog opens for a doctor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor]);
  const chosen = open.find((m) => m.period === month);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;
    const v = Number(amount);
    if (payDoctor({ doctorId: doctor.id, period: month, date, amount: v, boxId, note })) {
      toast.success(`تم صرف ${egp(v)} لـ ${doctor.name} عن ${monthLabel(month)}.`);
      onClose();
    }
  }
  return (
    <Dialog open={!!doctor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">صرف مستحقات {doctor?.name}</DialogTitle>
          <DialogDescription>
            إجمالي المستحق له حتى {monthLabel(period)}: {egp(account?.balance ?? 0)} — يبدأ الصرف بأقدم شهر لسه ليه فيه فلوس.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FieldRow label="عن شهر">
            <Select
              value={month}
              onValueChange={(v) => {
                setMonth(v);
                const m = open.find((x) => x.period === v);
                if (m) setAmount(String(m.remaining));
              }}
            >
              <SelectTrigger aria-label="عن شهر">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {open.map((m) => (
                  <SelectItem key={m.period} value={m.period}>
                    {monthLabel(m.period)} — متبقي {egp(m.remaining)}
                  </SelectItem>
                ))}
                {!open.length && <SelectItem value={period}>{monthLabel(period)}</SelectItem>}
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="dp-date">
              <Input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="dp-amount">
              <Input id="dp-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FieldRow>
          </div>
          {chosen && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              مستحق {monthLabel(chosen.period)}: {egp(chosen.total)} — اتصرف {egp(chosen.paid)} — متبقي {egp(chosen.remaining)}
            </p>
          )}
          <FieldRow label="من خزينة">
            <BoxSelect value={boxId} onChange={setBoxId} />
          </FieldRow>
          <FieldRow label="ملاحظة (اختياري)" htmlFor="dp-note">
            <Input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">صرف</Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({
  doctor,
  invoices,
  period,
  onClose,
}: {
  doctor: Doctor | null;
  invoices: ReturnType<typeof useHospitalDB>["patientInvoices"];
  period: string;
  onClose: () => void;
}) {
  const db = useHospitalDB();
  const pdf = usePdfExport();
  const services = db.lists.services;
  const rows = useMemo(
    () => (doctor ? doctorStatement(doctor, invoices, period, services) : []),
    [doctor, invoices, period, services],
  );
  const dues = doctor ? doctorDues(doctor, invoices, db.doctorPayouts, period, services) : null;
  const account = doctor ? doctorAccount(doctor, invoices, db.doctorPayouts, period, services) : null;
  const clinic = (inv: (typeof rows)[number]["invoice"]) =>
    findDepartment(db.departments, inv.clinicId || inv.department).name;
  /** One row per line that earned the doctor money (plus surgeries and supervision). */
  const lines = rows.flatMap((r) => [
    ...r.lines.map((l, i) => ({
      key: `${r.invoice.id}-${i}`,
      inv: r.invoice,
      service: l.qty > 1 ? `${l.description} ×${int(l.qty)}` : l.description,
      how: ruleLabel(l.rule, l.source),
      amount: l.amount as number | null,
      share: l.share,
    })),
    ...(r.surgery
      ? [{ key: `${r.invoice.id}-s`, inv: r.invoice, service: `عمليات ×${int(r.surgeries)}`, how: r.role === "anesthetist" ? "أتعاب تخدير لكل عملية" : "مبلغ لكل عملية", amount: null, share: r.surgery }]
      : []),
    ...(r.supervision
      ? [{ key: `${r.invoice.id}-v`, inv: r.invoice, service: `إشراف ${int(r.supervisionDays)} يوم`, how: "إشراف عن كل يوم إقامة", amount: null, share: r.supervision }]
      : []),
  ]);
  const empty = "لا توجد خدمات بحق للطبيب في هذا الشهر.";
  const table = (doc: boolean) => (
    <>
      <thead>
        {doc ? (
          <tr data-pdf-break>
            <th>التاريخ</th>
            <th>رقم الإيصال</th>
            <th>المريض</th>
            <th>العيادة / القسم</th>
            <th>الخدمة</th>
            <th>طريقة الحساب</th>
            <th>قيمة الخدمة</th>
            <th>حق الطبيب</th>
          </tr>
        ) : (
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>رقم الإيصال</Th>
            <Th>المريض</Th>
            <Th>العيادة / القسم</Th>
            <Th>الخدمة</Th>
            <Th>طريقة الحساب</Th>
            <Th num>قيمة الخدمة</Th>
            <Th num>حق الطبيب</Th>
          </HeadRow>
        )}
      </thead>
      <tbody>
        {lines.map((l) =>
          doc ? (
            <tr key={l.key} data-pdf-break>
              <td>{dateLabel(l.inv.date)}</td>
              <td dir="ltr">{l.inv.number}</td>
              <td className="text-start">{l.inv.patientName}</td>
              <td>{clinic(l.inv)}</td>
              <td className="text-start">{l.service}</td>
              <td className="text-start">{l.how}</td>
              <td>{l.amount === null ? "—" : money(l.amount)}</td>
              <td>{money(l.share)}</td>
            </tr>
          ) : (
            <tr key={l.key} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right">
                {dateLabel(l.inv.date)}
              </Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{l.inv.number}</span>
              </Td>
              <Td>{l.inv.patientName}</Td>
              <Td className="text-xs">{clinic(l.inv)}</Td>
              <Td className="text-xs">{l.service}</Td>
              <Td className="text-xs text-muted-foreground">{l.how}</Td>
              <Td num>{l.amount === null ? "—" : money(l.amount)}</Td>
              <Td num className="font-semibold">
                {money(l.share)}
              </Td>
            </tr>
          ),
        )}
        {!lines.length &&
          (doc ? (
            <tr>
              <td colSpan={8}>{empty}</td>
            </tr>
          ) : (
            <EmptyRow cols={8} text={empty} />
          ))}
      </tbody>
    </>
  );
  const summary: [string, number][] = dues
    ? [
        [`نسبة الكشف ${doctor?.consultPercent ?? 0}% من ${money(dues.consultBase)}`, dues.consult],
        ...(dues.interventions ? ([["التدخلات (رسم قلب، خياطة...)", dues.interventions]] as [string, number][]) : []),
        ...(dues.surgery ? ([["العمليات", dues.surgery]] as [string, number][]) : []),
        ...(dues.supervision ? ([["الإشراف", dues.supervision]] as [string, number][]) : []),
        ...(dues.salary ? ([["الراتب الثابت", dues.salary]] as [string, number][]) : []),
        ["مستحق الشهر", dues.total],
        ["تم صرفه عن الشهر", dues.paid],
        ["متأخرات شهور سابقة", account?.arrears ?? 0],
        ["إجمالي المستحق له", account?.balance ?? dues.remaining],
      ]
    : [];
  const bold = new Set(["مستحق الشهر", "إجمالي المستحق له"]);
  return (
    <>
      <Dialog open={!!doctor} onOpenChange={(o) => !o && onClose()}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle className="font-display text-2xl">كشف د. {doctor?.name}</DialogTitle>
            <DialogDescription>
              شهر {monthLabel(period)} — {int(rows.length)} إيصال، كل خدمة ليها حق للطبيب في سطر لوحدها
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {summary.slice(-4).map(([label, v]) => (
              <StatCard key={label} label={label} value={money(v)} icon={Banknote} hint="ج.م" />
            ))}
          </div>
          <TableCard minWidth={980}>{table(false)}</TableCard>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              variant="outline"
              disabled={pdf.busy || !doctor}
              onClick={() => doctor && pdf.run(`كشف-${doctor.name}-${period}.pdf`, "تم تصدير كشف الطبيب.")}
            >
              <FileDown /> تصدير PDF
            </Button>
            <Button variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {doctor && (
        <OfficialDocument
          ref={pdf.ref}
          settings={db.settings}
          title={`كشف مستحقات د. ${doctor.name}`}
          subtitle={`${doctor.specialty ? `${doctor.specialty} — ` : ""}شهر ${monthLabel(period)}`}
          issuedOn={dateLabel(isoDate(new Date()))}
        >
          <table className="doc-table">{table(true)}</table>
          <table className="doc-table">
            <tbody>
              {summary.map(([label, v]) => (
                <tr key={label} data-pdf-break className={bold.has(label) ? "doc-total" : undefined}>
                  <td className="text-start">{label}</td>
                  <td>{money(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SignatureBlock roles={["الطبيب", "المحاسب", "المدير المالي"]} />
        </OfficialDocument>
      )}
    </>
  );
}
