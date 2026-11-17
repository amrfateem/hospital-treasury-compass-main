import { createFileRoute } from "@tanstack/react-router";
import { Banknote, FileDown, Pencil, Stethoscope, Trash2, UserPlus, Wallet } from "lucide-react";
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
import { doctorDues } from "@/lib/hospital/finance";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  canSpendDirectly,
  deleteDoctor,
  deleteDoctorPayout,
  findBox,
  MAIN_BOX_ID,
  newId,
  payDoctor,
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
        content: "بيانات الأطباء وشروط التعاقد، وحساب مستحقات كل طبيب شهريًا من الكشوفات والعمليات والإشراف، وصرفها.",
      },
      { property: "og:title", content: "الأطباء ومستحقاتهم | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "مستحقات الأطباء الشهرية: راتب، نسبة كشف، عمليات، وإشراف." },
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
  const [editing, setEditing] = useState<Doctor | "new" | null>(null);
  const [paying, setPaying] = useState<{ doctor: Doctor; remaining: number } | null>(null);
  const pdf = usePdfExport();

  const rows = useMemo(
    () =>
      db.doctors
        .filter((d) => matches(query, d.name, d.specialty, findDepartment(db.departments, d.department).name))
        .map((d) => ({ doctor: d, dues: doctorDues(d, db.patientInvoices, db.doctorPayouts, period) }))
        .filter((r) => r.doctor.active || r.dues.total || r.dues.paid),
    [db.doctors, db.patientInvoices, db.doctorPayouts, db.departments, period, query],
  );
  const totals = rows.reduce(
    (s, r) => ({ total: s.total + r.dues.total, paid: s.paid + r.dues.paid, remaining: s.remaining + r.dues.remaining }),
    { total: 0, paid: 0, remaining: 0 },
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
        description="مستحقات كل طبيب تُحسب تلقائيًا من إيصالات المرضى المسجلة باسمه: الراتب الثابت + نسبة من الكشوفات + مبلغ لكل عملية + الإشراف عن كل يوم إقامة."
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
              onClick={() => pdf.run(`مستحقات-الأطباء-${period}.pdf`, "تم تصدير كشف مستحقات الأطباء.")}
            >
              <FileDown /> تصدير PDF
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="أطباء نشطون" value={int(db.doctors.filter((d) => d.active).length)} icon={Stethoscope} />
        <StatCard label="مستحقات الشهر" value={money(totals.total)} icon={Banknote} tone="primary" hint="ج.م" />
        <StatCard label="تم صرفه" value={money(totals.paid)} icon={Wallet} tone="income" hint="ج.م" />
        <StatCard label="المتبقي للأطباء" value={money(totals.remaining)} icon={Banknote} tone="expense" hint="ج.م" />
      </div>

      {!direct && canAdd && (
        <p className="mb-4 rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          صرف المستحقات للمدير المالي أو مدير المستشفى فقط — لأي صرف اعمل أمر صرف من صفحة أوامر الصرف.
        </p>
      )}

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} />
        <SearchBox value={query} onChange={setQuery} placeholder="اسم الطبيب، التخصص أو القسم" className="md:flex-1" />
      </FilterBar>

      <TableCard minWidth={1080}>
        <thead>
          <HeadRow>
            <Th>الطبيب</Th>
            <Th num>الراتب</Th>
            <Th num>نسبة الكشف</Th>
            <Th num>العمليات</Th>
            <Th num>الإشراف</Th>
            <Th num>الإجمالي</Th>
            <Th num>المصروف</Th>
            <Th num>المتبقي</Th>
            <Th className="w-40" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map(({ doctor: d, dues }) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td>
                <p className="font-semibold">
                  {d.name} {!d.active && <span className="text-[11px] font-normal text-muted-foreground">(موقوف)</span>}
                </p>
                <p className="mb-1 text-[11px] text-muted-foreground">{d.specialty}</p>
                <DeptBadge id={d.department} />
              </Td>
              <Td num>{money(dues.salary)}</Td>
              <Td num>
                {money(dues.consult)}
                <p className="text-[10px] text-muted-foreground">
                  {d.consultPercent}% من {money(dues.consultBase)}
                </p>
              </Td>
              <Td num>
                {money(dues.surgery)}
                <p className="text-[10px] text-muted-foreground">{int(dues.surgeries)} عملية</p>
              </Td>
              <Td num>
                {money(dues.supervision)}
                <p className="text-[10px] text-muted-foreground">{int(dues.supervisionDays)} يوم</p>
              </Td>
              <Td num className="font-bold">{money(dues.total)}</Td>
              <Td num className="text-income">{money(dues.paid)}</Td>
              <Td num className="font-bold text-expense">{money(dues.remaining)}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  {direct && canAdd && dues.remaining > 0 && (
                    <Button size="sm" onClick={() => setPaying({ doctor: d, remaining: dues.remaining })}>
                      صرف
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="icon" aria-label="تعديل" onClick={() => setEditing(d)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="حذف"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => window.confirm(`حذف ${d.name}؟`) && deleteDoctor(d.id) && toast.success("تم الحذف.")}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={9} text="لا يوجد أطباء — أضف الأطباء وشروط التعاقد لكل طبيب." />}
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
              <Td num className="text-right">{dateLabel(p.date)}</Td>
              <Td className="font-mono text-xs"><span dir="ltr">{p.number}</span></Td>
              <Td>{name(p.doctorId)}</Td>
              <Td className="text-xs">{findBox(db, p.boxId).name}</Td>
              <Td className="text-xs text-muted-foreground">{p.note}</Td>
              <Td num className="font-semibold">{money(p.amount)}</Td>
              <Td>
                {canEdit && direct && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف الصرف"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => window.confirm(`حذف ${p.number}؟`) && deleteDoctorPayout(p.id) && toast.success("تم حذف الصرف.")}
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

      <DoctorDialog value={editing} onClose={() => setEditing(null)} />
      <PayDialog target={paying} period={period} onClose={() => setPaying(null)} />

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
              <th>العمليات</th>
              <th>الإشراف</th>
              <th>الإجمالي</th>
              <th>المصروف</th>
              <th>المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doctor: d, dues }) => (
              <tr key={d.id} data-pdf-break>
                <td className="text-start">{d.name}</td>
                <td>{money(dues.salary)}</td>
                <td>{money(dues.consult)}</td>
                <td>{money(dues.surgery)}</td>
                <td>{money(dues.supervision)}</td>
                <td>{money(dues.total)}</td>
                <td>{money(dues.paid)}</td>
                <td>{money(dues.remaining)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">الإجمالي</td>
              <td>{money(totals.total)}</td>
              <td>{money(totals.paid)}</td>
              <td>{money(totals.remaining)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["المحاسب", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
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
  const [d, setD] = useState<Doctor>(blankDoctor);
  useEffect(() => {
    if (value) setD(value === "new" ? blankDoctor() : { ...value });
  }, [value]);
  const num = (k: keyof Doctor) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: Math.max(0, Number(e.target.value) || 0) });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saveDoctor({ ...d, name: d.name.trim(), specialty: d.specialty.trim() })) {
      toast.success("تم حفظ بيانات الطبيب.");
      onClose();
    }
  }
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{value === "new" ? "طبيب جديد" : "تعديل بيانات الطبيب"}</DialogTitle>
          <DialogDescription>شروط التعاقد تُستخدم في حساب المستحقات الشهرية تلقائيًا.</DialogDescription>
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
            <FieldRow label="القسم">
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
            <FieldRow label="نسبة الطبيب من الكشف (%)" htmlFor="dr-pct">
              <Input id="dr-pct" type="number" min="0" max="100" value={d.consultPercent} onChange={num("consultPercent")} />
            </FieldRow>
            <FieldRow label="مبلغ لكل عملية (ج.م)" htmlFor="dr-surg">
              <Input id="dr-surg" type="number" min="0" value={d.surgeryFee} onChange={num("surgeryFee")} />
            </FieldRow>
            <FieldRow label="إشراف عن كل يوم إقامة (ج.م)" htmlFor="dr-sup">
              <Input id="dr-sup" type="number" min="0" value={d.supervisionPerDay} onChange={num("supervisionPerDay")} />
            </FieldRow>
          </div>
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            الطبيب يعمل حاليًا
            <Switch checked={d.active} onCheckedChange={(active) => setD({ ...d, active })} />
          </label>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ</Button>
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  target,
  period,
  onClose,
}: {
  target: { doctor: Doctor; remaining: number } | null;
  period: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (target) {
      setDate(isoDate(new Date()));
      setAmount(String(target.remaining));
      setBoxId(MAIN_BOX_ID);
      setNote("");
    }
  }, [target]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    const v = Number(amount);
    if (payDoctor({ doctorId: target.doctor.id, period, date, amount: v, boxId, note })) {
      toast.success(`تم صرف ${egp(v)} لـ ${target.doctor.name}.`);
      onClose();
    }
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">صرف مستحقات {target?.doctor.name}</DialogTitle>
          <DialogDescription>
            مستحقات شهر {monthLabel(period)} — المتبقي {egp(target?.remaining ?? 0)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="dp-date">
              <Input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="dp-amount">
              <Input id="dp-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FieldRow>
          </div>
          <FieldRow label="من خزينة">
            <BoxSelect value={boxId} onChange={setBoxId} />
          </FieldRow>
          <FieldRow label="ملاحظة (اختياري)" htmlFor="dp-note">
            <Input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">صرف</Button>
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
