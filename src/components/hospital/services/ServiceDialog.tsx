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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptSelect } from "@/components/hospital/kit";
import {
  newId,
  saveListItem,
  SERVICE_KINDS,
  useHospitalDB,
  type ServiceItem,
  type ServiceKind,
} from "@/lib/hospital/store";

const STAY_LABELS = {
  none: "خدمة عادية",
  room: "سعر يوم الإقامة (سرير)",
  supervision: "سعر يوم الإشراف الطبي",
} as const;
type StayChoice = keyof typeof STAY_LABELS;

export interface ServiceDraft {
  department: string;
  group?: string | undefined;
}

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  draft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Service being edited; null = new. */
  service: ServiceItem | null;
  /** Prefill for a new service (department / group). */
  draft: ServiceDraft;
}) {
  const { lists } = useHospitalDB();
  const [name, setName] = useState("");
  const [dept, setDept] = useState("all");
  const [group, setGroup] = useState("");
  const [kind, setKind] = useState<ServiceKind>("procedure");
  const [price, setPrice] = useState("");
  const [stay, setStay] = useState<StayChoice>("none");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setName(service?.name ?? "");
    setDept(service ? (service.department ?? "all") : draft.department);
    setGroup(service ? (service.group ?? "") : (draft.group ?? ""));
    setKind(service?.kind ?? "procedure");
    setPrice(service ? String(service.price) : "");
    setStay(service?.stay ?? "none");
  }, [open, service, draft]);

  const groups = [
    ...new Set(
      lists.services
        .filter((s) => (dept === "all" ? !s.department : s.department === dept))
        .map((s) => s.group)
        .filter(Boolean),
    ),
  ] as string[];

  function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const p = Number(price);
    if (!n) return setError("اكتب اسم الخدمة.");
    if (!dept) return setError("اختر قسم الخدمة — تظهر الخدمة في إيصالات هذا القسم فقط.");
    if (price === "" || !(p >= 0)) return setError("اكتب سعرًا صحيحًا للخدمة.");
    const department = dept === "all" ? undefined : dept;
    const dup = lists.services.some(
      (s) => s.id !== service?.id && s.department === department && s.name.trim() === n,
    );
    if (dup) return setError("توجد خدمة بنفس الاسم في هذا القسم.");
    const item: ServiceItem = {
      id: service?.id ?? newId(),
      name: n,
      price: p,
      department,
      kind,
      group: group.trim() || undefined,
      stay: stay === "none" ? undefined : stay,
    };
    if (!saveListItem("services", item)) return;
    toast.success(service ? `تم تعديل ${n}.` : `تمت إضافة ${n} لقائمة الأسعار.`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? "تعديل خدمة" : "إضافة خدمة جديدة"}</DialogTitle>
          <DialogDescription>
            تظهر الخدمة فورًا في شاشة الإيصالات للقسم المختار بنفس السعر.
          </DialogDescription>
        </DialogHeader>
        <form id="service-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="svc-name">اسم الخدمة</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: سونار على البطن"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>القسم</Label>
            <DeptSelect
              value={dept}
              onChange={setDept}
              allowAll
              allLabel="خدمة عامة لكل الأقسام"
              placeholder="اختر القسم"
              label="قسم الخدمة"
            />
            {dept === "all" && (
              <p className="text-[11px] text-muted-foreground">
                الخدمة العامة لا تظهر ضمن خدمات أي قسم، بل في زر «خدمات عامة» المنفصل بالإيصال.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-group">المجموعة داخل القسم</Label>
            <Input
              id="svc-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              list="svc-dialog-groups"
              placeholder="مثال: سونار"
            />
            <datalist id="svc-dialog-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-price">السعر (جنيه)</Label>
            <Input
              id="svc-price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="num"
            />
          </div>
          <div className="space-y-1.5">
            <Label>نوع الخدمة</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ServiceKind)}>
              <SelectTrigger aria-label="نوع الخدمة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {(Object.keys(SERVICE_KINDS) as ServiceKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SERVICE_KINDS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>طريقة الحساب</Label>
            <Select value={stay} onValueChange={(v) => setStay(v as StayChoice)}>
              <SelectTrigger aria-label="طريقة الحساب">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {(Object.keys(STAY_LABELS) as StayChoice[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {STAY_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              أسعار اليوم (سرير / إشراف) تُستخدم تلقائيًا في إيصالات الإقامة مثل العناية المركزة.
            </p>
          </div>
        </form>
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" form="service-form">
            {service ? "حفظ التعديل" : "إضافة الخدمة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
