import { createFileRoute } from "@tanstack/react-router";
import { Copy, Tag, Layers, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { matches, SearchBox } from "@/components/hospital/kit";
import { ServiceDialog, type ServiceDraft } from "@/components/hospital/services/ServiceDialog";
import { DEPT_GROUPS, findDepartment, sortDepartments } from "@/lib/hospital/constants";
import { int, money } from "@/lib/hospital/format";
import {
  deleteListItem,
  newId,
  saveListItem,
  SERVICE_KINDS,
  useCan,
  useHospitalDB,
  type ServiceItem,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({
    meta: [
      { title: "خدمات الأقسام وأسعارها | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "إضافة وتعديل خدمات كل قسم بالمستشفى وأسعارها ومجموعاتها لتظهر مباشرة في الإيصالات.",
      },
      { property: "og:title", content: "خدمات الأقسام وأسعارها | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "قائمة أسعار العيادات والطوارئ والمعمل والأشعة والعناية وباقي الأقسام.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ServicesPage,
});

/** "all" = every service, "shared" = services available to every department. */
type Scope = "all" | "shared" | string;
const NO_GROUP = "بدون مجموعة";

function PriceCell({ svc, editable }: { svc: ServiceItem; editable: boolean }) {
  const [v, setV] = useState<string | null>(null);
  if (!editable) return <span className="num font-semibold">{money(svc.price)}</span>;
  const value = v ?? String(svc.price);
  const commit = () => {
    if (v === null) return;
    const p = Number(v);
    setV(null);
    if (v === "" || !(p >= 0)) return;
    if (p !== svc.price && saveListItem("services", { ...svc, price: p }))
      toast.success(`سعر ${svc.name} أصبح ${money(p)}`);
  };
  return (
    <Input
      type="number"
      min="0"
      step="0.01"
      aria-label={`سعر ${svc.name}`}
      value={value}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="num h-8 w-28 text-left"
    />
  );
}

function ServicesPage() {
  const db = useHospitalDB();
  const canEdit = useCan("settings");
  const services = db.lists.services;
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>({ department: "" });

  const depts = useMemo(
    () => sortDepartments(db.departments).filter((d) => d.active || services.some((s) => s.department === d.id)),
    [db.departments, services],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) m.set(s.department ?? "shared", (m.get(s.department ?? "shared") ?? 0) + 1);
    return m;
  }, [services]);

  const shown = services.filter(
    (s) =>
      (scope === "all" || (scope === "shared" ? !s.department : s.department === scope)) &&
      matches(query, s.name, s.group, s.department ? findDepartment(db.departments, s.department).name : ""),
  );
  const grouped = useMemo(() => {
    const m = new Map<string, ServiceItem[]>();
    for (const s of shown) {
      const key =
        scope === "all"
          ? `${s.department ? findDepartment(db.departments, s.department).name : "كل الأقسام"} — ${s.group || NO_GROUP}`
          : s.group || NO_GROUP;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m.entries()];
  }, [shown, scope, db.departments]);

  const scopeName =
    scope === "all" ? "كل الخدمات" : scope === "shared" ? "خدمات عامة لكل الأقسام" : findDepartment(db.departments, scope).name;
  const avg = shown.length ? shown.reduce((t, s) => t + s.price, 0) / shown.length : 0;

  function openNew(group?: string, department?: string) {
    setEditing(null);
    setDraft({
      // From "all services" the department must be chosen explicitly, so nothing lands in every desk by accident.
      department: department ?? (scope === "all" ? "" : scope === "shared" ? "all" : scope),
      group,
    });
    setOpen(true);
  }

  function duplicate(s: ServiceItem) {
    const copy = { ...s, id: newId(), name: `${s.name} (نسخة)` };
    if (saveListItem("services", copy)) {
      setEditing(copy);
      setOpen(true);
    }
  }

  const scopeBtn = (key: Scope, label: string, dot?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setScope(key)}
      aria-pressed={scope === key}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors",
        scope === key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {dot && <span className={cn("size-2.5 shrink-0 rounded-full", dot)} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn("num text-xs", scope === key ? "opacity-90" : "text-muted-foreground")}>
        {int(key === "all" ? services.length : (counts.get(key) ?? 0))}
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="قوائم الأسعار"
        title="خدمات الأقسام وأسعارها"
        description="اختر القسم لعرض خدماته، ثم أضف خدمة جديدة أو عدّل الاسم والسعر والمجموعة. التغييرات تظهر فورًا في شاشة الإيصالات على كل الأجهزة."
        actions={
          canEdit && (
            <Button onClick={() => openNew()}>
              <Plus /> إضافة خدمة
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="ledger-card h-fit p-2 lg:sticky lg:top-4">
          <div className="max-h-72 space-y-0.5 overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
            {scopeBtn("all", "كل الخدمات")}
            {scopeBtn("shared", "خدمات عامة لكل الأقسام")}
            {DEPT_GROUPS.map((g) => {
              const list = depts.filter((d) => d.group === g.id);
              if (!list.length) return null;
              return (
                <div key={g.id} className="pt-2">
                  <p className="px-3 pb-1 text-[11px] font-semibold text-copper">{g.name}</p>
                  {list.map((d) => scopeBtn(d.id, d.name, findDepartment(db.departments, d.id).dot))}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatCard label="عدد الخدمات" value={int(shown.length)} icon={ListChecks} />
            <StatCard label="المجموعات" value={int(new Set(shown.map((s) => s.group || NO_GROUP)).size)} icon={Layers} />
            <StatCard label="متوسط السعر" value={money(avg)} icon={Tag} hint="بالجنيه المصري" />
          </div>

          <div className="ledger-card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">{scopeName}</h2>
              {scope === "shared" ? (
                <p className="text-xs text-muted-foreground">
                  لا تختلط بخدمات الأقسام في الإيصال — تظهر فقط عند الضغط على «خدمات عامة». لنقل خدمة لقسمها: تعديل ← القسم.
                </p>
              ) : scope !== "all" ? (
                <p className="text-xs text-muted-foreground">هذه الخدمات فقط تظهر عند اختيار هذا القسم في الإيصال.</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchBox value={query} onChange={setQuery} placeholder="بحث عن خدمة أو مجموعة" className="sm:w-64" />
              {canEdit && scope !== "all" && (
                <Button variant="secondary" onClick={() => openNew()}>
                  <Plus /> خدمة لهذا القسم
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {grouped.map(([title, items]) => (
              <div key={title} className="ledger-card overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b bg-secondary/60 px-4 py-2">
                  <h3 className="font-bold text-secondary-foreground">
                    {title} <span className="num text-xs font-normal text-muted-foreground">({int(items.length)})</span>
                  </h3>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() =>
                        openNew(items[0]?.group, items[0]?.department ?? "all")
                      }
                    >
                      <Plus /> إضافة هنا
                    </Button>
                  )}
                </div>
                <ul className="divide-y">
                  {items.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{s.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {SERVICE_KINDS[s.kind ?? "other"]}
                          {s.stay === "room" && " — سعر يوم إقامة"}
                          {s.stay === "supervision" && " — سعر يوم إشراف"}
                        </p>
                      </div>
                      <PriceCell svc={s} editable={canEdit} />
                      {canEdit && (
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`تعديل ${s.name}`} onClick={() => { setEditing(s); setOpen(true); }}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`نسخ ${s.name}`} onClick={() => duplicate(s)}>
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`حذف ${s.name}`}
                            onClick={() =>
                              window.confirm(`حذف خدمة "${s.name}" من قائمة الأسعار؟ الإيصالات القديمة لن تتأثر.`) &&
                              deleteListItem("services", s.id) &&
                              toast.success(`تم حذف ${s.name}.`)
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!grouped.length && (
              <div className="ledger-card px-4 py-12 text-center text-sm text-muted-foreground">
                {query ? "لا توجد خدمة بهذا الاسم." : "لا توجد خدمات في هذا القسم بعد."}
                {canEdit && !query && (
                  <div className="mt-3">
                    <Button onClick={() => openNew()}>
                      <Plus /> أضف أول خدمة
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <ServiceDialog open={open} onOpenChange={setOpen} service={editing} draft={draft} />
    </div>
  );
}
