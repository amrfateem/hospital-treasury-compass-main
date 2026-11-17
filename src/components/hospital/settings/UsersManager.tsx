import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
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
import { EmptyRow, FieldRow, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import {
  ROLE_LABELS,
  useHospitalSession,
  type Role,
} from "@/lib/hospital/store";
import {
  createStaff,
  deleteStaff,
  listStaff,
  setStaffPassword,
  setStaffPermissions,
  updateStaff,
  type StaffRow,
} from "@/lib/hospital/users.functions";
import {
  PERM_LABELS,
  ROLE_DEFAULTS,
  ROLES,
  SECTIONS,
  canSpendDirectly,
  isDeskRole,
  type GrantableSection,
  type PermLevel,
  type Permissions,
} from "@/lib/hospital/permissions";
import { cn } from "@/lib/utils";

const ROLE_HINTS: Record<Role, string> = {
  admin: "كل شيء، بما فيه المستخدمين والصلاحيات والاستعادة والتصفير.",
  finance: "كل الشاشات المالية والتقارير، ويوافق على طلبات الموظفين (إلغاء إيصالات، أوامر صرف، نثريات...). طلباته هو يوافق عليها مدير المستشفى.",
  accountant:
    "يشوف الخزينة الرئيسية كلها: يعمل الإيصالات ويحصّل ويقفّل الورديات ويجهّز أوامر الصرف — بس مايصرفش ولا يلغي إيصال إلا بموافقة المدير المالي.",
  lab_manager: "إيصالات ونتائج المعمل في ورديته على الخزينة الرئيسية، وطلبات القسم.",
  icu_manager: "إيصالات وحسابات العناية في ورديته على الخزينة الرئيسية، وطلبات القسم.",
  radiologist: "إيصالات الأشعة في ورديته على الخزينة الرئيسية، وطلبات القسم.",
  reception:
    "فواتير المرضى والتحصيل في ورديته على الخزينة الرئيسية. لا يعدّل أو يحذف إيصالًا بعد طباعته إلا بموافقة المدير.",
  auditor:
    "يطّلع على كل الشاشات بدون تعديل، ويراجع الحركات المالية ويسجل ملاحظاته وسجل العمليات.",
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "حدث خطأ، حاول مرة أخرى.");

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="grid gap-1.5">
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger aria-label="الدور">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{ROLE_HINTS[value]}</p>
    </div>
  );
}

