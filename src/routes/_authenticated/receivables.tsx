import { createFileRoute } from "@tanstack/react-router";
import { AlarmClock, Building2, FileDown, HandCoins, Pencil, Plus, ReceiptText, Trash2, UserRound, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { BoxSelect, DeptSelect, EmptyRow, FieldRow, FilterBar, HeadRow, MethodSelect, SearchBox, TableCard, Td, Th, matches, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import { accountSummary, collectionsOf, creditStatement, dueSchedule, makeInstallments, type AccountSummary } from "@/lib/hospital/credit";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import {
  collectCredit,
  deleteCreditAccount,
  deleteCreditCharge,
  deleteCreditCollection,
  newId,
  saveCreditAccount,
  saveCreditCharge,
  useCan,
  useHospitalDB,
} from "@/lib/hospital/store";
import type { CreditAccount } from "@/lib/hospital/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/receivables")({
  head: () => ({
    meta: [
      { title: "حسابات المرضى والشركات الآجلة | مستشفى الرحمة التخصصي" },
      { name: "description", content: "مرضى بالتقسيط وشركات متعاقدة تسدد آخر الشهر: كشف حساب، جدول أقساط، متأخرات وتحصيل." },
      { property: "og:title", content: "حسابات المرضى والشركات الآجلة | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "متابعة الأقساط والمتأخرات وتحصيل الحسابات الآجلة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceivablesPage,
});

type Filter = "all" | "patient" | "company" | "late";

function ReceivablesPage() {
  const db = useHospitalDB();
  const today = isoDate(new Date());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<CreditAccount | "new" | null>(null);
  const [charging, setCharging] = useState<string | null | "pick">(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<AccountSummary | null>(null);
  const canEdit = useCan("receivables", "add");

  const rows = useMemo(
    () => db.creditAccounts.map((a) => accountSummary(db, a, today)).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance),
    [db, today],
  );
  const shown = rows.filter(
    (r) =>
      matches(q, r.account.name, r.account.phone, r.account.nationalId) &&
      (filter === "all" || (filter === "late" ? r.overdue > 0 : r.account.kind === filter)),
  );
  const month = today.slice(0, 7);
  const collectedMonth = db.transactions.filter((t) => t.source === "collection" && t.date.startsWith(month)).reduce((s, t) => s + t.amount, 0);
  const totalBal = rows.reduce((s, r) => s + r.balance, 0);
  const totalLate = rows.reduce((s, r) => s + r.overdue, 0);
  const open = rows.find((r) => r.account.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="حسابات المرضى والشركات الآجلة"
        description="مريض بيدفع على أقساط أو شركة متعاقدة بتسدد آخر الشهر: الجزء الآجل من الإيصال بيتسجل هنا تلقائيًا، وتتابع الأقساط والمتأخرات وتحصّل وتطبع كشف الحساب."
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={() => setCharging("pick")} disabled={!db.creditAccounts.length}><ReceiptText /> مديونية / رصيد افتتاحي</Button>
              <Button onClick={() => setEditing("new")}><Plus /> حساب جديد</Button>
            </>
          ) : undefined
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي المستحق على الحسابات" value={money(totalBal)} icon={Wallet} tone="primary" hint="ج.م" />
        <StatCard label="متأخرات (فات ميعادها)" value={money(totalLate)} icon={AlarmClock} tone={totalLate > 0 ? "expense" : "default"} hint={`${int(rows.filter((r) => r.overdue > 0).length)} حساب`} />
        <StatCard label="تحصيل هذا الشهر" value={money(collectedMonth)} icon={HandCoins} tone="income" hint="ج.م" />
        <StatCard label="الحسابات" value={int(rows.length)} icon={UserRound} hint={`${int(rows.filter((r) => r.account.kind === "company").length)} شركة متعاقدة`} />
      </div>
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو التليفون أو الرقم القومي" className="md:w-72" />
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "الكل"],
            ["patient", "مرضى"],
            ["company", "شركات متعاقدة"],
            ["late", "متأخرات فقط"],
          ] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn("chip-filter", filter === k && "chip-filter-active")}>{l}</button>
          ))}
        </div>
      </FilterBar>
      <TableCard minWidth={980}>
        <thead>
          <HeadRow>
            <Th>الحساب</Th>
            <Th num>إجمالي المديونية</Th>
            <Th num>المحصّل</Th>
            <Th num>الرصيد المستحق</Th>
            <Th num>متأخرات</Th>
            <Th>القسط القادم</Th>
            <Th>حد الائتمان</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.account.id} className={cn("border-b last:border-0 hover:bg-muted/40", !r.account.active && "opacity-60")}>
              <Td>
                <button type="button" className="text-right" onClick={() => setOpenId(r.account.id)}>
                  <p className="flex items-center gap-1.5 font-semibold">
                    {r.account.kind === "company" ? <Building2 className="size-4 text-primary" /> : <UserRound className="size-4 text-copper" />}
                    {r.account.name}
                    {!r.account.active && <span className="text-[10px] text-muted-foreground">(موقوف)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="ltr">{r.account.phone ?? ""}</p>
                </button>
              </Td>
              <Td num>{money(r.charged)}</Td>
              <Td num className="text-income">{money(r.collected)}</Td>
              <Td num className="font-bold">{money(r.balance)}</Td>
              <Td num className={cn(r.overdue > 0 ? "font-bold text-destructive" : "text-muted-foreground")}>
                {money(r.overdue)}
                {r.maxLate > 0 && <p className="text-[10px] font-normal">متأخر {int(r.maxLate)} يوم</p>}
              </Td>
              <Td className="text-xs">{r.nextDue ? <>{dateLabel(r.nextDue.due)} — <span className="num">{money(r.nextDue.remaining)}</span></> : "—"}</Td>
              <Td className="text-xs">
                {r.account.creditLimit ? (
                  <>
                    <span className="num">{money(r.account.creditLimit)}</span>
                    <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full", r.balance > r.account.creditLimit * 0.9 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, (r.balance / r.account.creditLimit) * 100)}%` }} />
                    </div>
                  </>
                ) : "بدون حد"}
              </Td>
              <Td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(r.account.id)}>كشف الحساب</Button>
                  {canEdit && r.balance > 0 && <Button size="sm" variant="outline" onClick={() => setCollecting(r)}><HandCoins /> تحصيل</Button>}
                  {canEdit && <Button size="icon" variant="ghost" aria-label="تعديل الحساب" onClick={() => setEditing(r.account)}><Pencil /></Button>}
                </div>
              </Td>
            </tr>
          ))}
          {!shown.length && <EmptyRow cols={8} text={rows.length ? "لا توجد حسابات بهذا البحث." : "لا توجد حسابات آجلة بعد — أضف مريضًا بالتقسيط أو شركة متعاقدة."} />}
        </tbody>
      </TableCard>
      <p className="mt-2 text-[11px] text-muted-foreground">
        من شاشة إيصال المريض اختار «جزء آجل» واختار الحساب وعدد الأقساط؛ الجزء ده مش بيدخل الخزينة دلوقتي، وبيتحصّل من هنا.
      </p>

      {editing && <AccountDialog key={editing === "new" ? "new" : editing.id} account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {charging && <ChargeDialog accountId={charging === "pick" ? null : charging} onClose={() => setCharging(null)} />}
      {collecting && <CollectDialog summary={collecting} onClose={() => setCollecting(null)} />}
      <AccountSheet summary={open} onClose={() => setOpenId(null)} onCollect={(s) => setCollecting(s)} onCharge={(id) => setCharging(id)} canEdit={canEdit} />
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: CreditAccount | null; onClose: () => void }) {
  const [f, setF] = useState<CreditAccount>(
    account ?? { id: newId(), kind: "patient", name: "", active: true, createdAt: 0, termsDays: 0 },
  );
  const save = () => {
    if (saveCreditAccount(f)) {
      toast.success("تم حفظ الحساب.");
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-xl">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-2xl">{account ? "تعديل حساب آجل" : "حساب آجل جديد"}</DialogTitle>
          <DialogDescription>مريض يدفع على أقساط، أو شركة متعاقدة يُحمَّل عليها علاج موظفيها وتسدد بعد مدة.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="النوع">
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as CreditAccount["kind"], termsDays: v === "company" && !f.termsDays ? 30 : f.termsDays })}>
              <SelectTrigger aria-label="نوع الحساب"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="patient">مريض (تقسيط)</SelectItem>
                <SelectItem value="company">شركة / جهة متعاقدة</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label={f.kind === "company" ? "اسم الشركة" : "اسم المريض"} htmlFor="ca-n"><Input id="ca-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FieldRow>
          <FieldRow label="التليفون" htmlFor="ca-p"><Input id="ca-p" dir="ltr" value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value || undefined })} /></FieldRow>
          {f.kind === "patient" ? (
            <FieldRow label="الرقم القومي (١٤ رقم)" htmlFor="ca-id"><Input id="ca-id" dir="ltr" inputMode="numeric" value={f.nationalId ?? ""} onChange={(e) => setF({ ...f, nationalId: e.target.value.replace(/\D/g, "").slice(0, 14) || undefined })} /></FieldRow>
          ) : (
            <FieldRow label="رقم التسجيل الضريبي" htmlFor="ca-tax"><Input id="ca-tax" dir="ltr" value={f.taxId ?? ""} onChange={(e) => setF({ ...f, taxId: e.target.value || undefined })} /></FieldRow>
          )}
          <FieldRow label="حد الائتمان (ج.م) — فارغ = بدون حد" htmlFor="ca-l"><Input id="ca-l" type="number" min="0" value={f.creditLimit ?? ""} onChange={(e) => setF({ ...f, creditLimit: Number(e.target.value) || undefined })} /></FieldRow>
          <FieldRow label="مدة السداد بالأيام (لو مفيش أقساط)" htmlFor="ca-t"><Input id="ca-t" type="number" min="0" value={f.termsDays ?? ""} onChange={(e) => setF({ ...f, termsDays: Number(e.target.value) || 0 })} /></FieldRow>
          <FieldRow label="ملاحظات" className="sm:col-span-2"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value || undefined })} rows={2} /></FieldRow>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v === true })} /> الحساب نشط (يظهر في الإيصالات)</label>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save}>حفظ</Button>
          {account && (
            <Button variant="ghost" className="text-destructive" onClick={() => window.confirm("حذف الحساب؟") && deleteCreditAccount(account.id) && onClose()}>
              <Trash2 /> حذف
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDialog({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const db = useHospitalDB();
  const [acct, setAcct] = useState(accountId ?? db.creditAccounts[0]?.id ?? "");
  const [date, setDate] = useState(isoDate(new Date()));
  const [kind, setKind] = useState<"opening" | "service">("opening");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [department, setDepartment] = useState(GENERAL_DEPT_ID);
  const [count, setCount] = useState("1");
  const [firstDue, setFirstDue] = useState(isoDate(new Date()));
  const n = Number(count) || 1;
  const save = () => {
    const amt = Number(amount);
    const ok = saveCreditCharge({
      accountId: acct,
      date,
      kind,
      description: description || (kind === "opening" ? "رصيد افتتاحي" : ""),
      amount: amt,
      department,
      installments: n > 1 && amt > 0 ? makeInstallments(amt, n, firstDue) : undefined,
    });
    if (ok) {
      toast.success("تم تسجيل المديونية.");
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-xl">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-2xl">مديونية على حساب</DialogTitle>
          <DialogDescription>رصيد قديم قبل بداية النظام، أو خدمة اتعملت للحساب من غير إيصال.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="الحساب">
            <Select value={acct} onValueChange={setAcct}>
              <SelectTrigger aria-label="الحساب"><SelectValue placeholder="اختر الحساب" /></SelectTrigger>
              <SelectContent dir="rtl">{db.creditAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="النوع">
            <Select value={kind} onValueChange={(v) => setKind(v as "opening" | "service")}>
              <SelectTrigger aria-label="نوع المديونية"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="opening">رصيد افتتاحي (قبل النظام)</SelectItem>
                <SelectItem value="service">خدمة / علاج بدون إيصال</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="التاريخ" htmlFor="ch-d"><Input id="ch-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FieldRow>
          <FieldRow label="المبلغ (ج.م)" htmlFor="ch-a"><Input id="ch-a" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></FieldRow>
          <FieldRow label="البيان" htmlFor="ch-desc" className="sm:col-span-2"><Input id="ch-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "opening" ? "رصيد افتتاحي" : "مثال: جلسات علاج طبيعي"} /></FieldRow>
          {kind === "service" && <FieldRow label="القسم (مركز الإيراد)"><DeptSelect value={department} onChange={setDepartment} /></FieldRow>}
          <FieldRow label="عدد الأقساط الشهرية" htmlFor="ch-n"><Input id="ch-n" type="number" min="1" max="60" value={count} onChange={(e) => setCount(e.target.value)} /></FieldRow>
          {n > 1 && <FieldRow label="ميعاد أول قسط" htmlFor="ch-f"><Input id="ch-f" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></FieldRow>}
        </div>
        {n > 1 && Number(amount) > 0 && (
          <p className="text-xs text-muted-foreground">
            {int(n)} أقساط × {money(makeInstallments(Number(amount), n, firstDue)[0]!.amount)} ج.م — آخر قسط {dateLabel(makeInstallments(Number(amount), n, firstDue).at(-1)!.due)}
          </p>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save}>تسجيل</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollectDialog({ summary, onClose }: { summary: AccountSummary; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState(String(summary.overdue > 0 ? summary.overdue : summary.nextDue?.remaining ?? summary.balance));
  const [boxId, setBoxId] = useState("main");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const save = () => {
    if (collectCredit({ accountId: summary.account.id, date, amount: Number(amount), boxId, method, note })) {
      toast.success(`تم تحصيل ${egp(Number(amount))} من ${summary.account.name}.`);
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-2xl">تحصيل من {summary.account.name}</DialogTitle>
          <DialogDescription>الرصيد المستحق {egp(summary.balance)}{summary.overdue > 0 ? ` — منها متأخرات ${egp(summary.overdue)}` : ""}. المبلغ بيسدد أقدم قسط الأول.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FieldRow label="التاريخ" htmlFor="co-d"><Input id="co-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FieldRow>
          <FieldRow label="المبلغ (ج.م)" htmlFor="co-a"><Input id="co-a" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></FieldRow>
          <BoxSelect value={boxId} onChange={setBoxId} label="الخزينة / البنك" />
          <MethodSelect value={method} onChange={setMethod} />
          <FieldRow label="ملاحظة" htmlFor="co-n"><Input id="co-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: قسط ديسمبر" /></FieldRow>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save}><HandCoins /> تسجيل التحصيل</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountSheet({
  summary,
  onClose,
  onCollect,
  onCharge,
  canEdit,
}: {
  summary: AccountSummary | null;
  onClose: () => void;
  onCollect: (s: AccountSummary) => void;
  onCharge: (id: string) => void;
  canEdit: boolean;
}) {
  const db = useHospitalDB();
  const today = isoDate(new Date());
  const pdf = usePdfExport();
  const a = summary?.account;
  const st = useMemo(() => (a ? creditStatement(db, a) : null), [db, a]);
  const sched = useMemo(() => (a ? dueSchedule(db, a, today) : []), [db, a, today]);
  const cols = useMemo(() => (a ? collectionsOf(db, a.id) : []), [db, a]);
  const charges = a ? db.creditCharges.filter((c) => c.accountId === a.id) : [];
  return (
    <Sheet open={!!summary} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-4xl">
        {summary && a && st && (
          <>
            <SheetHeader className="text-right">
              <SheetTitle className="font-display text-2xl">كشف حساب: {a.name}</SheetTitle>
              <SheetDescription>
                {a.kind === "company" ? "شركة متعاقدة" : "مريض"}
                {a.phone ? ` — ${a.phone}` : ""}
                {a.termsDays ? ` — مدة السداد ${int(a.termsDays)} يوم` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-8">
              <div className="flex flex-wrap gap-2">
                {canEdit && summary.balance > 0 && <Button onClick={() => onCollect(summary)}><HandCoins /> تحصيل</Button>}
                {canEdit && <Button variant="outline" onClick={() => onCharge(a.id)}><ReceiptText /> مديونية</Button>}
                <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`كشف-حساب-${a.name}.pdf`, "تم تنزيل كشف الحساب.")}><FileDown /> كشف حساب PDF</Button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {([
                  ["لم يستحق", summary.aging.current],
                  ["متأخر حتى ٣٠ يوم", summary.aging.d30],
                  ["٣١ – ٦٠ يوم", summary.aging.d60],
                  ["٦١ – ٩٠ يوم", summary.aging.d90],
                  ["أكثر من ٩٠ يوم", summary.aging.over90],
                ] as [string, number][]).map(([l, v], i) => (
                  <div key={l} className={cn("rounded-lg border p-3", i > 0 && v > 0 && "border-destructive/40 bg-destructive/5")}>
                    <p className="text-[11px] text-muted-foreground">{l}</p>
                    <p className={cn("num font-bold", i > 0 && v > 0 && "text-destructive")}>{money(v)}</p>
                  </div>
                ))}
              </div>

              <section>
                <h3 className="mb-2 font-bold">جدول الأقساط والاستحقاقات</h3>
                <TableCard minWidth={640}>
                  <thead><HeadRow><Th>الاستحقاق</Th><Th>المستند</Th><Th num>القسط</Th><Th num>المسدد</Th><Th num>الباقي</Th><Th>الحالة</Th></HeadRow></thead>
                  <tbody>
                    {sched.map((r, i) => (
                      <tr key={`${r.debtId}-${i}`} className="border-b last:border-0">
                        <Td num className="text-right">{dateLabel(r.due)}</Td>
                        <Td className="text-xs"><span dir="ltr" className="font-mono">{r.number}</span> <span className="text-muted-foreground">{r.description}</span></Td>
                        <Td num>{money(r.amount)}</Td>
                        <Td num className="text-income">{money(r.paid)}</Td>
                        <Td num className="font-semibold">{money(r.remaining)}</Td>
                        <Td className="text-xs">
                          {r.remaining <= 0 ? <span className="text-income">مسدد</span> : r.lateDays > 0 ? <span className="font-bold text-destructive">متأخر {int(r.lateDays)} يوم</span> : "لم يستحق"}
                        </Td>
                      </tr>
                    ))}
                    {!sched.length && <EmptyRow cols={6} text="لا توجد مديونيات." />}
                  </tbody>
                </TableCard>
              </section>

              <section>
                <h3 className="mb-2 font-bold">كشف الحساب</h3>
                <TableCard minWidth={640}>
                  <thead><HeadRow><Th>التاريخ</Th><Th>المستند</Th><Th>البيان</Th><Th num>مدين</Th><Th num>دائن</Th><Th num>الرصيد</Th><Th /></HeadRow></thead>
                  <tbody>
                    {st.rows.map((r) => {
                      const col = cols.find((c) => c.id === r.id);
                      const chg = charges.find((c) => `chg-${c.id}` === r.id);
                      return (
                        <tr key={r.id} className="border-b last:border-0">
                          <Td num className="text-right">{dateLabel(r.date)}</Td>
                          <Td className="font-mono text-xs"><span dir="ltr">{r.number}</span></Td>
                          <Td className="text-xs">{r.description}</Td>
                          <Td num>{r.debit ? money(r.debit) : ""}</Td>
                          <Td num className="text-income">{r.credit ? money(r.credit) : ""}</Td>
                          <Td num className="font-semibold">{money(r.balance)}</Td>
                          <Td>
                            {canEdit && (col || chg) && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                aria-label="حذف"
                                onClick={() => window.confirm("حذف الحركة؟") && (col ? deleteCreditCollection(col.id) : deleteCreditCharge(chg!.id))}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                    {!st.rows.length && <EmptyRow cols={7} text="لا توجد حركات." />}
                  </tbody>
                </TableCard>
              </section>
            </div>

            <OfficialDocument ref={pdf.ref} settings={db.settings} title={`كشف حساب: ${a.name}`} subtitle={a.kind === "company" ? "شركة متعاقدة" : "مريض — تقسيط"} issuedOn={dateLabel(today)}>
              <table className="doc-table">
                <thead><tr data-pdf-break><th>التاريخ</th><th>المستند</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {st.rows.map((r) => (
                    <tr key={r.id} data-pdf-break><td>{dateLabel(r.date)}</td><td>{r.number}</td><td className="text-start">{r.description}</td><td>{r.debit ? money(r.debit) : ""}</td><td>{r.credit ? money(r.credit) : ""}</td><td>{money(r.balance)}</td></tr>
                  ))}
                  <tr className="doc-total" data-pdf-break><td colSpan={5} className="text-start">الرصيد المستحق</td><td>{money(st.closing)}</td></tr>
                </tbody>
              </table>
              {summary.overdue > 0 && <p data-pdf-break style={{ fontSize: 12, marginTop: 8 }}>منها متأخرات فات ميعادها: {money(summary.overdue)} ج.م</p>}
              <SignatureBlock roles={["المحاسب", "المدير المالي"]} />
            </OfficialDocument>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
