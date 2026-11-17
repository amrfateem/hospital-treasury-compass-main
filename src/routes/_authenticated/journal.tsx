import { createFileRoute } from "@tanstack/react-router";
import { BookPlus, FolderTree, Pencil, Plus, RotateCcw, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FieldRow, FilterBar, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { useJournal } from "@/components/hospital/accounting/drill";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { ACCOUNT_TYPE_LABELS, GROUPS, isControlled, type Account } from "@/lib/hospital/ledger";
import {
  deleteCustomAccount,
  deleteJournalEntry,
  saveCustomAccount,
  saveJournalEntry,
  useCan,
  useHospitalDB,
} from "@/lib/hospital/store";
import { MANUAL_ENTRY_KINDS, type ManualEntryKind, type ManualJournalEntry, type ManualLine } from "@/lib/hospital/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/journal")({
  head: () => ({
    meta: [
      { title: "القيود اليدوية ودليل الحسابات | مستشفى الرحمة التخصصي" },
      { name: "description", content: "قيود التسوية والتصحيح والمستحقات آخر السنة يكتبها المحاسب بنفسه، مع دليل حسابات قابل للإضافة." },
      { property: "og:title", content: "القيود اليدوية ودليل الحسابات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "قيود يومية يدوية متوازنة تظهر فورًا في القوائم المالية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JournalPage,
});

const NONE = "__none";
const round2 = (n: number) => Math.round(n * 100) / 100;

function nextMonthStart(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function JournalPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth());
  const [editing, setEditing] = useState<ManualJournalEntry | "new" | null>(null);
  const canEdit = useCan("accounting", "add");
  const { accounts, name } = useJournal(range.to);
  const list = useMemo(
    () => db.journalEntries.filter((e) => e.date >= range.from && e.date <= range.to).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [db.journalEntries, range],
  );
  const total = list.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0);
  const accruals = list.filter((e) => e.reverseOn).length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المحاسبة العامة"
        title="القيود اليدوية ودليل الحسابات"
        description="قيود التسوية والتصحيح والمصروفات المستحقة والمدفوعة مقدمًا يكتبها المحاسب بنفسه. كل قيد لازم يكون متوازن، ويظهر فورًا في ميزان المراجعة وقائمة الدخل والميزانية."
        actions={canEdit ? <Button onClick={() => setEditing("new")}><BookPlus /> قيد يومية جديد</Button> : undefined}
      />

      <Tabs defaultValue="entries" dir="rtl">
        <TabsList className="mb-4">
          <TabsTrigger value="entries">القيود اليدوية</TabsTrigger>
          <TabsTrigger value="chart">دليل الحسابات</TabsTrigger>
        </TabsList>

        <TabsContent value="entries">
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="قيود الفترة" value={int(list.length)} icon={BookPlus} />
            <StatCard label="إجمالي المدين = الدائن" value={money(total)} icon={Scale} tone="primary" hint="ج.م" />
            <StatCard label="قيود مستحقات تُعكس تلقائيًا" value={int(accruals)} icon={RotateCcw} tone="copper" />
          </div>
          <FilterBar>
            <RangePicker value={range} onChange={setRange} />
          </FilterBar>
          <TableCard minWidth={900}>
            <thead>
              <HeadRow>
                <Th>رقم القيد</Th>
                <Th>التاريخ</Th>
                <Th>النوع</Th>
                <Th>البيان والحسابات</Th>
                <Th num>المبلغ</Th>
                <Th />
              </HeadRow>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b align-top last:border-0 hover:bg-muted/40">
                  <Td className="font-mono text-xs"><span dir="ltr">{e.number}</span></Td>
                  <Td num className="text-right">{dateLabel(e.date)}</Td>
                  <Td>
                    <span className="chip-filter">{MANUAL_ENTRY_KINDS[e.kind]}</span>
                    {e.reverseOn && <p className="mt-1 text-[11px] text-copper">يُعكس في {dateLabel(e.reverseOn)}</p>}
                  </Td>
                  <Td>
                    <p className="font-medium">{e.description}</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {e.lines.map((l, i) => (
                        <li key={i} className={cn(l.credit > 0 && "ps-6")}>
                          {l.debit > 0 ? "من ح/ " : "إلى ح/ "}
                          {name(l.account)} <span className="num">{money(l.debit || l.credit)}</span>
                          {l.costCenter && ` — ${findDepartment(db.departments, l.costCenter).name}`}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td num className="font-semibold">{money(e.lines.reduce((s, l) => s + l.debit, 0))}</Td>
                  <Td>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" aria-label="تعديل القيد" onClick={() => setEditing(e)}><Pencil /></Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="حذف القيد"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => window.confirm(`حذف القيد ${e.number}؟`) && deleteJournalEntry(e.id) && toast.success("تم حذف القيد.")}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
              {!list.length && <EmptyRow cols={6} text="لا توجد قيود يدوية في هذه الفترة." />}
            </tbody>
          </TableCard>
          <p className="mt-2 text-[11px] text-muted-foreground">
            حسابات الخزائن والبنوك والتأمين والآجل والموردين لا تدخل في القيود اليدوية — بتتسجل من صفحاتها عشان الأرصدة تفضل متطابقة.
          </p>
        </TabsContent>

        <TabsContent value="chart">
          <ChartOfAccounts accounts={accounts} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {editing && (
        <EntryDialog key={editing === "new" ? "new" : editing.id} entry={editing === "new" ? null : editing} accounts={accounts} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AccountSelect({ value, onChange, accounts }: { value: string; onChange: (v: string) => void; accounts: Account[] }) {
  const usable = accounts.filter((a) => !isControlled(a.code));
  const groups = Object.keys(GROUPS).filter((g) => usable.some((a) => a.group === g));
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="h-8 min-w-56" aria-label="الحساب"><SelectValue placeholder="اختر الحساب" /></SelectTrigger>
      <SelectContent dir="rtl" className="max-h-80">
        <SelectItem value={NONE}>اختر الحساب</SelectItem>
        {groups.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel className="text-xs text-primary">{g} — {GROUPS[g]!.name}</SelectLabel>
            {usable.filter((a) => a.group === g).map((a) => (
              <SelectItem key={a.code} value={a.code}>{a.code === g ? `${GROUPS[g]!.name} (عام)` : a.name}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const emptyLine = (): ManualLine => ({ account: "", debit: 0, credit: 0 });

function EntryDialog({ entry, accounts, onClose }: { entry: ManualJournalEntry | null; accounts: Account[]; onClose: () => void }) {
  const [date, setDate] = useState(entry?.date ?? isoDate(new Date()));
  const [kind, setKind] = useState<ManualEntryKind>(entry?.kind ?? "adjustment");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [reverse, setReverse] = useState(!!entry?.reverseOn);
  const [lines, setLines] = useState<ManualLine[]>(entry?.lines.length ? entry.lines : [emptyLine(), emptyLine()]);
  const dr = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const cr = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  const diff = round2(dr - cr);
  const set = (i: number, patch: Partial<ManualLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = () => {
    const ok = saveJournalEntry(
      {
        date,
        kind,
        description,
        lines: lines.map((l) => ({ ...l, costCenter: l.costCenter || undefined, memo: l.memo?.trim() || undefined })),
        reverseOn: reverse ? nextMonthStart(date) : undefined,
      },
      entry,
    );
    if (ok) {
      toast.success("تم حفظ القيد.");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-2xl">{entry ? `تعديل القيد ${entry.number}` : "قيد يومية جديد"}</DialogTitle>
          <DialogDescription>اكتب الحسابات المدينة والدائنة؛ لازم إجمالي المدين يساوي الدائن.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldRow label="التاريخ" htmlFor="je-date"><Input id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FieldRow>
          <FieldRow label="نوع القيد">
            <Select value={kind} onValueChange={(v) => { setKind(v as ManualEntryKind); if (v === "accrual") setReverse(true); }}>
              <SelectTrigger aria-label="نوع القيد"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">{(Object.keys(MANUAL_ENTRY_KINDS) as ManualEntryKind[]).map((k) => <SelectItem key={k} value={k}>{MANUAL_ENTRY_KINDS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="البيان" htmlFor="je-desc"><Input id="je-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: كهرباء ديسمبر مستحقة" /></FieldRow>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={reverse} onCheckedChange={(v) => setReverse(v === true)} />
          يُعكس تلقائيًا أول الشهر التالي ({dateLabel(nextMonthStart(date || isoDate(new Date())))}) — للمصروفات والإيرادات المستحقة
        </label>
        <TableCard minWidth={860}>
          <thead>
            <HeadRow>
              <Th>الحساب</Th>
              <Th num>مدين</Th>
              <Th num>دائن</Th>
              <Th>مركز التكلفة</Th>
              <Th>ملاحظة</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <Td><AccountSelect value={l.account} onChange={(v) => set(i, { account: v })} accounts={accounts} /></Td>
                <Td><Input type="number" min="0" step="0.01" aria-label="مدين" className="h-8 w-28" value={l.debit || ""} onChange={(e) => set(i, { debit: Number(e.target.value) || 0, credit: Number(e.target.value) ? 0 : l.credit })} /></Td>
                <Td><Input type="number" min="0" step="0.01" aria-label="دائن" className="h-8 w-28" value={l.credit || ""} onChange={(e) => set(i, { credit: Number(e.target.value) || 0, debit: Number(e.target.value) ? 0 : l.debit })} /></Td>
                <Td><DeptSelect value={l.costCenter ?? "all"} onChange={(v) => set(i, { costCenter: v === "all" ? undefined : v })} allowAll allLabel="بدون مركز تكلفة" label="مركز التكلفة" className="h-8 w-44" /></Td>
                <Td><Input aria-label="ملاحظة" className="h-8 w-36" value={l.memo ?? ""} onChange={(e) => set(i, { memo: e.target.value })} /></Td>
                <Td>
                  <Button size="icon" variant="ghost" aria-label="حذف السطر" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
                </Td>
              </tr>
            ))}
            <tr className="bg-secondary/60 font-bold">
              <Td>الإجمالي</Td>
              <Td num>{money(dr)}</Td>
              <Td num>{money(cr)}</Td>
              <Td colSpan={3} className={cn("text-xs", diff === 0 && dr > 0 ? "text-income" : "text-destructive")}>
                {dr === 0 ? "اكتب المبالغ" : diff === 0 ? "القيد متوازن ✓" : `الفرق ${money(Math.abs(diff))} — القيد غير متوازن`}
              </Td>
            </tr>
          </tbody>
        </TableCard>
        <div>
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus /> سطر</Button>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={diff !== 0 || dr === 0}>حفظ القيد</Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChartOfAccounts({ accounts, canEdit }: { accounts: Account[]; canEdit: boolean }) {
  const db = useHospitalDB();
  const [adding, setAdding] = useState<{ group: string; code?: string; name: string } | null>(null);
  const custom = new Set(db.customAccounts.map((c) => c.code));
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(GROUPS).map(([code, g]) => {
          const subs = accounts.filter((a) => a.group === code && a.code !== code);
          const controlled = isControlled(code);
          return (
            <div key={code} className="ledger-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold"><span className="num me-2 text-primary">{code}</span>{g.name}</p>
                  <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[g.type]}{controlled ? " — تُدار من صفحاتها" : ""}</p>
                </div>
                {canEdit && !controlled && (
                  <Button size="sm" variant="ghost" onClick={() => setAdding({ group: code, name: "" })}><Plus /> حساب فرعي</Button>
                )}
              </div>
              {subs.length > 0 && (
                <ul className="mt-2 space-y-1 border-t pt-2 text-sm">
                  {subs.map((a) => (
                    <li key={a.code} className="flex items-center justify-between gap-2">
                      <span><span className="num me-2 text-xs text-muted-foreground" dir="ltr">{a.code}</span>{a.name}</span>
                      {canEdit && custom.has(a.code) && (
                        <span className="flex gap-1">
                          <Button size="icon" variant="ghost" className="size-7" aria-label="تعديل الاسم" onClick={() => setAdding({ group: code, code: a.code, name: a.name })}><Pencil /></Button>
                          <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" aria-label="حذف الحساب" onClick={() => window.confirm(`حذف ${a.name}؟`) && deleteCustomAccount(a.code)}><Trash2 /></Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {adding && (
        <Dialog open onOpenChange={(o) => !o && setAdding(null)}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader className="text-right">
              <DialogTitle className="flex items-center gap-2"><FolderTree className="size-5" /> {adding.code ? "تعديل حساب" : `حساب فرعي تحت ${GROUPS[adding.group]!.name}`}</DialogTitle>
              <DialogDescription>الحساب يظهر في القيود اليدوية والقوائم المالية.</DialogDescription>
            </DialogHeader>
            <FieldRow label="اسم الحساب" htmlFor="ca-name"><Input id="ca-name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></FieldRow>
            <DialogFooter className="gap-2 sm:justify-start">
              <Button onClick={() => saveCustomAccount({ code: adding.code, name: adding.name, group: adding.group }) && (toast.success("تم حفظ الحساب."), setAdding(null))}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
