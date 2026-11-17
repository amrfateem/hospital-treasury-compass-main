import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Eye, EyeOff, FilePlus2, Loader2, PencilLine, RotateCcw, Save, ShieldCheck, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hospital/ui";
import { listStaff, setStaffPermissions, type StaffRow } from "@/lib/hospital/users.functions";
import { opsBySection } from "@/lib/hospital/ops";
import {
  PERM_HINTS,
  PERM_LABELS,
  ROLE_DEFAULTS,
  SECTIONS,
  type GrantableSection,
  type PermLevel,
  type Permissions,
} from "@/lib/hospital/permissions";
import { ROLE_LABELS } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({
    meta: [
      { title: "صلاحيات المستخدمين | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "مدير المستشفى يحدد لكل موظف الأقسام التي يراها والأقسام التي يعدّل فيها.",
      },
      { property: "og:title", content: "صلاحيات المستخدمين | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تحكم كامل في صلاحيات كل موظف على كل قسم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PermissionsPage,
});

const LEVELS: { level: PermLevel; icon: typeof Eye }[] = [
  { level: "none", icon: EyeOff },
  { level: "view", icon: Eye },
  { level: "add", icon: FilePlus2 },
  { level: "edit", icon: PencilLine },
];
/** What each level allows on each section, derived from the operations the server checks. */
const ALLOWS = opsBySection();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "حدث خطأ، حاول مرة أخرى.");

function PermissionsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listStaff);
  const save = useServerFn(setStaffPermissions);
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => list() });
  const people = useMemo(() => (staff.data ?? []).filter((u) => u.role && u.role !== "admin"), [staff.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = people.find((u) => u.id === selected) ?? people[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المراجعة والرقابة"
        title="صلاحيات المستخدمين"
        description="حدّد لكل موظف في كل قسم: بدون، عرض فقط، عرض وإضافة، أو كامل. الصلاحيات تُطبَّق فورًا على الخادم ويُرفض أي إجراء خارجها حتى لو حاول الموظف من جهاز آخر."
        actions={
          <Button variant="outline" asChild>
            <Link to="/settings">
              <UserCog /> إضافة / إدارة الحسابات
            </Link>
          </Button>
        }
      />
      {staff.isLoading && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />}
      {staff.error && <p className="text-destructive">{errMsg(staff.error)}</p>}
      {staff.data && !people.length && (
        <div className="ledger-card p-10 text-center text-muted-foreground">
          لا يوجد موظفون بعد. أضف الحسابات من صفحة الإعدادات ثم حدد صلاحياتهم هنا.
        </div>
      )}
      <div className="ledger-card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {LEVELS.map(({ level, icon: Icon }) => (
          <div key={level} className="flex items-start gap-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">{PERM_LABELS[level]}</p>
              <p className="text-[11px] text-muted-foreground">{PERM_HINTS[level]}</p>
            </div>
          </div>
        ))}
      </div>
      {current && (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="ledger-card h-fit overflow-hidden">
            <p className="border-b bg-secondary/60 px-4 py-2.5 text-xs font-semibold">الموظفون</p>
            <ul>
              {people.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(u.id)}
                    className={cn(
                      "flex w-full flex-col items-start border-b px-4 py-3 text-right text-sm last:border-0 hover:bg-muted/60",
                      current.id === u.id && "bg-secondary",
                    )}
                  >
                    <span className="font-semibold">{u.fullName}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {ROLE_LABELS[u.role!]} {u.permissions ? "• صلاحيات مخصصة" : ""}
                      {!u.active ? " • موقوف" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <Matrix
            key={current.id}
            user={current}
            onSave={async (permissions) => {
              try {
                await save({ data: { id: current.id, permissions } });
                await qc.invalidateQueries({ queryKey: ["staff"] });
                toast.success(`تم حفظ صلاحيات ${current.fullName}.`);
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function Matrix({ user, onSave }: { user: StaffRow; onSave: (p: Permissions | null) => Promise<void> }) {
  const defaults = ROLE_DEFAULTS[user.role!];
  const [perms, setPerms] = useState<Record<GrantableSection, PermLevel>>({ ...defaults, ...(user.permissions ?? {}) });
  const [busy, setBusy] = useState(false);
  useEffect(() => setPerms({ ...defaults, ...(user.permissions ?? {}) }), [user, defaults]);
  const groups = useMemo(() => [...new Set(SECTIONS.map((s) => s.group))], []);
  const isDefault = SECTIONS.every((s) => perms[s.key] === defaults[s.key]);
  const setAll = (level: PermLevel) => setPerms(Object.fromEntries(SECTIONS.map((s) => [s.key, level])) as typeof perms);

  async function submit() {
    setBusy(true);
    await onSave(isDefault ? null : perms);
    setBusy(false);
  }

  return (
    <section className="ledger-card p-5">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <ShieldCheck className="size-5 text-primary" /> {user.fullName}
          </h2>
          <p className="text-sm text-muted-foreground">
            الدور: {ROLE_LABELS[user.role!]} — {isDefault ? "يستخدم صلاحيات الدور الافتراضية" : "صلاحيات مخصصة"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAll("view")}>
            عرض فقط للكل
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll("none")}>
            إخفاء الكل
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPerms({ ...defaults })}>
            <RotateCcw /> افتراضي الدور
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} حفظ الصلاحيات
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-2 text-xs font-semibold text-copper">{g}</p>
            <ul className="divide-y rounded-lg border">
              {SECTIONS.filter((s) => s.group === g).map((s) => {
                const approvalsLocked = s.key === "approvals" && user.role !== "finance";
                return (
                <li key={s.key} className="px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{s.label}</p>
                    {perms[s.key] !== defaults[s.key] && (
                      <p className="text-[10px] text-muted-foreground">الافتراضي للدور: {PERM_LABELS[defaults[s.key]]}</p>
                    )}
                    {approvalsLocked && (
                      <p className="text-[10px] text-copper">الاعتماد للمدير المالي فقط — يمكن لهذا الموظف متابعة الطلبات عرضًا فقط.</p>
                    )}
                  </div>
                  <div className="inline-flex shrink-0 rounded-lg border bg-muted p-0.5" role="radiogroup" aria-label={s.label}>
                    {LEVELS.filter(({ level }) => !approvalsLocked || level === "none" || level === "view").map(({ level, icon: Icon }) => (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={perms[s.key] === level}
                        onClick={() => setPerms({ ...perms, [s.key]: level })}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          perms[s.key] === level
                            ? level === "edit"
                              ? "bg-primary text-primary-foreground"
                              : level === "add"
                                ? "bg-primary/15 text-primary"
                                : level === "view"
                                ? "bg-card text-foreground shadow-sm"
                                : "bg-destructive/10 text-destructive"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="size-3.5" /> {PERM_LABELS[level]}
                      </button>
                    ))}
                  </div>
                  </div>
                  <AllowsList section={s.key} level={perms[s.key]} />
                </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        مدير المستشفى له كل الصلاحيات دائمًا، وتصفير النظام واستعادة النسخ الاحتياطية وتحديد الصلاحيات له وحده.
      </p>
    </section>
  );
}

/** Expandable list of exactly what the chosen level lets the person do on this section. */
function AllowsList({ section, level }: { section: GrantableSection; level: PermLevel }) {
  const a = ALLOWS[section];
  if (!a || level === "none") return null;
  const items = [
    "عرض البيانات والطباعة",
    ...a.view,
    ...(level === "add" || level === "edit" ? a.add : []),
    ...(level === "edit" ? a.edit : []),
  ];
  return (
    <details className="group mt-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-primary">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" /> ما يسمح به ({items.length})
      </summary>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {items.map((t) => (
          <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t}
          </li>
        ))}
      </ul>
    </details>
  );
}