export function UsersManager() {
  const { me } = useHospitalSession();
  const qc = useQueryClient();
  const list = useServerFn(listStaff);
  const create = useServerFn(createStaff);
  const update = useServerFn(updateStaff);
  const setPass = useServerFn(setStaffPassword);
  const setPerms = useServerFn(setStaffPermissions);
  const remove = useServerFn(deleteStaff);
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => list() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["staff"] });

  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [passFor, setPassFor] = useState<StaffRow | null>(null);

  return (
    <div className="space-y-4">
      <section className="ledger-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">المستخدمين والصلاحيات</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            كل موظف يدخل باسم مستخدم وكلمة مرور. الفلوس كلها في خزينة رئيسية واحدة: كل موظف بيحصّل في
            ورديته هو، وكل جنيه بيتسجل باسمه. صلاحيات كل حساب بتتحدد وانت بتعمله.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <UserPlus /> مستخدم جديد
        </Button>
      </section>

      <TableCard minWidth={760}>
        <thead>
          <HeadRow>
            <Th>الاسم</Th>
            <Th>اسم المستخدم</Th>
            <Th>الدور</Th>
            <Th>حدود</Th>
            <Th>الحالة</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {staff.isLoading && (
            <tr>
              <td colSpan={6} className="py-10 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
              </td>
            </tr>
          )}
          {staff.error && <EmptyRow cols={6} text={errMsg(staff.error)} />}
          {staff.data?.map((u) => (
            <tr key={u.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td className="font-semibold">
                {u.fullName}
                {u.id === me?.id && <span className="mr-1 text-[11px] text-copper">(أنت)</span>}
              </Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{u.username}</span>
              </Td>
              <Td className="text-xs">{u.role ? ROLE_LABELS[u.role] : "بدون دور"}</Td>
              <Td className="text-xs">
                {u.controls?.maxDiscountPct != null ? `أقصى خصم ${u.controls.maxDiscountPct}٪` : "—"}
              </Td>
              <Td>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    u.active ? "bg-income/10 text-income" : "bg-muted text-muted-foreground",
                  )}
                >
                  {u.active ? "نشط" : "موقوف"}
                </span>
              </Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" aria-label="تعديل" onClick={() => setEditing(u)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="تعيين كلمة مرور"
                    onClick={() => setPassFor(u)}
                  >
                    <KeyRound />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف"
                    disabled={u.id === me?.id}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!window.confirm(`حذف حساب ${u.fullName} نهائيًا؟`)) return;
                      try {
                        await remove({ data: { id: u.id } });
                        toast.success("تم حذف الحساب.");
                        void refresh();
                      } catch (e) {
                        toast.error(errMsg(e));
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
          {staff.data && !staff.data.length && <EmptyRow cols={6} text="لا يوجد مستخدمون." />}
        </tbody>
      </TableCard>

      <StaffDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSave={async (v) => {
          try {
            const controls = { maxDiscountPct: v.maxDiscount.trim() === "" ? null : Number(v.maxDiscount) };
            const permissions = changedPerms(v.role, v.perms);
            if (v.id) {
              await update({
                data: { id: v.id, fullName: v.fullName, role: v.role, active: v.active, controls },
              });
              if (v.role !== "admin") await setPerms({ data: { id: v.id, permissions } });
            } else
              await create({
                data: {
                  username: v.username,
                  fullName: v.fullName,
                  password: v.password,
                  role: v.role,
                  permissions,
                  controls,
                },
              });
            toast.success(v.id ? "تم حفظ التعديل." : `تم إنشاء حساب ${v.fullName}.`);
            setEditing(null);
            void refresh();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />

      <PasswordDialog
        user={passFor}
        onClose={() => setPassFor(null)}
        onSave={async (password) => {
          if (!passFor) return;
          try {
            await setPass({ data: { id: passFor.id, password } });
            toast.success(`تم تعيين كلمة مرور جديدة لـ ${passFor.fullName}.`);
            setPassFor(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}

type Draft = {
  id?: string;
  username: string;
  fullName: string;
  password: string;
  role: Role;
  active: boolean;
  /** Level per section as shown on screen (starts from the role defaults). */
  perms: Record<GrantableSection, PermLevel>;
  /** Highest discount % without approval; empty = no limit. */
  maxDiscount: string;
};

const levelsFor = (role: Role, custom?: Permissions | null) =>
  ({ ...ROLE_DEFAULTS[role], ...(custom ?? {}) }) as Record<GrantableSection, PermLevel>;

/** Only what differs from the role's defaults is saved (null = role defaults). */
function changedPerms(role: Role, levels: Record<GrantableSection, PermLevel>): Permissions | null {
  const out: Permissions = {};
  for (const sec of SECTIONS) if (levels[sec.key] !== ROLE_DEFAULTS[role][sec.key]) out[sec.key] = levels[sec.key];
  return Object.keys(out).length ? out : null;
}

/** Plain list of what this person can never do alone. */
function safeguards(role: Role): string[] {
  if (role === "admin") return ["مدير المستشفى: كل الصلاحيات، وكل عملية بتتسجل باسمه."];
  const out = [
    role === "finance"
      ? "إلغاء أي إيصال أو تعديله بعد الطباعة ← بموافقة مدير المستشفى."
      : "إلغاء أي إيصال أو تعديله بعد الطباعة ← بموافقة المدير المالي.",
  ];
  if (!canSpendDirectly({ role }))
    out.push("أي فلوس طالعة (إذن صرف، مصروف، نثرية، مرتجع لمريض، سلفة) ← طلب ومايتصرفش إلا بعد موافقة المدير المالي.");
  else out.push("يوافق على طلبات الموظفين — بس عمره ما يوافق على طلب قدّمه بنفسه.");
  if (isDeskRole(role)) out.push("بيحصّل في ورديته هو بس على الخزينة الرئيسية، ويشوف حركات ورديته بس، والعجز في التقفيل بيتسجل باسمه.");
  if (role === "accountant") out.push("بيشوف حركة الخزينة الرئيسية كلها، وكل حركة بيعملها بتتسجل باسمه.");
  out.push("كل عملية بيعملها بتظهر في صفحة الرقابة وسجل العمليات.");
  return out;
}

function StaffDialog({
  value,
  onClose,
  onSave,
}: {
  value: StaffRow | "new" | null;
  onClose: () => void;
  onSave: (d: Draft) => Promise<void>;
}) {
  const isNew = value === "new";
  const [d, setD] = useState<Draft>({
    username: "",
    fullName: "",
    password: "",
    role: "reception",
    active: true,
    perms: levelsFor("reception"),
    maxDiscount: "",
  });
  const [showPerms, setShowPerms] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError("");
    setConfirm("");
    setShowPerms(false);
    setD(
      value === "new"
        ? {
            username: "",
            fullName: "",
            password: "",
            role: "reception",
            active: true,
            perms: levelsFor("reception"),
            maxDiscount: "",
          }
        : {
            id: value.id,
            username: value.username,
            fullName: value.fullName,
            password: "",
            role: value.role ?? "reception",
            active: value.active,
            perms: levelsFor(value.role ?? "reception", value.permissions),
            maxDiscount: value.controls?.maxDiscountPct != null ? String(value.controls.maxDiscountPct) : "",
          },
    );
  }, [value]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.fullName.trim()) return setError("اكتب الاسم بالكامل.");
    if (isNew && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(d.username.trim().toLowerCase()))
      return setError("اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣ إلى ٣٠) بدون مسافات.");
    if (isNew && d.password.length < 8) return setError("كلمة المرور ٨ أحرف على الأقل.");
    if (isNew && d.password !== confirm) return setError("كلمتا المرور غير متطابقتين.");
    const cap = d.maxDiscount.trim();
    if (cap !== "" && (!Number.isFinite(Number(cap)) || Number(cap) < 0 || Number(cap) > 100))
      return setError("أقصى خصم: رقم من 0 إلى 100.");
    setBusy(true);
    await onSave({ ...d, username: d.username.trim().toLowerCase() });
    setBusy(false);
  }

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {isNew ? "مستخدم جديد" : "تعديل مستخدم"}
          </DialogTitle>
          <DialogDescription>
            {isNew ? "أعطِ الموظف اسم المستخدم وكلمة المرور ليدخل بهما." : `اسم المستخدم: ${d.username}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FieldRow label="الاسم بالكامل" htmlFor="st-name">
            <Input
              id="st-name"
              value={d.fullName}
              onChange={(e) => setD({ ...d, fullName: e.target.value })}
            />
          </FieldRow>
          {isNew && (
            <>
              <FieldRow label="اسم المستخدم (إنجليزي)" htmlFor="st-user">
                <Input
                  id="st-user"
                  dir="ltr"
                  autoCapitalize="none"
                  placeholder="mona.reception"
                  value={d.username}
                  onChange={(e) => setD({ ...d, username: e.target.value })}
                />
              </FieldRow>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="كلمة المرور" htmlFor="st-pass">
                  <Input
                    id="st-pass"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={d.password}
                    onChange={(e) => setD({ ...d, password: e.target.value })}
                  />
                </FieldRow>
                <FieldRow label="تأكيد كلمة المرور" htmlFor="st-pass2">
                  <Input
                    id="st-pass2"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </FieldRow>
              </div>
            </>
          )}
          <FieldRow label="الوظيفة">
            <RoleSelect
              value={d.role}
              onChange={(role) => setD({ ...d, role, perms: levelsFor(role) })}
            />
          </FieldRow>
          {d.role !== "admin" && (
            <>
              <FieldRow label="أقصى خصم يعمله على الإيصال من غير موافقة (٪)" htmlFor="st-disc">
                <Input
                  id="st-disc"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="فاضي = بدون حد"
                  value={d.maxDiscount}
                  onChange={(e) => setD({ ...d, maxDiscount: e.target.value })}
                />
              </FieldRow>
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="text-sm font-semibold">الحماية على الحساب ده (ثابتة)</p>
                <ul className="mt-1.5 list-disc space-y-1 pr-4 text-xs leading-relaxed text-muted-foreground">
                  {safeguards(d.role).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between p-3 text-sm font-semibold"
                  onClick={() => setShowPerms((x) => !x)}
                  aria-expanded={showPerms}
                >
                  صلاحيات الأقسام (جاهزة حسب الوظيفة — تقدر تغيّرها)
                  <span className="text-xs text-primary">{showPerms ? "إخفاء" : "عرض وتعديل"}</span>
                </button>
                {showPerms && (
                  <div className="grid max-h-72 gap-1.5 overflow-y-auto border-t p-3">
                    {SECTIONS.map((sec) => {
                      const locked = sec.key === "approvals" && d.role !== "finance";
                      const levels: PermLevel[] = locked ? ["none", "view"] : ["none", "view", "add", "edit"];
                      return (
                        <div key={sec.key} className="flex items-center justify-between gap-2 text-xs">
                          <span>{sec.label}</span>
                          <Select
                            value={levels.includes(d.perms[sec.key]) ? d.perms[sec.key] : "view"}
                            onValueChange={(v) => setD({ ...d, perms: { ...d.perms, [sec.key]: v as PermLevel } })}
                          >
                            <SelectTrigger className="h-8 w-32 text-xs" aria-label={sec.label}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent dir="rtl">
                              {levels.map((l) => (
                                <SelectItem key={l} value={l}>
                                  {PERM_LABELS[l]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          {!isNew && (
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              الحساب نشط ويمكنه الدخول
              <Switch checked={d.active} onCheckedChange={(active) => setD({ ...d, active })} />
            </label>
          )}
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {isNew ? "إنشاء الحساب" : "حفظ"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  user,
  onClose,
  onSave,
}: {
  user: StaffRow | null;
  onClose: () => void;
  onSave: (p: string) => Promise<void>;
}) {
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(""), [user]);
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-sm">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>كلمة مرور جديدة</DialogTitle>
          <DialogDescription>{user?.fullName}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (p.length < 8) return void toast.error("كلمة المرور ٨ أحرف على الأقل.");
            setBusy(true);
            await onSave(p);
            setBusy(false);
          }}
        >
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            aria-label="كلمة المرور الجديدة"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy}>
              <KeyRound /> تعيين
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
