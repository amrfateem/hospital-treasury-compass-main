import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHospitalDB } from "@/lib/hospital/store";

/** Branch filter for reports; hidden while the hospital has a single branch. */
export function BranchSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const { branches } = useHospitalDB();
  if (branches.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="الفرع" className={className ?? "md:w-48"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent dir="rtl">
        <SelectItem value="all">كل الفروع (المجمّع)</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
