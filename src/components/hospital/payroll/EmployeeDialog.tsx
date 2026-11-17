import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { DeptSelect } from "@/components/hospital/kit";
import type { DepartmentId } from "@/lib/hospital/constants";
import { egp } from "@/lib/hospital/format";
import { computeMonthlyPayroll } from "@/lib/hospital/payroll-tax";
import {
  newId,
  saveEmployee,
  useHospitalDB,
  type Employee,
  type HospitalSettings,
} from "@/lib/hospital/store";

type Draft = {
  name: string;
  jobTitle: string;
  department: DepartmentId;
  hireDate: string;
  fixedSalary: string;
  variableSalary: string;
  nationalId: string;
};

const blank = (department: DepartmentId): Draft => ({
  name: "",
  jobTitle: "",
  department,
  hireDate: "",
  fixedSalary: "",
  variableSalary: "",
  nationalId: "",
});

export function EmployeeDialog({
  open,
  onOpenChange,
  employee,
  defaultDepartment = "lab",
  settings,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: Employee | null;
  defaultDepartment?: DepartmentId;
  settings: HospitalSettings;
}) {
  const { lists } = useHospitalDB();
  const [d, setD] = useState<Draft>(blank(defaultDepartment));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setD(
      employee
        ? {
            name: employee.name,
            jobTitle: employee.jobTitle,
            department: employee.department,
            hireDate: employee.hireDate,
            fixedSalary: String(employee.fixedSalary),
            variableSalary: String(employee.variableSalary),
            nationalId: employee.nationalId ?? "",
          }
        : blank(defaultDepartment),
    );
  }, [open, employee, defaultDepartment]);

  const preview = computeMonthlyPayroll(
    Number(d.fixedSalary) || 0,
    Number(d.variableSalary) || 0,
    settings,
  );
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.name.trim() || !d.jobTitle.trim()) return setError("اكتب اسم الموظف والمسمى الوظيفي.");
    if (!d.hireDate) return setError("حدد تاريخ التعيين.");
    const fixed = Number(d.fixedSalary);
    const variable = Number(d.variableSalary || 0);
    if (!(fixed > 0)) return setError("الأجر الأساسي الثابت يجب أن يكون أكبر من صفر.");
    if (variable < 0) return setError("الأجر المتغير لا يمكن أن يكون بالسالب.");
    saveEmployee({
      id: employee?.id ?? newId(),
      name: d.name.trim(),
      jobTitle: d.jobTitle.trim(),
      department: d.department,
      hireDate: d.hireDate,
      fixedSalary: fixed,
      variableSalary: variable,
      nationalId: d.nationalId.trim() || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" dir="rtl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {employee ? "تعديل بيانات موظف" : "إضافة موظف جديد"}
          </DialogTitle>
          <DialogDescription>
            يتم احتساب التأمينات وضريبة كسب العمل والصافي تلقائيًا.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="emp-name">اسم الموظف</Label>
              <Input
                id="emp-name"
                value={d.name}
                onChange={set("name")}
                placeholder="مثال: د. محمد أحمد"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="emp-title">المسمى الوظيفي</Label>
              <Input
                id="emp-title"
                list="job-titles"
                value={d.jobTitle}
                onChange={set("jobTitle")}
                placeholder="اختر من القائمة أو اكتب مسمى جديد"
              />
              <datalist id="job-titles">
                {lists.jobTitles.map((j) => (
                  <option key={j.id} value={j.name} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label>القسم (مركز التكلفة)</Label>
              <DeptSelect value={d.department} onChange={(v) => setD({ ...d, department: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="emp-hire">تاريخ التعيين (لحساب مدة العمل)</Label>
              <Input id="emp-hire" type="date" value={d.hireDate} onChange={set("hireDate")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="emp-fixed">الأجر الأساسي الثابت (شهريًا)</Label>
              <Input
                id="emp-fixed"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={d.fixedSalary}
                onChange={set("fixedSalary")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="emp-var">الأجر المتغير / البدلات / الحوافز</Label>
              <Input
                id="emp-var"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={d.variableSalary}
                onChange={set("variableSalary")}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="emp-nid">الرقم القومي (اختياري)</Label>
              <Input
                id="emp-nid"
                value={d.nationalId}
                onChange={set("nationalId")}
                inputMode="numeric"
                maxLength={14}
              />
            </div>
          </div>

          <div className="rounded-lg border border-dashed bg-muted/60 p-3 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              <span className="text-muted-foreground">إجمالي الأجر</span>
              <span className="num text-left font-semibold">{egp(preview.gross)}</span>
              <span className="text-muted-foreground">التأمينات (حصة العامل)</span>
              <span className="num text-left text-expense">{egp(preview.socialInsurance)}</span>
              <span className="text-muted-foreground">ضريبة كسب العمل</span>
              <span className="num text-left text-expense">{egp(preview.incomeTax)}</span>
              <span className="font-semibold">صافي الأجر</span>
              <span className="num text-left font-bold text-income">{egp(preview.net)}</span>
            </div>
          </div>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{employee ? "حفظ التعديلات" : "إضافة الموظف"}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
