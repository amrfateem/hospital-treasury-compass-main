import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  CheckCircle2,
  FileDown,
  FileUp,
  Landmark,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FieldRow, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { reconciliation, parseStatementCsv, type BankStatement, type BookItem } from "@/lib/hospital/bank";
import { boxBalance } from "@/lib/hospital/finance";
import { aiFileProblem, fileToBase64 } from "@/lib/hospital/file";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import { readBankStatement } from "@/lib/hospital/ocr.functions";
import {
  addBankAdjustment,
  autoMatchBankStatement,
  bookFor,
  deleteBankStatement,
  importBankStatement,
  listLabel,
  matchBankLine,
  newId,
  saveBankAccount,
  setBankStatementStatus,
  unmatchBankLine,
  useCan,
  useHospitalDB,
  usedOnOtherStatements,
  type BankLine,
  type Cashbox,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bank")({
  head: () => ({
    meta: [
      { title: "البنوك والمطابقة البنكية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "حسابات المستشفى البنكية، استيراد كشوف الحساب، المطابقة الآلية مع حركات الخزينة، وتقرير التسوية البنكية.",
      },
      { property: "og:title", content: "البنوك والمطابقة البنكية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "مطابقة كشوف البنك آليًا مع دفاتر المستشفى وتسوية الفروق." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BankPage,
});

function BankPage() {
  const db = useHospitalDB();
  const banks = db.cashboxes.filter((b) => b.kind === "bank");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Cashbox | null | "new">(null);
  const [importing, setImporting] = useState(false);
  const [openSt, setOpenSt] = useState<string | null>(null);
  const bank = banks.find((b) => b.id === selected) ?? banks[0];
  const statements = db.bankStatements.filter((s) => s.boxId === bank?.id).sort((a, b) => b.to.localeCompare(a.to));
  const st = db.bankStatements.find((s) => s.id === openSt) ?? null;
  const canEdit = useCan("bank", "add");
  const total = banks.reduce((s, b) => s + boxBalance(b.id, db.transactions, db.transfers), 0);
  const open = db.bankStatements.filter((s) => s.status === "open").length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="إدارة الخزينة"
        title="البنوك والمطابقة البنكية"
        description="اربط حسابات المستشفى البنكية، واستورد كشف الحساب (ملف CSV من البنك، أو PDF / صورة تقرؤها القراءة الذكية)، ويطابق النظام الحركات آليًا مع الخزينة ويُظهر الفروق للتسوية."
        actions={
          canEdit ? (
            <>
              <Button onClick={() => setEditing("new")} variant="outline">
                <Plus /> حساب بنكي
              </Button>
              <Button onClick={() => setImporting(true)} disabled={!banks.length}>
                <FileUp /> استيراد كشف حساب
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="رصيد البنوك بالدفاتر" value={money(total)} icon={Landmark} tone="primary" hint="ج.م" />
        <StatCard label="الحسابات البنكية" value={int(banks.length)} icon={Landmark} />
        <StatCard label="كشوف مستوردة" value={int(db.bankStatements.length)} icon={FileUp} />
        <StatCard label="كشوف تحت المطابقة" value={int(open)} icon={ArrowRightLeft} tone={open ? "copper" : "default"} />
      </div>

      {!banks.length ? (
        <div className="ledger-card p-10 text-center">
          <Landmark className="mx-auto mb-3 size-10 text-primary" />
          <p className="font-semibold">لا توجد حسابات بنكية بعد.</p>
          <p className="mt-1 text-sm text-muted-foreground">أضف حساب المستشفى في البنك، وحدد طرق الدفع (فيزا، تحويل، إنستاباي) التي تصب فيه.</p>
          {canEdit && (
            <Button className="mt-4" onClick={() => setEditing("new")}>
              <Plus /> إضافة حساب بنكي
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {banks.map((b) => {
              const bal = boxBalance(b.id, db.transactions, db.transfers);
              const last = db.bankStatements.filter((s) => s.boxId === b.id && s.status === "reconciled").sort((x, y) => y.to.localeCompare(x.to))[0];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b.id)}
                  className={cn("ledger-card p-4 text-right transition-colors hover:border-primary/50", bank?.id === b.id && "border-primary ring-2 ring-primary/20")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{[b.bankName, b.accountNo && `حساب ${b.accountNo}`].filter(Boolean).join(" — ") || "—"}</p>
                    </div>
                    {canEdit && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="تعديل الحساب"
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(b);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && setEditing(b)}
                      >
                        <Pencil className="size-4" />
                      </span>
                    )}
                  </div>
                  <p className="num mt-3 text-xl font-bold text-primary">{egp(bal)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {b.methods?.length ? `تصب فيه: ${b.methods.map((m) => listLabel(db.lists.paymentMethods, m)).join("، ")}` : "لا توجد طرق دفع مربوطة"}
                    {last ? ` • آخر مطابقة حتى ${dateLabel(last.to)}` : " • لم تتم مطابقة بعد"}
                  </p>
                </button>
              );
            })}
          </div>

          <h2 className="mb-3 text-xl font-bold">كشوف حساب {bank?.name}</h2>
          <TableCard minWidth={860}>
            <thead>
              <HeadRow>
                <Th>الكشف</Th>
                <Th>الفترة</Th>
                <Th num>الرصيد الختامي</Th>
                <Th num>حركات</Th>
                <Th num>مطابق</Th>
                <Th num>الفرق</Th>
                <Th>الحالة</Th>
                <Th />
              </HeadRow>
            </thead>
            <tbody>
              {statements.map((s) => {
                const book = bookFor(db, s.boxId);
                const r = reconciliation(s, book, usedOnOtherStatements(db, s));
                return (
                  <tr key={s.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => setOpenSt(s.id)}>
                    <Td className="font-mono text-xs"><span dir="ltr">{s.number}</span><p className="font-sans text-[11px] text-muted-foreground">{s.fileName || "—"}</p></Td>
                    <Td className="text-xs">{dateLabel(s.from)} ← {dateLabel(s.to)}</Td>
                    <Td num>{money(s.closingBalance)}</Td>
                    <Td num>{int(s.lines.length)}</Td>
                    <Td num>{int(r.matchedCount)}</Td>
                    <Td num className={cn("font-semibold", Math.abs(r.difference) >= 0.01 ? "text-expense" : "text-income")}>{money(r.difference)}</Td>
                    <Td>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.status === "reconciled" ? "bg-income/10 text-income" : "bg-copper/10 text-copper")}>
                        {s.status === "reconciled" ? "مطابَق ومعتمد" : "تحت المطابقة"}
                      </span>
                    </Td>
                    <Td className="text-left text-xs text-primary">فتح</Td>
                  </tr>
                );
              })}
              {!statements.length && <EmptyRow cols={8} text="لم يُستورد أي كشف لهذا الحساب بعد." />}
            </tbody>
          </TableCard>
        </>
      )}

      {editing && <BankAccountDialog key={editing === "new" ? "new" : editing.id} value={editing} onClose={() => setEditing(null)} />}
      <ImportDialog open={importing} onOpenChange={setImporting} defaultBank={bank?.id ?? ""} onImported={(id) => setOpenSt(id)} />
      {st && <StatementDialog st={st} onClose={() => setOpenSt(null)} />}
    </div>
  );
}

function BankAccountDialog({ value, onClose }: { value: Cashbox | "new"; onClose: () => void }) {
  const { lists } = useHospitalDB();
  const init = value !== "new" ? value : null;
  const [f, setF] = useState<Cashbox>(() => init ?? { id: newId(), name: "", kind: "bank", active: true, methods: ["card", "transfer"] });
  const toggle = (m: string) =>
    setF({ ...f, methods: f.methods?.includes(m) ? f.methods.filter((x) => x !== m) : [...(f.methods ?? []), m] });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{init ? "تعديل حساب بنكي" : "حساب بنكي جديد"}</DialogTitle>
          <DialogDescription>يظهر الحساب كخزينة يمكن الدفع منها والتحويل إليها، ويُطابق مع كشوف البنك.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (saveBankAccount(f)) {
              toast.success("تم حفظ الحساب البنكي.");
              onClose();
            }
          }}
        >
          <FieldRow label="اسم الحساب (يظهر في القوائم)" htmlFor="bk-name">
            <Input id="bk-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: البنك الأهلي — الحساب الجاري" required />
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label="البنك" htmlFor="bk-bank">
              <Input id="bk-bank" value={f.bankName ?? ""} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
            </FieldRow>
            <FieldRow label="رقم الحساب" htmlFor="bk-no">
              <Input id="bk-no" dir="ltr" value={f.accountNo ?? ""} onChange={(e) => setF({ ...f, accountNo: e.target.value })} />
            </FieldRow>
          </div>
          <FieldRow label="IBAN (اختياري)" htmlFor="bk-iban">
            <Input id="bk-iban" dir="ltr" value={f.iban ?? ""} onChange={(e) => setF({ ...f, iban: e.target.value })} />
          </FieldRow>
          <div className="grid gap-2">
            <p className="text-sm font-medium">طرق الدفع التي تصب في هذا الحساب</p>
            <p className="text-xs text-muted-foreground">مثلًا مدفوعات الفيزا في الخزينة الرئيسية تنزل البنك — فتظهر في المطابقة.</p>
            <div className="flex flex-wrap gap-3">
              {lists.paymentMethods.filter((m) => m.id !== "cash").map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!f.methods?.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">حفظ</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DraftLine {
  date: string;
  description: string;
  reference?: string | undefined;
  amount: number;
  balance?: number | undefined;
}

