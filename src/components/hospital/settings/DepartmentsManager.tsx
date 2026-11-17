import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FieldRow, matches, SearchBox } from "@/components/hospital/kit";
import {
  DEPT_COLORS,
  DEPT_GROUPS,
  deptColor,
  type Department,
  type DeptColor,
  type DeptGroup,
} from "@/lib/hospital/constants";
import { int } from "@/lib/hospital/format";
import {
  canDeleteDepartment,
  deleteDepartment,
  departmentUsage,
  restoreDefaultDepartments,
  saveDepartment,
  useHospitalDB,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export function DepartmentsManager() {
  const db = useHospitalDB();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const activeCount = db.departments.filter((d) => d.active).length;

  return (
    <div className="space-y-4">
      <div className="ledger-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">أقسام المستشفى (الهيكل الوظيفي)</h2>
          <p className="text-sm text-muted-foreground">
            {int(db.departments.length)} قسم — {int(activeCount)} مفعّل. القسم الموقوف يختفي من
            القوائم ويبقى في السجلات القديمة.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="بحث عن قسم"
            className="sm:w-56"
          />
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> إضافة قسم
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              restoreDefaultDepartments();
              toast.success("تمت إضافة أي أقسام افتراضية محذوفة.");
            }}
          >
            <RotateCcw /> استعادة الأقسام الافتراضية
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {DEPT_GROUPS.map((g) => {
          const list = db.departments.filter(
            (d) => d.group === g.id && matches(query, d.name, d.code),
          );
          if (!list.length && query) return null;
          return (
            <section key={g.id} className="ledger-card overflow-hidden">
              <div className="flex items-center justify-between border-b bg-secondary/60 px-4 py-2.5">
                <h3 className="text-base font-bold text-secondary-foreground">{g.name}</h3>
                <span className="num text-xs text-muted-foreground">{int(list.length)}</span>
              </div>
              <ul className="divide-y">
                {list.map((d) => {
                  const used = departmentUsage(db, d.id);
                  const deletable = canDeleteDepartment(db, d.id);
                  return (
                    <li
                      key={d.id}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5",
                        !d.active && "opacity-60",
                      )}
                    >
                      <span
                        className={cn("size-3 shrink-0 rounded-full", deptColor(d.color).dot)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-mono" dir="ltr">
                            {d.code}
                          </span>
                          {used > 0 && <> • {int(used)} سجل</>}
                          {d.system && <> • أساسي</>}
                        </p>
                      </div>
                      <Switch
                        checked={d.active}
                        aria-label={d.active ? `إيقاف ${d.name}` : `تفعيل ${d.name}`}
                        disabled={d.system}
                        onCheckedChange={(c) => saveDepartment({ ...d, active: c })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`تعديل ${d.name}`}
                        onClick={() => {
                          setEditing(d);
                          setOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف ${d.name}`}
                        className="text-muted-foreground hover:text-destructive"
                        title={
                          deletable
                            ? "حذف"
                            : d.system
                              ? "قسم أساسي لا يُحذف"
                              : "عليه سجلات — يمكنك إيقافه بدلًا من حذفه"
                        }
                        onClick={() => {
                          if (!deletable) {
                            toast.error(
                              d.system
                                ? "هذا قسم أساسي لا يمكن حذفه."
                                : `لا يمكن حذف ${d.name} لأن عليه ${int(used)} سجل. أوقفه بدلًا من ذلك.`,
                            );
                            return;
                          }
                          if (window.confirm(`حذف قسم ${d.name}؟`) && deleteDepartment(d.id))
                            toast.success("تم حذف القسم.");
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
                {!list.length && (
                  <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                    لا توجد أقسام في هذه المجموعة.
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <DepartmentDialog open={open} onOpenChange={setOpen} department={editing} />
    </div>
  );
}

function newDeptId(taken: Set<string>) {
  let id = `d-${Date.now().toString(36)}`;
  while (taken.has(id)) id += "x";
  return id;
}

function DepartmentDialog({
  open,
  onOpenChange,
  department,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department: Department | null;
}) {
  const db = useHospitalDB();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [group, setGroup] = useState<DeptGroup>("medical");
  const [color, setColor] = useState<DeptColor>("c1");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setName(department?.name ?? "");
    setCode(department?.code ?? "");
    setGroup(department?.group ?? "medical");
    setColor(department?.color ?? DEPT_COLORS[db.departments.length % 10]!.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, department]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const c = code.trim().toUpperCase();
    if (!n) return setError("اكتب اسم القسم.");
    if (!c) return setError("اكتب كودًا مختصرًا للقسم (مثال: ER).");
    if (db.departments.some((d) => d.id !== department?.id && d.name === n))
      return setError("يوجد قسم بنفس الاسم.");
    if (db.departments.some((d) => d.id !== department?.id && d.code.toUpperCase() === c))
      return setError("هذا الكود مستخدم لقسم آخر.");
    saveDepartment({
      id: department?.id ?? newDeptId(new Set(db.departments.map((d) => d.id))),
      name: n,
      code: c,
      group,
      color,
      active: department?.active ?? true,
    });
    toast.success(department ? "تم تعديل القسم." : `تمت إضافة قسم ${n}.`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {department ? "تعديل قسم" : "إضافة قسم جديد"}
          </DialogTitle>
          <DialogDescription>يظهر القسم فورًا في كل القوائم والتقارير.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FieldRow label="اسم القسم" htmlFor="dp-name">
            <Input
              id="dp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: الجراحة التجميلية"
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="الكود المختصر" htmlFor="dp-code">
              <Input
                id="dp-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                dir="ltr"
                maxLength={8}
                placeholder="PLS"
              />
            </FieldRow>
            <FieldRow label="المجموعة">
              <Select value={group} onValueChange={(v) => setGroup(v as DeptGroup)}>
                <SelectTrigger aria-label="المجموعة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {DEPT_GROUPS.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <FieldRow label="اللون">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="لون القسم">
              {DEPT_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={color === c.key}
                  aria-label={`لون ${c.key}`}
                  onClick={() => setColor(c.key)}
                  className={cn(
                    "size-8 rounded-full ring-offset-2 ring-offset-background transition",
                    c.dot,
                    color === c.key ? "ring-2 ring-foreground" : "opacity-80 hover:opacity-100",
                  )}
                />
              ))}
            </div>
          </FieldRow>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{department ? "حفظ التعديلات" : "إضافة القسم"}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
