import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeptSelect, FieldRow } from "@/components/hospital/kit";
import { dateLabel, isoDate } from "@/lib/hospital/format";
import { parseNationalId } from "@/lib/hospital/national-id";
import { newId, saveEmployeeFile, useHospitalDB, type Employee } from "@/lib/hospital/store";

type Draft = {
  name: string;
  nationalId: string;
  jobTitle: string;
  department: string;
  hireDate: string;
  phone: string;
  address: string;
  birthDate: string;
  gender: "" | "male" | "female";
  maritalStatus: string;
  qualification: string;
  insuranceNo: string;
  emergencyContact: string;
  leftOn: string;
};

const toDraft = (e: Employee | null): Draft => ({
  name: e?.name ?? "",
  nationalId: e?.nationalId ?? "",
  jobTitle: e?.jobTitle ?? "",
  department: e?.department ?? "general",
  hireDate: e?.hireDate ?? isoDate(new Date()),
  phone: e?.personal?.phone ?? "",
  address: e?.personal?.address ?? "",
  birthDate: e?.personal?.birthDate ?? "",
  gender: e?.personal?.gender ?? "",
  maritalStatus: e?.personal?.maritalStatus ?? "",
  qualification: e?.personal?.qualification ?? "",
  insuranceNo: e?.personal?.insuranceNo ?? "",
  emergencyContact: e?.personal?.emergencyContact ?? "",
  leftOn: e?.personal?.leftOn ?? "",
});

/** Personal file of an employee (شؤون العاملين). Salaries stay on the payroll page / contract. */
export function EmployeeFileDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: Employee | null;
  onSaved?: (id: string) => void;
}) {
  const { lists } = useHospitalDB();
  const [d, setD] = useState<Draft>(toDraft(null));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setD(toDraft(employee));
    setError("");
  }, [open, employee]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const nidDigits = d.nationalId.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\s/g, "");
  const nid = nidDigits ? parseNationalId(nidDigits) : null;

  function readNid() {
    if (!nid || "error" in nid) return;
    setD((x) => ({ ...x, birthDate: x.birthDate || nid.birthDate, gender: x.gender || nid.gender }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) return setError("اكتب اسم الموظف.");
    if (nid && "error" in nid) return setError(nid.error);
    if (!d.jobTitle.trim()) return setError("اكتب الوظيفة.");
    const id = employee?.id ?? newId();
    const info = nid && !("error" in nid) ? nid : null;
    const ok = saveEmployeeFile({
      id,
      base: {
        name: d.name.trim(),
        jobTitle: d.jobTitle.trim(),
        department: d.department,
        hireDate: d.hireDate,
        nationalId: nidDigits || undefined,
      },
      personal: {
        phone: d.phone.trim() || undefined,
        address: d.address.trim() || undefined,
        birthDate: d.birthDate || info?.birthDate || undefined,
        gender: d.gender || info?.gender || undefined,
        maritalStatus: d.maritalStatus.trim() || undefined,
        qualification: d.qualification.trim() || undefined,
        insuranceNo: d.insuranceNo.trim() || undefined,
        emergencyContact: d.emergencyContact.trim() || undefined,
        leftOn: d.leftOn || undefined,
      },
    });
    if (!ok) return;
    onOpenChange(false);
    onSaved?.(id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{employee ? `ملف ${employee.name}` : "ملف موظف جديد"}</DialogTitle>
          <DialogDescription>اكتب الرقم القومي ليُقرأ منه تاريخ الميلاد والنوع والمحافظة تلقائيًا.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="الاسم رباعي" htmlFor="ef-name">
              <Input id="ef-name" value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </FieldRow>
            <FieldRow label="الرقم القومي (١٤ رقمًا)" htmlFor="ef-nid">
              <Input id="ef-nid" dir="ltr" inputMode="numeric" maxLength={14} value={d.nationalId} onChange={(e) => set("nationalId", e.target.value)} onBlur={readNid} />
              {nid && ("error" in nid ? (
                <span className="text-xs text-destructive">{nid.error}</span>
              ) : (
                <span className="text-xs text-income">
                  مواليد {dateLabel(nid.birthDate)} — {nid.gender === "male" ? "ذكر" : "أنثى"} — {nid.governorate}
                </span>
              ))}
            </FieldRow>
            <FieldRow label="الوظيفة" htmlFor="ef-job">
              <Input id="ef-job" list="ef-jobs" value={d.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
              <datalist id="ef-jobs">
                {lists.jobTitles.map((j) => (
                  <option key={j.id} value={j.name} />
                ))}
              </datalist>
            </FieldRow>
            <FieldRow label="القسم">
              <DeptSelect value={d.department} onChange={(v) => set("department", v)} />
            </FieldRow>
            <FieldRow label="تاريخ التعيين" htmlFor="ef-hire">
              <Input id="ef-hire" type="date" value={d.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
            </FieldRow>
            <FieldRow label="التليفون" htmlFor="ef-phone">
              <Input id="ef-phone" dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
            </FieldRow>
            <FieldRow label="العنوان" htmlFor="ef-addr" className="sm:col-span-2">
              <Input id="ef-addr" value={d.address} onChange={(e) => set("address", e.target.value)} />
            </FieldRow>
            <FieldRow label="تاريخ الميلاد" htmlFor="ef-birth">
              <Input id="ef-birth" type="date" value={d.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
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
            <FieldRow label="الحالة الاجتماعية" htmlFor="ef-ms">
              <Input id="ef-ms" value={d.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} placeholder="أعزب / متزوج ..." />
            </FieldRow>
            <FieldRow label="المؤهل" htmlFor="ef-q">
              <Input id="ef-q" value={d.qualification} onChange={(e) => set("qualification", e.target.value)} />
            </FieldRow>
            <FieldRow label="الرقم التأميني" htmlFor="ef-ins">
              <Input id="ef-ins" dir="ltr" value={d.insuranceNo} onChange={(e) => set("insuranceNo", e.target.value)} />
            </FieldRow>
            <FieldRow label="شخص للطوارئ (الاسم والتليفون)" htmlFor="ef-em">
              <Input id="ef-em" value={d.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} />
            </FieldRow>
            {employee && (
              <FieldRow label="تاريخ ترك العمل (إن وُجد)" htmlFor="ef-left">
                <Input id="ef-left" type="date" value={d.leftOn} onChange={(e) => set("leftOn", e.target.value)} />
              </FieldRow>
            )}
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ الملف</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
