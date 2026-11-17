import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, HandCoins, Loader2, UserRoundPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, FilterBar, HeadRow, SearchBox, TableCard, Td, Th } from "@/components/hospital/kit";
import { PatientDialog } from "@/components/hospital/patients/PatientDialog";
import { PatientFileSheet, patientMoneyKey } from "@/components/hospital/patients/PatientFileSheet";
import { dateLabel, egp, int, money } from "@/lib/hospital/format";
import { useCan, useHospitalSession } from "@/lib/hospital/store";
import { searchPatients } from "@/lib/medical/medical.functions";
import type { Patient } from "@/lib/medical/model";
import { getPatientDebtors, getPatientMoney } from "@/lib/medical/patient-money.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/patients")({
  head: () => ({
    meta: [
      { title: "ملفات المرضى والمبالغ المتبقية | مستشفى الرحمة التخصصي" },
      { name: "description", content: "بحث في ملفات المرضى، إيصالات كل مريض، المدفوع والمتبقي عليه، وتحصيل المتبقي." },
      { property: "og:title", content: "ملفات المرضى والمبالغ المتبقية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "ملف كل مريض مربوط بإيصالاته والمتبقي عليه." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PatientsPage,
});

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type View = "all" | "debtors";

function PatientsPage() {
  const { version } = useHospitalSession();
  const canAdd = useCan("patients", "add");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");
  const [editing, setEditing] = useState<Patient | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useDebounced(q);

  const list = useQuery({
    queryKey: ["patients", query],
    queryFn: () => searchPatients({ data: { q: query, limit: 50 } }),
    placeholderData: keepPreviousData,
  });
  const ids = (list.data ?? []).map((p) => p.id);
  const money_ = useQuery({
    queryKey: [...patientMoneyKey, version, ids.join(",")],
    queryFn: () => getPatientMoney({ data: { ids } }),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const debtors = useQuery({ queryKey: [...patientMoneyKey, version, "debtors"], queryFn: () => getPatientDebtors() });
  const totalRemaining = (debtors.data ?? []).reduce((s, d) => s + d.remaining, 0);

  return (
    <div>
      <PageHeader
        eyebrow="المرضى"
        title="ملفات المرضى والمبالغ المتبقية"
        description="كل إيصال يُربط بملف المريض تلقائيًا. افتح الملف لترى إيصالاته والمدفوع والمتبقي عليه وتحصّل المتبقي. حذف أي ملف يحتاج موافقة المدير المالي."
        actions={
          canAdd && (
            <Button onClick={() => setEditing("new")}>
              <UserRoundPlus /> ملف مريض جديد
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="مرضى عليهم مبالغ متبقية" value={debtors.data ? int(debtors.data.length) : "…"} icon={Users} tone="copper" />
        <StatCard label="إجمالي المتبقي على المرضى" value={debtors.data ? egp(totalRemaining) : "…"} icon={HandCoins} tone="expense" />
        <StatCard label="نتائج البحث الحالية" value={list.data ? int(list.data.length) : "…"} icon={FolderOpen} hint="تُعرض أحدث ٥٠ ملفًا مطابقًا" />
      </div>
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو رقم الملف أو التليفون أو الرقم القومي" className="md:max-w-md" />
        <div className="flex gap-1.5" role="tablist" aria-label="عرض">
          {([["all", "كل الملفات"], ["debtors", "عليهم متبقي"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn("chip-filter", view === k && "chip-filter-active")}>
              {label}
            </button>
          ))}
        </div>
        {list.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </FilterBar>

      {view === "all" ? (
        <TableCard minWidth={900}>
          <thead>
            <HeadRow>
              <Th>رقم الملف</Th>
              <Th>المريض</Th>
              <Th>التليفون</Th>
              <Th num>الإيصالات</Th>
              <Th num>المطلوب</Th>
              <Th num>المدفوع</Th>
              <Th num>المتبقي</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => {
              const m = money_.data?.[p.id];
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                  <Td className="num font-mono text-xs">{p.mrn}</Td>
                  <Td className="font-semibold">{p.fullName}</Td>
                  <Td className="num">{p.phone || "—"}</Td>
                  <Td num>{m ? int(m.receipts) : "…"}</Td>
                  <Td num>{m ? money(m.billed) : "…"}</Td>
                  <Td num className="text-income">{m ? money(m.paidAtDesk + m.collected) : "…"}</Td>
                  <Td num className={cn(m && m.remaining > 0 && "font-bold text-expense")}>{m ? money(m.remaining) : "…"}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(p.id)}>
                      <FolderOpen /> فتح الملف
                    </Button>
                  </Td>
                </tr>
              );
            })}
            {!list.isLoading && !list.data?.length && (
              <EmptyRow cols={8} text={query ? "لا يوجد ملف بهذا البحث." : "لا توجد ملفات مرضى بعد — تُفتح تلقائيًا مع أول إيصال، أو أضف ملفًا جديدًا."} />
            )}
            {list.isLoading && <EmptyRow cols={8} text="جارٍ التحميل..." />}
          </tbody>
        </TableCard>
      ) : (
        <TableCard minWidth={820}>
          <thead>
            <HeadRow>
              <Th>رقم الملف</Th>
              <Th>المريض</Th>
              <Th>التليفون</Th>
              <Th>آخر إيصال</Th>
              <Th num>المطلوب</Th>
              <Th num>المتبقي</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {(debtors.data ?? [])
              .filter((d) => !query || d.name.includes(query) || d.phone?.includes(query) || d.mrn?.includes(query))
              .map((d) => (
                <tr key={d.patientId} className="border-b last:border-0 hover:bg-muted/40">
                  <Td className="num font-mono text-xs">{d.mrn ?? "—"}</Td>
                  <Td className="font-semibold">{d.name}</Td>
                  <Td className="num">{d.phone || "—"}</Td>
                  <Td>{d.lastDate ? dateLabel(d.lastDate) : "—"}</Td>
                  <Td num>{money(d.billed)}</Td>
                  <Td num className="font-bold text-expense">{money(d.remaining)}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(d.patientId)}>
                      <FolderOpen /> فتح الملف
                    </Button>
                  </Td>
                </tr>
              ))}
            {debtors.data && !debtors.data.length && <EmptyRow cols={7} text="لا يوجد مرضى عليهم مبالغ متبقية." />}
          </tbody>
        </TableCard>
      )}

      <PatientDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        patient={editing === "new" ? null : editing}
        onSaved={(p) => {
          void list.refetch();
          if (editing === "new") setOpenId(p.id);
        }}
      />
      <PatientFileSheet patientId={openId} onOpenChange={(o) => !o && (setOpenId(null), void list.refetch())} onEdit={(p) => setEditing(p)} />
    </div>
  );
}
