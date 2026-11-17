import { FolderOpen, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeptSelect, FieldRow, MethodSelect } from "@/components/hospital/kit";
import { findPatientsForBilling, openPatientFromBilling, type PatientRefLite } from "@/lib/medical/medical.functions";
import { stayRates } from "@/lib/hospital/catalog";
import { int, isoDate } from "@/lib/hospital/format";
import { addAdmissionDeposit, openAdmission, useHospitalDB } from "@/lib/hospital/store";

const NONE = "__none__";

/** Admission: the patient's file, ward, daily rates and the deposit paid on entry. */
export function NewAdmissionDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpened: (id: string) => void;
}) {
  const db = useHospitalDB();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [patient, setPatient] = useState<{ id: string; mrn: string } | null>(null);
  const [suggest, setSuggest] = useState<PatientRefLite[]>([]);
  const [ward, setWard] = useState("inpatient");
  const [room, setRoom] = useState("");
  const [doctorId, setDoctorId] = useState(NONE);
  const [payerId, setPayerId] = useState(NONE);
  const [pct, setPct] = useState("");
  const [date, setDate] = useState(isoDate(new Date()));
  const [rates, setRates] = useState({ room: "", sup: "" });
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function ratesFor(w: string) {
    const r = stayRates(db.lists.services, w);
    setRates({ room: r.roomRate ? String(r.roomRate) : "", sup: r.supervisionRate ? String(r.supervisionRate) : "" });
  }
  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setPatient(null);
    setSuggest([]);
    setWard("inpatient");
    ratesFor("inpatient");
    setRoom("");
    setDoctorId(NONE);
    setPayerId(NONE);
    setPct("");
    setDate(isoDate(new Date()));
    setDeposit("");
    setMethod("cash");
    setError("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || patient) return;
    const q = name.trim().length >= 2 ? name.trim() : phone.trim();
    if (q.length < 2) return setSuggest([]);
    let live = true;
    const t = setTimeout(() => {
      findPatientsForBilling({ data: { q } })
        .then((r) => live && setSuggest(r))
        .catch(() => live && setSuggest([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, patient, name, phone]);

  const payer = payerId !== NONE ? db.lists.payers.find((p) => p.id === payerId) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("اكتب اسم المريض.");
    if (!ward) return setError("اختر القسم الذي يقيم فيه المريض.");
    if (!(Number(rates.room) > 0)) return setError("اكتب سعر يوم الإقامة.");
    let linked = patient;
    if (!linked) {
      setBusy(true);
      try {
        const p = await openPatientFromBilling({ data: { fullName: name.trim(), phone: phone.trim() || null } });
        linked = { id: p.id, mrn: p.mrn };
      } catch {
        toast.warning("فُتح الحساب بدون ربطه بملف مريض (تعذّر فتح الملف).");
      } finally {
        setBusy(false);
      }
    }
    const id = openAdmission({
      date,
      patientName: name.trim(),
      patientPhone: phone.trim() || undefined,
      patientId: linked?.id,
      patientMrn: linked?.mrn,
      ward,
      room: room.trim() || undefined,
      doctorId: doctorId !== NONE ? doctorId : undefined,
      payer: payer ? { payerId: payer.id, percent: Number(pct) || 0 } : undefined,
      roomRate: Number(rates.room) || 0,
      supervisionRate: Number(rates.sup) || 0,
    });
    if (!id) return;
    if (Number(deposit) > 0) addAdmissionDeposit({ admissionId: id, date, amount: Number(deposit), method });
    toast.success(Number(deposit) > 0 ? "تم فتح حساب الإقامة وتسجيل التأمين بالخزينة." : "تم فتح حساب الإقامة.");
    onOpenChange(false);
    onOpened(id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">دخول مريض للإقامة</DialogTitle>
          <DialogDescription>يُفتح للمريض حساب واحد: التأمين المقدم الآن، وكل خدمة أو دواء أو يوم إقامة يتضاف عليه، والفاتورة النهائية عند الخروج.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="اسم المريض" htmlFor="ad-name" className="relative">
            <Input id="ad-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={!!patient} autoComplete="off" autoFocus />
            {patient ? (
              <span className="patient-link">
                <FolderOpen className="size-3.5" /> ملف <span dir="ltr" className="num">{patient.mrn}</span>
                <button type="button" onClick={() => setPatient(null)} aria-label="فك الربط بملف المريض" className="mr-auto rounded p-0.5 hover:bg-muted">
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              suggest.length > 0 && (
                <div role="listbox" aria-label="ملفات مرضى مطابقة" className="patient-suggest">
                  {suggest.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setPatient({ id: p.id, mrn: p.mrn });
                        setName(p.fullName);
                        if (p.phone) setPhone(p.phone);
                        setSuggest([]);
                      }}
                      className="patient-suggest-item"
                    >
                      <span className="font-semibold">{p.fullName}</span>
                      <span className="num text-xs text-muted-foreground" dir="ltr">
                        {p.mrn}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}
          </FieldRow>
          <FieldRow label="التليفون (اختياري)" htmlFor="ad-phone">
            <Input id="ad-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </FieldRow>
          <FieldRow label="قسم الإقامة">
            <DeptSelect
              value={ward}
              onChange={(v) => {
                setWard(v);
                ratesFor(v);
              }}
            />
          </FieldRow>
          <FieldRow label="رقم الغرفة / السرير" htmlFor="ad-room">
            <Input id="ad-room" value={room} onChange={(e) => setRoom(e.target.value)} />
          </FieldRow>
          <FieldRow label="سعر يوم الإقامة" htmlFor="ad-rr">
            <Input id="ad-rr" type="number" min="0" step="0.01" value={rates.room} onChange={(e) => setRates({ ...rates, room: e.target.value })} />
          </FieldRow>
          <FieldRow label="الإشراف الطبي / يوم" htmlFor="ad-sr">
            <Input id="ad-sr" type="number" min="0" step="0.01" value={rates.sup} onChange={(e) => setRates({ ...rates, sup: e.target.value })} />
          </FieldRow>
          {db.doctors.length > 0 && (
            <FieldRow label="الطبيب المشرف">
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger aria-label="الطبيب المشرف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value={NONE}>بدون طبيب محدد</SelectItem>
                  {db.doctors
                    .filter((d) => d.active)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        د. {d.name} — {d.specialty}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
          <FieldRow label="تاريخ الدخول" htmlFor="ad-date">
            <Input id="ad-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </FieldRow>
          {db.lists.payers.length > 0 && (
            <>
              <FieldRow label="جهة التعاقد / التأمين">
                <Select
                  value={payerId}
                  onValueChange={(v) => {
                    setPayerId(v);
                    const p = db.lists.payers.find((x) => x.id === v);
                    setPct(p ? String(p.percent) : "");
                  }}
                >
                  <SelectTrigger aria-label="جهة التعاقد">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value={NONE}>بدون — المريض يدفع كل الحساب</SelectItem>
                    {db.lists.payers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({int(p.percent)}٪)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="نسبة تغطية الجهة (٪)" htmlFor="ad-pct">
                <Input id="ad-pct" type="number" min="0" max="100" disabled={!payer} value={pct} onChange={(e) => setPct(e.target.value)} />
              </FieldRow>
            </>
          )}
          <fieldset className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">التأمين المقدم عند الدخول</legend>
            <FieldRow label="المبلغ (ج.م)" htmlFor="ad-dep">
              <Input id="ad-dep" type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="اتركه فارغًا لو لم يدفع" className="bg-card" />
            </FieldRow>
            <FieldRow label="طريقة الدفع">
              <MethodSelect value={method} onChange={setMethod} />
            </FieldRow>
          </fieldset>
          {error && <p className="text-sm font-medium text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="gap-2 sm:col-span-2 sm:justify-start">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              فتح حساب الإقامة
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
