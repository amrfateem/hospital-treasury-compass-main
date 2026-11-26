import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { findPatientsForBooking } from "@/lib/medical/medical.functions";

export interface PickedPatient {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

/** Searches patient files (name / file number / phone) for booking and lab orders. */
export function PatientPicker({
  value,
  onChange,
  section,
}: {
  value: PickedPatient | null;
  onChange: (p: PickedPatient | null) => void;
  section: "appointments" | "lab";
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useQuery({
    queryKey: ["booking-patients", section, debounced],
    queryFn: () => findPatientsForBooking({ data: { q: debounced, section } }),
    enabled: !value && debounced.length >= 2,
  });

  if (value)
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-secondary/50 px-3 text-sm">
        <span className="truncate font-semibold">
          {value.fullName} <span className="num text-xs text-muted-foreground">{value.mrn}</span>
        </span>
        <button type="button" aria-label="تغيير المريض" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Input aria-label="ابحث عن المريض" placeholder="اسم المريض أو رقم الملف أو التليفون" value={q} onChange={(e) => setQ(e.target.value)} />
      {debounced.length >= 2 && (
        <div className="absolute inset-x-0 top-10 z-20 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {found.isLoading && <p className="p-2 text-xs text-muted-foreground">جارٍ البحث...</p>}
          {found.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p);
                setQ("");
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted"
            >
              <span>{p.fullName}</span>
              <span className="num text-xs text-muted-foreground">{p.mrn}{p.phone ? ` • ${p.phone}` : ""}</span>
            </button>
          ))}
          {found.data && !found.data.length && <p className="p-2 text-xs text-muted-foreground">مفيش ملف بالاسم ده — افتح ملف للمريض من صفحة ملفات المرضى.</p>}
          {found.isError && <p className="p-2 text-xs text-destructive">تعذّر البحث.</p>}
        </div>
      )}
    </div>
  );
}
