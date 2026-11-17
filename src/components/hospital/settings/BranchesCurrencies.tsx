import { Building, Coins, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteBranch, newId, saveBranch, saveCashbox, saveCurrencies, useCan, useHospitalDB } from "@/lib/hospital/store";
import { MAIN_BRANCH_ID, type Branch, type Currency } from "@/lib/hospital/model";

function BranchRow({ branch, canEdit }: { branch: Branch; canEdit: boolean }) {
  const [name, setName] = useState(branch.name);
  const [address, setAddress] = useState(branch.address ?? "");
  const save = () => {
    if (!name.trim()) return setName(branch.name);
    if (name.trim() !== branch.name || address !== (branch.address ?? ""))
      saveBranch({ ...branch, name: name.trim(), address: address.trim() || undefined }) && toast.success("تم الحفظ.");
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-3">
      <Building className="size-5 text-primary" />
      <Input aria-label="اسم الفرع" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={save} className="h-9 min-w-40 flex-1" />
      <Input aria-label="عنوان الفرع" placeholder="العنوان" value={address} disabled={!canEdit} onChange={(e) => setAddress(e.target.value)} onBlur={save} className="h-9 min-w-40 flex-1" />
      {canEdit && branch.id !== MAIN_BRANCH_ID && (
        <Button size="icon" variant="ghost" aria-label="حذف الفرع" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm(`حذف ${branch.name}؟`) && deleteBranch(branch.id)}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

export function BranchesCurrencies() {
  const db = useHospitalDB();
  const canEdit = useCan("settings", "edit");
  const [currencies, setCurrencies] = useState<Currency[]>(db.settings.currencies ?? []);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="ledger-card overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b p-4">
          <div>
            <h2 className="text-lg font-bold">فروع المستشفى</h2>
            <p className="text-xs text-muted-foreground">كل خزينة أو حساب بنكي يتبع فرع، والتقارير تتفلتر بالفرع.</p>
          </div>
          {canEdit && <Button size="sm" onClick={() => saveBranch({ id: newId(), name: `فرع ${db.branches.length + 1}` })}><Plus /> فرع</Button>}
        </header>
        <ul className="divide-y">{db.branches.map((b) => <BranchRow key={b.id} branch={b} canEdit={canEdit} />)}</ul>
        {db.branches.length > 1 && (
          <div className="border-t p-4">
            <h3 className="mb-2 text-sm font-bold">الخزائن والحسابات البنكية لكل فرع</h3>
            <ul className="space-y-2">
              {db.cashboxes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.name}</span>
                  <Select value={c.branchId || MAIN_BRANCH_ID} disabled={!canEdit} onValueChange={(v) => saveCashbox({ ...c, branchId: v === MAIN_BRANCH_ID ? undefined : v })}>
                    <SelectTrigger className="h-8 w-44" aria-label={`فرع ${c.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">{db.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="ledger-card overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b p-4">
          <div>
            <h2 className="text-lg font-bold">العملات وأسعار الصرف</h2>
            <p className="text-xs text-muted-foreground">حركات الخزينة بالعملة الأجنبية تتحول للجنيه بالسعر وقت التسجيل، والقيمة الأصلية بتتحفظ.</p>
          </div>
          <Coins className="size-5 text-copper" />
        </header>
        <div className="space-y-2 p-4">
          {currencies.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label="كود العملة" dir="ltr" className="h-9 w-20 uppercase" value={c.code} disabled={!canEdit} onChange={(e) => setCurrencies(currencies.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase().slice(0, 3) } : x)))} />
              <Input aria-label="اسم العملة" className="h-9 flex-1" value={c.name} disabled={!canEdit} onChange={(e) => setCurrencies(currencies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label="سعر الصرف بالجنيه" type="number" min="0" step="0.01" className="h-9 w-28" value={c.rate || ""} placeholder="السعر" disabled={!canEdit} onChange={(e) => setCurrencies(currencies.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) || 0 } : x)))} />
              <span className="text-xs text-muted-foreground">ج.م</span>
              {canEdit && <Button size="icon" variant="ghost" aria-label="حذف العملة" onClick={() => setCurrencies(currencies.filter((_, j) => j !== i))}><Trash2 /></Button>}
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setCurrencies([...currencies, { code: "", name: "", rate: 0 }])}><Plus /> عملة</Button>
              <Button size="sm" onClick={() => saveCurrencies(currencies) && toast.success("تم حفظ أسعار الصرف.")}>حفظ العملات</Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
