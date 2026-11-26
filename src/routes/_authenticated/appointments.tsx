import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck2, CalendarClock, CalendarPlus, CalendarX2, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FieldRow, FilterBar, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { PatientPicker, type PickedPatient } from "@/components/hospital/medical/PatientPicker";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate } from "@/lib/hospital/format";
import { useCan, useHospitalDB } from "@/lib/hospital/store";
import { errorText } from "@/lib/hospital/upload";
import { listAppointments, saveAppointment, setAppointmentStatus } from "@/lib/medical/medical.functions";
import { APPOINTMENT_STATUS, type Appointment, type AppointmentStatus } from "@/lib/medical/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({
    meta: [
      { title: "المواعيد والحجوزات | مستشفى الرحمة التخصصي" },
      { name: "description", content: "حجز مواعيد المرضى مع الأطباء والأقسام، وتسجيل الوصول والكشف والإلغاء يوم بيوم." },
      { property: "og:title", content: "المواعيد والحجوزات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "حجز ومتابعة مواعيد المرضى." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppointmentsPage,
});

const STATUS_TONE: Record<AppointmentStatus, string> = {
  booked: "bg-primary/10 text-primary",
  arrived: "bg-copper/15 text-copper",
  done: "bg-income/15 text-income",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-destructive/10 text-destructive",
};
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
const localParts = (iso: string) => {
  const d = new Date(iso);
  return { date: isoDate(d), time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
};

interface Draft {
  id?: string;
  patient: PickedPatient | null;
  doctorId: string;
  department: string;
  date: string;
  time: string;
  durationMin: number;
  reason: string;
  notes: string;
}

function AppointmentsPage() {
  const db = useHospitalDB();
  const qc = useQueryClient();
  const canAdd = useCan("appointments", "add");
  const canEdit = useCan("appointments", "edit");
  const [day, setDay] = useState(() => isoDate(new Date()));
  const [days, setDays] = useState<1 | 7>(1);
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<"all" | AppointmentStatus>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const from = new Date(`${day}T00:00:00`).toISOString();
  const to = new Date(`${shift(day, days)}T00:00:00`).toISOString();
  const key = ["appointments", from, to];
  const list = useQuery({ queryKey: key, queryFn: () => listAppointments({ data: { from, to } }), placeholderData: keepPreviousData });
  const all = list.data ?? [];
  const rows = all.filter((a) => (dept === "all" || a.department === dept) && (status === "all" || a.status === status));
  const doctors = db.doctors.filter((d) => d.active);
  const doctor = (id: string | null) => (id ? db.doctors.find((d) => d.id === id)?.name : undefined);
  const count = (s: AppointmentStatus) => all.filter((a) => a.status === s).length;

  function startNew() {
    const now = new Date();
    setDraft({ patient: null, doctorId: "", department: "clinics", date: day, time: `${String(now.getHours()).padStart(2, "0")}:00`, durationMin: 15, reason: "", notes: "" });
  }
  function startEdit(a: Appointment) {
    const p = localParts(a.startsAt);
    setDraft({
      id: a.id,
      patient: { id: a.patientId, mrn: a.patientMrn, fullName: a.patientName, phone: a.patientPhone },
      doctorId: a.doctorId ?? "",
      department: a.department,
      date: p.date,
      time: p.time,
      durationMin: a.durationMin,
      reason: a.reason ?? "",
      notes: a.notes ?? "",
    });
  }
  async function save() {
    if (!draft) return;
    if (!draft.patient) {
      toast.error("اختر ملف المريض.");
      return;
    }
    if (!draft.department) {
      toast.error("اختر القسم.");
      return;
    }
    if (!draft.date || !draft.time) {
      toast.error("حدد يوم وساعة الموعد.");
      return;
    }
    setSaving(true);
    try {
      await saveAppointment({
        data: {
          id: draft.id,
          patientId: draft.patient.id,
          doctorId: draft.doctorId || null,
          department: draft.department,
          startsAt: new Date(`${draft.date}T${draft.time}:00`).toISOString(),
          durationMin: Math.max(5, Math.round(draft.durationMin) || 15),
          reason: draft.reason.trim() || null,
          notes: draft.notes.trim() || null,
        },
      });
      toast.success(draft.id ? "اتعدّل الموعد." : "اتحجز الموعد.");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (e) {
      toast.error(errorText(e, "تعذّر حفظ الموعد."));
    } finally {
      setSaving(false);
    }
  }
  async function mark(a: Appointment, s: AppointmentStatus) {
    try {
      await setAppointmentStatus({ data: { id: a.id, status: s } });
      toast.success(`${a.patientName}: ${APPOINTMENT_STATUS[s]}`);
      void qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (e) {
      toast.error(errorText(e, "تعذّر تحديث الموعد."));
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الملف الطبي"
        title="المواعيد والحجوزات"
        description="احجز موعد لأي مريض مع طبيب أو قسم، وسجّل وصوله والكشف أو الإلغاء. النظام بيمنع حجز نفس الطبيب في نفس الوقت."
        actions={
          canAdd && (
            <Button onClick={startNew}>
              <CalendarPlus /> موعد جديد
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="كل المواعيد" value={int(all.length)} icon={CalendarClock} tone="primary" />
        <StatCard label="محجوز" value={int(count("booked"))} />
        <StatCard label="وصل" value={int(count("arrived"))} icon={UserCheck} tone="copper" />
        <StatCard label="تم الكشف" value={int(count("done"))} icon={CalendarCheck2} tone="income" />
        <StatCard label="ملغي / لم يحضر" value={int(count("cancelled") + count("no_show"))} icon={CalendarX2} tone="expense" />
      </div>

      <FilterBar>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="اليوم السابق" onClick={() => setDay(shift(day, -days))}>
            <ChevronRight />
          </Button>
          <Input type="date" aria-label="اليوم" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" />
          <Button size="icon" variant="outline" aria-label="اليوم التالي" onClick={() => setDay(shift(day, days))}>
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDay(isoDate(new Date()))}>النهارده</Button>
        </div>
        <select aria-label="المدة" value={days} onChange={(e) => setDays(Number(e.target.value) as 1 | 7)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
          <option value={1}>يوم واحد</option>
          <option value={7}>أسبوع</option>
        </select>
        <DeptSelect value={dept} onChange={setDept} allowAll className="w-48" />
        <select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
          <option value="all">كل الحالات</option>
          {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </FilterBar>

      <TableCard minWidth={1000}>
        <thead>
          <HeadRow>
            <Th>الموعد</Th>
            <Th>المريض</Th>
            <Th>القسم</Th>
            <Th>الطبيب</Th>
            <Th>السبب</Th>
            <Th>الحالة</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
              <Td className="whitespace-nowrap">
                <b className="num">{timeOf(a.startsAt)}</b>
                {days > 1 && <div className="text-xs text-muted-foreground">{dateLabel(localParts(a.startsAt).date)}</div>}
                <div className="text-[11px] text-muted-foreground">{int(a.durationMin)} دقيقة</div>
              </Td>
              <Td>
                <div className="font-semibold">{a.patientName}</div>
                <div className="num text-xs text-muted-foreground">{a.patientMrn}{a.patientPhone ? ` • ${a.patientPhone}` : ""}</div>
              </Td>
              <Td>{findDepartment(db.departments, a.department).name}</Td>
              <Td>{doctor(a.doctorId) ? `د. ${doctor(a.doctorId)}` : "—"}</Td>
              <Td className="max-w-56 text-xs">{a.reason || "—"}</Td>
              <Td>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", STATUS_TONE[a.status])}>{APPOINTMENT_STATUS[a.status]}</span>
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {canAdd && a.status === "booked" && (
                    <>
                      <Button size="sm" onClick={() => void mark(a, "arrived")}>وصل</Button>
                      <Button size="sm" variant="ghost" onClick={() => void mark(a, "no_show")}>لم يحضر</Button>
                    </>
                  )}
                  {canAdd && a.status === "arrived" && <Button size="sm" onClick={() => void mark(a, "done")}>تم الكشف</Button>}
                  {canAdd && (a.status === "booked" || a.status === "arrived") && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void mark(a, "cancelled")}>إلغاء</Button>
                  )}
                  {canAdd && (a.status === "cancelled" || a.status === "no_show") && (
                    <Button size="sm" variant="ghost" onClick={() => void mark(a, "booked")}>إرجاع للحجز</Button>
                  )}
                  {canEdit && a.status !== "done" && <Button size="sm" variant="outline" onClick={() => startEdit(a)}>تعديل</Button>}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={7} text={list.isLoading ? "جارٍ التحميل..." : list.isError ? errorText(list.error, "تعذّر تحميل المواعيد.") : "مفيش مواعيد في الفترة دي."} />}
        </tbody>
      </TableCard>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "تعديل الموعد" : "حجز موعد جديد"}</DialogTitle>
            <DialogDescription>المريض لازم يكون له ملف — لو جديد افتح ملفه من صفحة ملفات المرضى الأول.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="المريض" className="sm:col-span-2">
                <PatientPicker value={draft.patient} onChange={(patient) => setDraft({ ...draft, patient })} section="appointments" />
              </FieldRow>
              <FieldRow label="القسم">
                <DeptSelect value={draft.department} onChange={(department) => setDraft({ ...draft, department })} />
              </FieldRow>
              <FieldRow label="الطبيب">
                <select aria-label="الطبيب" value={draft.doctorId} onChange={(e) => setDraft({ ...draft, doctorId: e.target.value })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">بدون طبيب محدد</option>
                  {[...doctors]
                    .sort((a, b) => Number(b.department === draft.department) - Number(a.department === draft.department))
                    .map((d) => (
                      <option key={d.id} value={d.id}>د. {d.name} — {d.specialty}</option>
                    ))}
                </select>
              </FieldRow>
              <FieldRow label="اليوم" htmlFor="ap-date">
                <Input id="ap-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </FieldRow>
              <FieldRow label="الساعة" htmlFor="ap-time">
                <Input id="ap-time" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
              </FieldRow>
              <FieldRow label="المدة (دقيقة)" htmlFor="ap-dur">
                <Input id="ap-dur" type="number" min={5} max={600} step={5} value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })} />
              </FieldRow>
              <FieldRow label="سبب الزيارة" htmlFor="ap-reason">
                <Input id="ap-reason" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="مثال: متابعة" />
              </FieldRow>
              <FieldRow label="ملاحظات" htmlFor="ap-notes" className="sm:col-span-2">
                <Textarea id="ap-notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>إلغاء</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الموعد"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
