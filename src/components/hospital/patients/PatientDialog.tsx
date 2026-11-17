import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldRow } from "@/components/hospital/kit";
import { dateLabel } from "@/lib/hospital/format";
import { parseNationalId } from "@/lib/hospital/national-id";
import { errorText } from "@/lib/hospital/upload";
import { savePatient } from "@/lib/medical/medical.functions";
import type { Patient } from "@/lib/medical/model";

type Draft = Record<"fullName" | "nationalId" | "birthDate" | "phone" | "address" | "bloodType" | "allergies" | "chronicConditions" | "emergencyContact" | "notes", string> & {
  gender: "" | "male" | "female";
};
const toDraft = (p: Patient | null): Draft => ({
  fullName: p?.fullName ?? "",
  nationalId: p?.nationalId ?? "",
  birthDate: p?.birthDate ?? "",
  gender: p?.gender ?? "",
  phone: p?.phone ?? "",
  address: p?.address ?? "",
  bloodType: p?.bloodType ?? "",
  allergies: p?.allergies ?? "",
  chronicConditions: p?.chronicConditions ?? "",
  emergencyContact: p?.emergencyContact ?? "",
  notes: p?.notes ?? "",
});
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function PatientDialog({
  open,
  onOpenChange,
  patient,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: Patient | null;
  onSaved: (p: Patient) => void;
}) {
  const [d, setD] = useState<Draft>(toDraft(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setD(toDraft(patient));
    setError("");
  }, [open, patient]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const nidDigits = d.nationalId.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\s/g, "");
  const nid = nidDigits ? parseNationalId(nidDigits) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (d.fullName.trim().length < 2) return setError("اكتب اسم المريض.");
    if (nid && "error" in nid) return setError(nid.error);
    const info = nid && !("error" in nid) ? nid : null;
    const t = (v: string) => (v.trim() ? v.trim() : null);
    setBusy(true);
    try {
      const saved = await savePatient({
        data: {
          id: patient?.id,
          fullName: d.fullName.trim(),
          nationalId: nidDigits || null,
          birthDate: d.birthDate || info?.birthDate || null,
          gender: d.gender || info?.gender || null,
          phone: t(d.phone),
          address: t(d.address),
          bloodType: t(d.bloodType),
          allergies: t(d.allergies),
          chronicConditions: t(d.chronicConditions),
          emergencyContact: t(d.emergencyContact),
          notes: t(d.notes),
        },
      });
      toast.success(patient ? "تم حفظ التعديلات." : `تم فتح ملف جديد برقم ${saved.mrn}.`);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err, "تعذّر حفظ ملف المريض."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{patient ? `ملف ${patient.fullName}` : "ملف مريض جديد"}</DialogTitle>
          <DialogDescription>{patient ? <span dir="ltr">{patient.mrn}</span> : "يُعطى المريض رقم ملف تلقائيًا، وتُربط به كل إيصالاته."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="اسم المريض" htmlFor="pt-name">
              <Input id="pt-name" value={d.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus />
            </FieldRow>
            <FieldRow label="الرقم القومي (اختياري)" htmlFor="pt-nid">
              <Input id="pt-nid" dir="ltr" inputMode="numeric" maxLength={14} value={d.nationalId} onChange={(e) => set("nationalId", e.target.value)} />
              {nid && ("error" in nid ? (
                <span className="text-xs text-destructive">{nid.error}</span>
              ) : (
                <span className="text-xs text-income">مواليد {dateLabel(nid.birthDate)} — {nid.gender === "male" ? "ذكر" : "أنثى"}</span>
              ))}
            </FieldRow>
            <FieldRow label="التليفون" htmlFor="pt-phone">
              <Input id="pt-phone" dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
            </FieldRow>
            <FieldRow label="تاريخ الميلاد" htmlFor="pt-birth">
              <Input id="pt-birth" type="date" value={d.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
            </FieldRow>
            <FieldRow label="النوع">
              <Select value={d.gender || "none"} onValueChange={(v) => set("gender", v === "none" ? "" : (v as "male" | "female"))}>
                <SelectTrigger aria-label="النوع"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="none">غير محدد</SelectItem>
                  <SelectItem value="male">ذكر</SelectItem>
                  <SelectItem value="female">أنثى</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="فصيلة الدم">
              <Select value={d.bloodType || "none"} onValueChange={(v) => set("bloodType", v === "none" ? "" : v)}>
                <SelectTrigger aria-label="فصيلة الدم"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="none">غير معروفة</SelectItem>
                  {BLOOD.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="العنوان" htmlFor="pt-addr" className="sm:col-span-2">
              <Input id="pt-addr" value={d.address} onChange={(e) => set("address", e.target.value)} />
            </FieldRow>
            <FieldRow label="حساسية من" htmlFor="pt-all">
              <Input id="pt-all" value={d.allergies} onChange={(e) => set("allergies", e.target.value)} />
            </FieldRow>
            <FieldRow label="أمراض مزمنة" htmlFor="pt-chr">
              <Input id="pt-chr" value={d.chronicConditions} onChange={(e) => set("chronicConditions", e.target.value)} />
            </FieldRow>
            <FieldRow label="شخص للطوارئ" htmlFor="pt-em" className="sm:col-span-2">
              <Input id="pt-em" value={d.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} />
            </FieldRow>
            <FieldRow label="ملاحظات" htmlFor="pt-notes" className="sm:col-span-2">
              <Textarea id="pt-notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </FieldRow>
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy}>حفظ الملف</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
