import { createFileRoute } from "@tanstack/react-router";
import { AlarmClock, FileSignature, FilePen, IdCard, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FilterBar, HeadRow, SearchBox, TableCard, Td, Th, matches } from "@/components/hospital/kit";
import { EmployeeFileDialog } from "@/components/hospital/staff/EmployeeFileDialog";
import { StaffFileSheet } from "@/components/hospital/staff/StaffFileSheet";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate } from "@/lib/hospital/format";
import { CONTRACT_STATUS, endingSoon } from "@/lib/hospital/hr";
import { useCan, useHospitalDB, type Employee } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({
    meta: [
      { title: "شؤون العاملين والعقود | مستشفى الرحمة التخصصي" },
      { name: "description", content: "ملف كل موظف، صورة بطاقة الرقم القومي، تحرير عقود العمل وطباعتها وتوقيعها." },
      { property: "og:title", content: "شؤون العاملين والعقود | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "ملفات الموظفين وعقود العمل الموقَّعة والبطاقات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StaffPage,
});

type Filter = "all" | "no-contract" | "draft" | "ending" | "left";

function StaffPage() {
  const db = useHospitalDB();
  const canAdd = useCan("hr", "add");
  const today = isoDate(new Date());
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const soon = useMemo(() => new Set(endingSoon(db.contracts, today, 30).map((c) => c.employeeId)), [db.contracts, today]);
  const rows = useMemo(
    () =>
      db.employees.map((e) => {
        const mine = db.contracts.filter((c) => c.employeeId === e.id);
        const current = mine.find((c) => c.status === "signed") ?? mine.find((c) => c.status === "draft") ?? null;
        return { e, current, drafts: mine.filter((c) => c.status === "draft").length };
      }),
    [db.employees, db.contracts],
  );
  const shown = rows
    .filter(({ e }) => dept === "all" || e.department === dept)
    .filter(({ e }) => matches(q, e.name, e.jobTitle, e.nationalId, e.personal?.phone))
    .filter(({ e, current, drafts }) =>
      filter === "all"
        ? !e.personal?.leftOn
        : filter === "left"
          ? !!e.personal?.leftOn
          : filter === "no-contract"
            ? !e.personal?.leftOn && current?.status !== "signed"
            : filter === "draft"
              ? drafts > 0
              : soon.has(e.id),
    )
    .sort((a, b) => a.e.name.localeCompare(b.e.name, "ar"));

  const active = rows.filter((r) => !r.e.personal?.leftOn);
  const signed = active.filter((r) => r.current?.status === "signed").length;
  const open = db.employees.find((e) => e.id === openId) ?? null;

  const chips: [Filter, string, number][] = [
    ["all", "على رأس العمل", active.length],
    ["no-contract", "بدون عقد موقَّع", active.length - signed],
    ["draft", "عقود لم تُوقَّع", rows.filter((r) => r.drafts > 0).length],
    ["ending", "عقود تنتهي خلال ٣٠ يومًا", soon.size],
    ["left", "تركوا العمل", rows.length - active.length],
  ];

  return (
    <div>
      <PageHeader
        eyebrow="شؤون العاملين"
        title="ملفات الموظفين وعقود العمل"
        description="افتح ملف الموظف لرفع صورة بطاقة الرقم القومي، وتحرير عقد العمل وطباعته، ثم توقيعه على الشاشة أو رفع النسخة الموقَّعة ورقيًا."
        actions={
          canAdd && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> ملف موظف جديد
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="على رأس العمل" value={int(active.length)} icon={Users} tone="primary" />
        <StatCard label="بعقد موقَّع" value={int(signed)} icon={FileSignature} tone="income" />
        <StatCard label="بدون عقد موقَّع" value={int(active.length - signed)} icon={FilePen} tone="copper" />
        <StatCard label="عقود تنتهي خلال ٣٠ يومًا" value={int(soon.size)} icon={AlarmClock} tone="expense" hint="جدّدها أو حرر عقدًا جديدًا" />
      </div>
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو الوظيفة أو الرقم القومي أو التليفون" className="md:max-w-sm" />
        <DeptSelect value={dept} onChange={setDept} allowAll className="md:w-56" />
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="تصفية الموظفين">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("chip-filter", filter === k && "chip-filter-active")}>
              {label} <span className="num opacity-70">{int(n)}</span>
            </button>
          ))}
        </div>
      </FilterBar>
      <TableCard minWidth={860}>
        <thead>
          <HeadRow>
            <Th>الموظف</Th>
            <Th>الوظيفة والقسم</Th>
            <Th>الرقم القومي</Th>
            <Th>التعيين</Th>
            <Th>العقد الحالي</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {shown.map(({ e, current }) => (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
              <Td className="font-semibold">{e.name}</Td>
              <Td>
                {e.jobTitle}
                <span className="block text-xs text-muted-foreground">{findDepartment(db.departments, e.department).name}</span>
              </Td>
              <Td className="num" >{e.nationalId || <span className="text-expense">غير مسجل</span>}</Td>
              <Td>{e.hireDate ? dateLabel(e.hireDate) : "—"}</Td>
              <Td>
                {current ? (
                  <span className={cn("contract-status", current.status === "signed" ? "contract-status-signed" : "contract-status-draft")}>
                    {CONTRACT_STATUS[current.status]}
                    {current.endDate && current.status === "signed" ? ` حتى ${dateLabel(current.endDate)}` : ""}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">لا يوجد</span>
                )}
              </Td>
              <Td>
                <Button size="sm" variant="outline" onClick={() => setOpenId(e.id)}>
                  <IdCard /> فتح الملف
                </Button>
              </Td>
            </tr>
          ))}
          {!shown.length && <EmptyRow cols={6} text={db.employees.length ? "لا يوجد موظفون بهذا البحث." : "لا توجد ملفات موظفين بعد — أضف أول موظف."} />}
        </tbody>
      </TableCard>

      <EmployeeFileDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        employee={editing === "new" ? null : editing}
        onSaved={(id) => editing === "new" && setOpenId(id)}
      />
      <StaffFileSheet employee={open} onOpenChange={(o) => !o && setOpenId(null)} onEdit={(e) => setEditing(e)} />
    </div>
  );
}
