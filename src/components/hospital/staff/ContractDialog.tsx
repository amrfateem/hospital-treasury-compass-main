import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DeptSelect, FieldRow } from "@/components/hospital/kit";
import { addMonths } from "@/lib/hospital/credit";
import { egp, isoDate } from "@/lib/hospital/format";
import { CONTRACT_TYPES, contractProblem, type ContractInput } from "@/lib/hospital/hr";
import { saveContract, type Employee, type EmploymentContract } from "@/lib/hospital/store";

type Draft = Record<keyof Omit<ContractInput, "employeeId" | "type" | "department">, string> & {
  type: EmploymentContract["type"];
  department: string;
};

function toDraft(employee: Employee, c: EmploymentContract | null): Draft {
  const today = isoDate(new Date());
  const start = c?.startDate ?? today;
  return {
    type: c?.type ?? "fixed",
    date: c?.date ?? today,
    startDate: start,
    endDate: c?.endDate ?? addMonths(start, 12),
    probationMonths: String(c?.probationMonths ?? 3),
    jobTitle: c?.jobTitle ?? employee.jobTitle,
    department: c?.department ?? employee.department,
    basicSalary: c ? String(c.basicSalary) : employee.fixedSalary ? String(employee.fixedSalary) : "",
    allowances: c ? String(c.allowances) : employee.variableSalary ? String(employee.variableSalary) : "0",
    dailyHours: String(c?.dailyHours ?? 8),
    weeklyDays: String(c?.weeklyDays ?? 6),
    annualLeaveDays: String(c?.annualLeaveDays ?? 21),
    noticeDays: String(c?.noticeDays ?? 60),
    extraClauses: c?.extraClauses ?? "",
  };
}

/** Writes (or edits) a draft employment contract; it is printed, signed with a pen, then recorded as signed. */
export function ContractDialog({
  open,
  onOpenChange,
  employee,
  contract,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: Employee;
  contract: EmploymentContract | null;
  /** `andPrint`: the person chose "save and print" to hand the paper copy for signing. */
  onSaved?: (id: string, andPrint: boolean) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(employee, contract));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setD(toDraft(employee, contract));
    setError("");
  }, [open, employee, contract]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const andPrint = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "print";
    const input: ContractInput = {
      employeeId: employee.id,
      type: d.type,
      date: d.date,
      startDate: d.startDate,
      endDate: d.type === "fixed" ? d.endDate : undefined,
      probationMonths: Number(d.probationMonths) || 0,
      jobTitle: d.jobTitle.trim(),
      department: d.department,
      basicSalary: Number(d.basicSalary) || 0,
      allowances: Number(d.allowances) || 0,
      dailyHours: Number(d.dailyHours) || 0,
      weeklyDays: Number(d.weeklyDays) || 0,
      annualLeaveDays: Number(d.annualLeaveDays) || 0,
      noticeDays: Number(d.noticeDays) || 0,
      extraClauses: d.extraClauses,
    };
    const problem = contractProblem(input, employee);
    if (problem) return setError(problem);
    const id = saveContract(input, contract);
    if (!id) return;
    onOpenChange(false);
    onSaved?.(id, andPrint);
  }

  const num = (k: keyof Draft, label: string, extra?: { min?: number; max?: number; step?: string }) => (
    <FieldRow label={label} htmlFor={`ct-${k}`}>
      <Input id={`ct-${k}`} type="number" min={extra?.min ?? 0} max={extra?.max} step={extra?.step ?? "1"} value={d[k]} onChange={(e) => set(k, e.target.value as never)} />
    </FieldRow>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{contract ? `تعديل مسودة العقد ${contract.number}` : `عقد عمل جديد — ${employee.name}`}</DialogTitle>
          <DialogDescription>بنود العقد تُكتب تلقائيًا وفق قانون العمل المصري من البيانات التالية، ويمكنك إضافة بنود خاصة.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow label="نوع العقد">
              <Select value={d.type} onValueChange={(v) => set("type", v as Draft["type"])}>
                <SelectTrigger aria-label="نوع العقد"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {Object.entries(CONTRACT_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="تاريخ تحرير العقد" htmlFor="ct-date">
              <Input id="ct-date" type="date" value={d.date} onChange={(e) => set("date", e.target.value)} />
            </FieldRow>
            <FieldRow label="بداية العمل" htmlFor="ct-start">
              <Input id="ct-start" type="date" value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </FieldRow>
            {d.type === "fixed" && (
              <FieldRow label="نهاية العقد" htmlFor="ct-end">
                <Input id="ct-end" type="date" value={d.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </FieldRow>
            )}
            <FieldRow label="الوظيفة" htmlFor="ct-job">
              <Input id="ct-job" value={d.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
            </FieldRow>
            <FieldRow label="القسم">
              <DeptSelect value={d.department} onChange={(v) => set("department", v)} />
            </FieldRow>
            {num("basicSalary", "الأجر الأساسي الشهري (ج.م)", { step: "0.01" })}
            {num("allowances", "البدلات الشهرية (ج.م)", { step: "0.01" })}
            {num("probationMonths", "فترة الاختبار (شهور)", { max: 3 })}
            {num("dailyHours", "ساعات العمل يوميًا", { min: 1, max: 8 })}
            {num("weeklyDays", "أيام العمل أسبوعيًا", { min: 1, max: 6 })}
            {num("annualLeaveDays", "الإجازة السنوية (يوم)")}
            {num("noticeDays", "مهلة الإخطار عند الإنهاء (يوم)")}
          </div>
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
            إجمالي الأجر الشهري: <b className="num">{egp((Number(d.basicSalary) || 0) + (Number(d.allowances) || 0))}</b> — بعد طباعة العقد
            وتوقيع الموظف عليه بالقلم، سجّل التوقيع من ملفه ليُحدَّث أجره ووظيفته وقسمه في الأجور تلقائيًا.
          </p>
          <FieldRow label="بنود خاصة (كل بند في سطر)" htmlFor="ct-extra">
            <Textarea id="ct-extra" rows={3} value={d.extraClauses} onChange={(e) => set("extraClauses", e.target.value)} placeholder="مثال: يلتزم الطرف الثاني بالعمل بنظام النوبتجيات الليلية بالتناوب." />
          </FieldRow>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" value="print">
              <Printer /> حفظ وطباعة العقد للتوقيع
            </Button>
            <Button type="submit" variant="secondary" value="save">حفظ فقط</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