function ImportDialog({
  open,
  onOpenChange,
  defaultBank,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultBank: string;
  onImported: (id: string) => void;
}) {
  const db = useHospitalDB();
  const read = useServerFn(readBankStatement);
  const banks = db.cashboxes.filter((b) => b.kind === "bank");
  const [boxId, setBoxId] = useState(defaultBank);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [meta, setMeta] = useState({ from: "", to: "", opening: "", closing: "", fileName: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setLines([]);
    setMeta({ from: "", to: "", opening: "", closing: "", fileName: "" });
    setMsg([]);
  }
  function fill(ls: DraftLine[], fileName: string, opening?: number | null, closing?: number | null, from?: string | null, to?: string | null) {
    const sorted = [...ls].sort((a, b) => a.date.localeCompare(b.date));
    const sum = sorted.reduce((s, l) => s + l.amount, 0);
    const lastBal = [...sorted].reverse().find((l) => l.balance !== undefined)?.balance;
    const close = closing ?? lastBal ?? null;
    const openB = opening ?? (close !== null ? close - sum : 0);
    setLines(sorted);
    setMeta({
      fileName,
      from: from || sorted[0]?.date || "",
      to: to || sorted.at(-1)?.date || "",
      opening: String(Math.round(openB * 100) / 100),
      closing: String(Math.round((close ?? openB + sum) * 100) / 100),
    });
  }

  async function onFile(file: File) {
    reset();
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const r = parseStatementCsv(await file.text());
      setMsg(r.errors.slice(0, 5));
      if (!r.lines.length) { toast.error(r.errors[0] ?? "لم نجد حركات في الملف."); return; }
      fill(r.lines, file.name);
      return;
    }
    const problem = aiFileProblem(file);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      const res = await read({ data: { file: { fileName: file.name, mimeType: file.type, base64: await fileToBase64(file) } } });
      if (!res.ok) { toast.error(res.error); return; }
      const r = res.result;
      const ls = r.lines
        .map((l) => ({
          date: l.date,
          description: l.description,
          reference: l.reference ?? undefined,
          amount: Math.round(((l.credit ?? 0) - (l.debit ?? 0)) * 100) / 100,
          balance: l.balance ?? undefined,
        }))
        .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && Math.abs(l.amount) >= 0.005);
      if (!ls.length) { toast.error("لم نجد حركات واضحة في الكشف."); return; }
      fill(ls, file.name, r.openingBalance, r.closingBalance, r.from, r.to);
      toast.success(`تمت قراءة ${int(ls.length)} حركة — راجعها قبل الاستيراد.`);
    } catch (e) {
      console.error(e);
      toast.error("تعذّرت قراءة الكشف، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const gap = Math.round((Number(meta.opening) + sum - Number(meta.closing)) * 100) / 100;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">استيراد كشف حساب بنكي</DialogTitle>
          <DialogDescription>ملف CSV من موقع البنك يُقرأ فورًا. ملف PDF أو صورة الكشف تقرؤه القراءة الذكية (قد يستغرق نصف دقيقة).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="الحساب البنكي">
            <Select value={boxId || defaultBank} onValueChange={setBoxId}>
              <SelectTrigger aria-label="الحساب البنكي"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="ملف الكشف">
            <input ref={inputRef} type="file" accept=".csv,text/csv,application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
            <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Sparkles className="animate-pulse" /> : <FileUp />}
              {busy ? "جارٍ القراءة الذكية..." : meta.fileName || "اختر ملف CSV أو PDF أو صورة"}
            </Button>
          </FieldRow>
        </div>
        {msg.length > 0 && <ul className="rounded-md bg-copper/10 p-2 text-xs text-copper">{msg.map((m) => <li key={m}>{m}</li>)}</ul>}
        {lines.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FieldRow label="من" htmlFor="st-from"><Input id="st-from" type="date" value={meta.from} onChange={(e) => setMeta({ ...meta, from: e.target.value })} /></FieldRow>
              <FieldRow label="إلى" htmlFor="st-to"><Input id="st-to" type="date" value={meta.to} onChange={(e) => setMeta({ ...meta, to: e.target.value })} /></FieldRow>
              <FieldRow label="الرصيد الافتتاحي" htmlFor="st-op"><Input id="st-op" type="number" step="0.01" value={meta.opening} onChange={(e) => setMeta({ ...meta, opening: e.target.value })} /></FieldRow>
              <FieldRow label="الرصيد الختامي" htmlFor="st-cl"><Input id="st-cl" type="number" step="0.01" value={meta.closing} onChange={(e) => setMeta({ ...meta, closing: e.target.value })} /></FieldRow>
            </div>
            {Math.abs(gap) >= 0.01 && (
              <p className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">الافتتاحي + الحركات لا يساوي الختامي (فرق {money(gap)}) — تأكد أن الكشف كامل.</p>
            )}
            <TableCard minWidth={560}>
              <thead><HeadRow><Th>التاريخ</Th><Th>البيان</Th><Th num>إيداع</Th><Th num>سحب</Th></HeadRow></thead>
              <tbody>
                {lines.slice(0, 200).map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <Td num className="text-right">{dateLabel(l.date)}</Td>
                    <Td className="max-w-80 truncate">{l.description}{l.reference && <span dir="ltr" className="ms-2 font-mono text-[11px] text-muted-foreground">{l.reference}</span>}</Td>
                    <Td num className="text-income">{l.amount > 0 ? money(l.amount) : ""}</Td>
                    <Td num className="text-expense">{l.amount < 0 ? money(-l.amount) : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
            <DialogFooter>
              <Button
                onClick={() => {
                  const id = importBankStatement({
                    boxId: boxId || defaultBank,
                    from: meta.from,
                    to: meta.to,
                    openingBalance: Number(meta.opening) || 0,
                    closingBalance: Number(meta.closing) || 0,
                    fileName: meta.fileName,
                    lines,
                  });
                  if (id) {
                    toast.success("تم استيراد الكشف ومطابقته آليًا.");
                    onOpenChange(false);
                    reset();
                    onImported(id);
                  }
                }}
              >
                <CheckCircle2 /> استيراد {int(lines.length)} حركة ومطابقتها
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({ st, onClose }: { st: BankStatement; onClose: () => void }) {
  const db = useHospitalDB();
  const canEdit = useCan("bank", "add");
  const book = useMemo(() => bookFor(db, st.boxId), [db, st.boxId]);
  const used = useMemo(() => usedOnOtherStatements(db, st), [db, st]);
  const r = reconciliation(st, book, used);
  const bank = db.cashboxes.find((b) => b.id === st.boxId);
  const [matching, setMatching] = useState<BankLine | null>(null);
  const [adjusting, setAdjusting] = useState<BankLine | null>(null);
  const [filter, setFilter] = useState<"all" | "open">("all");
  const locked = st.status === "reconciled";
  const pdf = usePdfExport();
  const bookById = new Map(book.map((b) => [b.id, b]));
  const lines = st.lines.filter((l) => filter === "all" || (!l.matched?.length && !l.adjustmentTxId));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            مطابقة {bank?.name} — <span dir="ltr" className="font-mono text-lg">{st.number}</span>
          </DialogTitle>
          <DialogDescription>
            {dateLabel(st.from)} ← {dateLabel(st.to)} • استورده {st.importedBy}
            {st.reconciledBy && ` • اعتمد المطابقة ${st.reconciledBy}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="رصيد البنك (الكشف)" value={money(r.bankBalance)} />
          <StatCard label="رصيد الدفاتر" value={money(r.bookBalance)} />
          <StatCard label="مطابق" value={`${int(r.matchedCount)} / ${int(st.lines.length)}`} tone="primary" />
          <StatCard label="الفرق بعد التسوية" value={money(r.difference)} tone={Math.abs(r.difference) < 0.01 ? "income" : "expense"} />
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm md:grid-cols-2">
          <div>
            <p className="mb-1 font-semibold">تسوية رصيد البنك</p>
            <Row k="رصيد الكشف" v={r.bankBalance} />
            <Row k="+ إيداعات بالدفاتر لم تظهر في البنك" v={r.depositsInTransit} />
            <Row k="− مدفوعات بالدفاتر لم تُصرف من البنك" v={r.outstandingPayments} />
            <Row k="= الرصيد المعدّل للبنك" v={r.adjustedBank} bold />
          </div>
          <div>
            <p className="mb-1 font-semibold">تسوية رصيد الدفاتر</p>
            <Row k="رصيد الدفاتر" v={r.bookBalance} />
            <Row k="+ إيداعات بالبنك غير مسجلة (فوائد، تحصيلات)" v={r.bankCredits} />
            <Row k="− خصومات بالبنك غير مسجلة (عمولات، مصاريف)" v={r.bankDebits} />
            <Row k="= الرصيد المعدّل للدفاتر" v={r.adjustedBook} bold />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !locked && (
            <Button size="sm" variant="outline" onClick={() => autoMatchBankStatement(st.id) && toast.success("تمت المطابقة التلقائية.")}>
              <Wand2 /> مطابقة تلقائية
            </Button>
          )}
          {canEdit && (
            locked ? (
              <Button size="sm" variant="outline" onClick={() => setBankStatementStatus(st.id, "open")}><LockOpen /> إعادة فتح</Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  if (Math.abs(r.difference) >= 0.01 && !window.confirm(`لا يزال هناك فرق ${money(r.difference)}. اعتماد المطابقة على أي حال؟`)) return;
                  if (setBankStatementStatus(st.id, "reconciled")) toast.success("تم اعتماد المطابقة البنكية.");
                }}
              >
                <Lock /> اعتماد المطابقة
              </Button>
            )
          )}
          <Button size="sm" variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`تسوية-بنكية-${st.number}.pdf`, "تم تصدير تقرير التسوية.")}>
            <FileDown /> تقرير التسوية PDF
          </Button>
          <div className="ms-auto flex gap-1">
            <button type="button" className={cn("chip-filter", filter === "all" && "chip-filter-active")} onClick={() => setFilter("all")}>كل الحركات</button>
            <button type="button" className={cn("chip-filter", filter === "open" && "chip-filter-active")} onClick={() => setFilter("open")}>غير المطابق ({int(r.unmatchedBank.length)})</button>
          </div>
          {canEdit && !locked && (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm("حذف هذا الكشف ومطابقاته؟") && deleteBankStatement(st.id) && onClose()}>
              <Trash2 /> حذف الكشف
            </Button>
          )}
        </div>

        <h3 className="font-bold">حركات كشف البنك</h3>
        <TableCard minWidth={900}>
          <thead>
            <HeadRow>
              <Th>التاريخ</Th>
              <Th>البيان في الكشف</Th>
              <Th num>إيداع</Th>
              <Th num>سحب</Th>
              <Th>يقابله في الدفاتر</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {lines.map((l) => {
              const m = (l.matched ?? []).map((id) => bookById.get(id)).filter(Boolean) as BookItem[];
              const adj = l.adjustmentTxId ? db.transactions.find((t) => t.id === l.adjustmentTxId) : undefined;
              const done = m.length > 0 || !!l.adjustmentTxId;
              return (
                <tr key={l.id} className={cn("border-b last:border-0", !done && "bg-copper/5")}>
                  <Td num className="text-right">{dateLabel(l.date)}</Td>
                  <Td className="max-w-72">
                    <p className="truncate">{l.description}</p>
                    {l.reference && <p dir="ltr" className="text-right font-mono text-[11px] text-muted-foreground">{l.reference}</p>}
                  </Td>
                  <Td num className="text-income">{l.amount > 0 ? money(l.amount) : ""}</Td>
                  <Td num className="text-expense">{l.amount < 0 ? money(-l.amount) : ""}</Td>
                  <Td className="text-xs">
                    {m.map((b) => (
                      <p key={b.id} className="flex items-center gap-1 text-income">
                        <CheckCircle2 className="size-3.5 shrink-0" /> <span dir="ltr" className="font-mono">{b.reference}</span> — {dateLabel(b.date)}
                      </p>
                    ))}
                    {adj && <p className="flex items-center gap-1 text-primary"><CheckCircle2 className="size-3.5" /> قيد تسوية {adj.receiptId}</p>}
                    {!done && <span className="text-copper">غير مطابق</span>}
                  </Td>
                  <Td>
                    {canEdit && !locked && (
                      <div className="flex justify-end gap-1">
                        {done ? (
                          <Button size="sm" variant="ghost" onClick={() => unmatchBankLine(st.id, l.id)}><Link2Off /> فك</Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setMatching(l)}><Link2 /> مطابقة</Button>
                            <Button size="sm" variant="ghost" onClick={() => setAdjusting(l)}><Plus /> تسجيل بالدفاتر</Button>
                          </>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
            {!lines.length && <EmptyRow cols={6} text="كل الحركات مطابقة." />}
          </tbody>
        </TableCard>

        <h3 className="font-bold">حركات بالدفاتر في الفترة لم تظهر في الكشف ({int(r.unmatchedBook.length)})</h3>
        <TableCard minWidth={700}>
          <thead><HeadRow><Th>التاريخ</Th><Th>المستند</Th><Th>البيان</Th><Th num>داخل</Th><Th num>خارج</Th></HeadRow></thead>
          <tbody>
            {r.unmatchedBook.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <Td num className="text-right">{dateLabel(b.date)}</Td>
                <Td className="font-mono text-xs" ><span dir="ltr">{b.reference}</span></Td>
                <Td className="max-w-80 truncate">{b.description}</Td>
                <Td num className="text-income">{b.amount > 0 ? money(b.amount) : ""}</Td>
                <Td num className="text-expense">{b.amount < 0 ? money(-b.amount) : ""}</Td>
              </tr>
            ))}
            {!r.unmatchedBook.length && <EmptyRow cols={5} text="لا توجد حركات معلّقة بالدفاتر." />}
          </tbody>
        </TableCard>

        {matching && <MatchDialog key={matching.id} st={st} line={matching} book={book} used={used} onClose={() => setMatching(null)} />}
        {adjusting && <AdjustDialog key={adjusting.id} st={st} line={adjusting} onClose={() => setAdjusting(null)} />}

        <OfficialDocument ref={pdf.ref} settings={db.settings} title="مذكرة التسوية البنكية" subtitle={`${bank?.name ?? ""} — ${st.number} — من ${dateLabel(st.from)} إلى ${dateLabel(st.to)}`} issuedOn={dateLabel(isoDate(new Date()))}>
          <table className="doc-table">
            <tbody>
              {([
                ["رصيد البنك حسب الكشف", r.bankBalance],
                ["يضاف: إيداعات بالدفاتر لم تظهر بالبنك", r.depositsInTransit],
                ["يخصم: مدفوعات بالدفاتر لم تُصرف من البنك", r.outstandingPayments],
                ["الرصيد المعدّل للبنك", r.adjustedBank],
                ["رصيد الدفاتر", r.bookBalance],
                ["يضاف: إيداعات بالبنك غير مسجلة بالدفاتر", r.bankCredits],
                ["يخصم: خصومات بالبنك غير مسجلة بالدفاتر", r.bankDebits],
                ["الرصيد المعدّل للدفاتر", r.adjustedBook],
                ["الفرق", r.difference],
              ] as [string, number][]).map(([k, v]) => (
                <tr key={k} data-pdf-break><td className="text-start">{k}</td><td>{money(v)}</td></tr>
              ))}
            </tbody>
          </table>
          {r.unmatchedBank.length > 0 && (
            <>
              <p data-pdf-break style={{ fontWeight: 700, margin: "12px 0 6px" }}>حركات بالبنك غير مسجلة بالدفاتر</p>
              <table className="doc-table">
                <thead><tr data-pdf-break><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
                <tbody>{r.unmatchedBank.map((l) => <tr key={l.id} data-pdf-break><td>{dateLabel(l.date)}</td><td className="text-start">{l.description}</td><td>{money(l.amount)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {r.unmatchedBook.length > 0 && (
            <>
              <p data-pdf-break style={{ fontWeight: 700, margin: "12px 0 6px" }}>حركات بالدفاتر لم تظهر بالبنك</p>
              <table className="doc-table">
                <thead><tr data-pdf-break><th>التاريخ</th><th>المستند</th><th>البيان</th><th>المبلغ</th></tr></thead>
                <tbody>{r.unmatchedBook.map((b) => <tr key={b.id} data-pdf-break><td>{dateLabel(b.date)}</td><td dir="ltr">{b.reference}</td><td className="text-start">{b.description}</td><td>{money(b.amount)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          <SignatureBlock roles={["المحاسب المختص", "المدير المالي"]} />
        </OfficialDocument>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2 py-0.5", bold && "border-t pt-1 font-bold")}>
      <span>{k}</span>
      <span className="num">{money(v)}</span>
    </div>
  );
}

function MatchDialog({ st, line, book, used, onClose }: { st: BankStatement; line: BankLine; book: BookItem[]; used: Set<string>; onClose: () => void }) {
  const [pick, setPick] = useState<string[]>([]);
  const taken = new Set([...used, ...st.lines.flatMap((l) => (l.id === line.id ? [] : l.matched ?? []))]);
  const sign = Math.sign(line.amount);
  const candidates = book
    .filter((b) => !taken.has(b.id) && Math.sign(b.amount) === sign)
    .sort((a, b) => Math.abs(Math.abs(a.amount) - Math.abs(line.amount)) - Math.abs(Math.abs(b.amount) - Math.abs(line.amount)))
    .slice(0, 60);
  const sel = book.filter((b) => pick.includes(b.id)).reduce((s, b) => s + b.amount, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>مطابقة يدوية — {money(line.amount)} ج.م</DialogTitle>
          <DialogDescription>{dateLabel(line.date)} — {line.description}. يمكنك اختيار أكثر من حركة (مثل عدة إيصالات فيزا في إيداع واحد).</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {candidates.map((b) => (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                <Checkbox checked={pick.includes(b.id)} onCheckedChange={(c) => setPick(c ? [...pick, b.id] : pick.filter((x) => x !== b.id))} />
                <span className="num w-24 text-xs">{dateLabel(b.date)}</span>
                <span className="flex-1 truncate text-sm">{b.description} <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">{b.reference}</span></span>
                <span className="num font-semibold">{money(b.amount)}</span>
              </label>
            </li>
          ))}
          {!candidates.length && <li className="p-6 text-center text-sm text-muted-foreground">لا توجد حركات بالدفاتر في نفس الاتجاه — سجّلها بالدفاتر بدلًا من ذلك.</li>}
        </ul>
        <DialogFooter className="items-center gap-3">
          <span className={cn("num text-sm", Math.abs(sel - line.amount) < 0.01 ? "text-income" : "text-copper")}>المختار: {money(sel)}</span>
          <Button disabled={!pick.length} onClick={() => { if (matchBankLine(st.id, line.id, pick)) { toast.success("تمت المطابقة."); onClose(); } }}>
            <Link2 /> مطابقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ st, line, onClose }: { st: BankStatement; line: BankLine; onClose: () => void }) {
  const { lists } = useHospitalDB();
  const [category, setCategory] = useState("bank-fees");
  const [department, setDepartment] = useState("general");
  const [description, setDescription] = useState(line.description);
  const out = line.amount < 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>{out ? "تسجيل خصم بنكي كمصروف" : "تسجيل إيداع بنكي كإيراد"} — {money(Math.abs(line.amount))} ج.م</DialogTitle>
          <DialogDescription>يُنشأ قيد بالدفاتر على الحساب البنكي بتاريخ {dateLabel(line.date)} ويُطابق مع هذه الحركة.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FieldRow label="البيان" htmlFor="adj-desc"><Input id="adj-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></FieldRow>
          {out && (
            <FieldRow label="بند المصروف">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="بند المصروف"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">{lists.expenseCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </FieldRow>
          )}
          <FieldRow label="مركز التكلفة"><DeptSelect value={department} onChange={setDepartment} /></FieldRow>
        </div>
        <DialogFooter>
          <Button onClick={() => { if (addBankAdjustment({ statementId: st.id, lineId: line.id, category, department, description })) { toast.success("تم تسجيل القيد ومطابقته."); onClose(); } }}>
            <CheckCircle2 /> تسجيل ومطابقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
