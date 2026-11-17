import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileDown, History, MessageSquareWarning, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeptBadge, KindBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  EmptyRow,
  FilterBar,
  HeadRow,
  matches,
  MonthYearPicker,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { findDepartment } from "@/lib/hospital/constants";
import { pendingRequests } from "@/lib/hospital/approvals";
import { dateLabel, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  can,
  clearReview,
  decideInvoiceChange,
  decidePatientDelete,
  decidePaymentOrder,
  decidePettyRequest,
  decideIssueOrder,
  listLabel,
  decidePurchaseOrder,
  findBox,
  ROLE_LABELS,
  reviewTransaction,
  SECTIONS,
  TX_SOURCE_LABELS,
  useHospitalDB,
  useCanApprove,
  useHospitalSession,
  type HospitalDB,
  type Transaction,
} from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "المراجعة الداخلية والاعتمادات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "مراجعة كل حركة مالية واعتمادها أو تسجيل ملاحظة، اعتماد أوامر الصرف والطلبيات، وسجل كامل لكل عملية على النظام.",
      },
      { property: "og:title", content: "المراجعة والاعتمادات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "رقابة داخلية: مراجعة الحركات، الاعتمادات، وسجل العمليات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { me } = useHospitalSession();
  const db = useHospitalDB();
  if (!me) return null;
  const seeReview = can(me, "review", "view");
  const seeApprovals = can(me, "approvals", "view");
  const pending = pendingRequests(db).length;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المراجعة والرقابة"
        title="المراجعة الداخلية والاعتمادات"
        description="المراجع يعتمد كل حركة مالية أو يسجل ملاحظة عليها، والمختص يعتمد أوامر الصرف والطلبيات، وكل عملية على النظام مسجلة باسم من قام بها ووقتها."
      />
      <Tabs defaultValue={seeReview ? "tx" : "approvals"} dir="rtl">
        <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted p-1">
          {seeReview && (
            <TabsTrigger value="tx" className="flex-none gap-1.5">
              <ScanSearch className="size-4" /> مراجعة الحركات المالية
            </TabsTrigger>
          )}
          {seeApprovals && (
            <TabsTrigger value="approvals" className="flex-none gap-1.5">
              <ClipboardCheck className="size-4" /> الاعتمادات المعلقة
              {pending > 0 && <span className="num rounded-full bg-copper px-1.5 text-[10px] text-copper-foreground">{pending}</span>}
            </TabsTrigger>
          )}
          {seeReview && (
            <TabsTrigger value="log" className="flex-none gap-1.5">
              <History className="size-4" /> سجل العمليات
            </TabsTrigger>
          )}
        </TabsList>
        {seeReview && (
          <TabsContent value="tx">
            <TxReview canEdit={can(me, "review", "edit")} />
          </TabsContent>
        )}
        {seeApprovals && (
          <TabsContent value="approvals">
            <Approvals />
          </TabsContent>
        )}
        {seeReview && (
          <TabsContent value="log">
            <AuditLog />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type ReviewState = "pending" | "approved" | "flagged" | "changed";
const STATE_LABELS: Record<ReviewState, string> = {
  pending: "لم تُراجع",
  approved: "معتمدة",
  flagged: "عليها ملاحظات",
  changed: "تغيّرت بعد المراجعة",
};
function reviewState(db: Pick<HospitalDB, "reviews">, t: Transaction): ReviewState {
  const r = db.reviews[t.id];
  if (!r) return "pending";
  if (Math.abs(r.amount - t.amount) > 0.001) return "changed";
  return r.status;
}

function TxReview({ canEdit }: { canEdit: boolean }) {
  const db = useHospitalDB();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [state, setState] = useState<"all" | ReviewState>("pending");
  const [query, setQuery] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const pdf = usePdfExport();

  const inPeriod = useMemo(
    () => db.transactions.filter((t) => period === "all" || t.date.startsWith(period)),
    [db.transactions, period],
  );
  const counts = useMemo(() => {
    const c: Record<ReviewState, number> = { pending: 0, approved: 0, flagged: 0, changed: 0 };
    for (const t of inPeriod) c[reviewState(db, t)]++;
    return c;
  }, [inPeriod, db]);
  const rows = useMemo(
    () =>
      inPeriod
        .filter((t) => (state === "all" || reviewState(db, t) === state) && matches(query, t.description, t.receiptId, t.by))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [inPeriod, state, query, db],
  );
  const flagged = inPeriod.filter((t) => ["flagged", "changed"].includes(reviewState(db, t)));

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="لم تُراجع" value={int(counts.pending)} icon={ScanSearch} tone="copper" />
        <StatCard label="معتمدة" value={int(counts.approved)} icon={CheckCircle2} tone="income" />
        <StatCard label="عليها ملاحظات" value={int(counts.flagged)} icon={MessageSquareWarning} tone="expense" />
        <StatCard label="تغيّرت بعد المراجعة" value={int(counts.changed)} icon={AlertTriangle} tone="expense" />
      </div>
      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
          <SelectTrigger className="bg-card md:w-52" aria-label="حالة المراجعة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الحالات</SelectItem>
            {(Object.keys(STATE_LABELS) as ReviewState[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="البيان، رقم الإيصال أو الموظف" className="md:flex-1" />
        <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`تقرير-ملاحظات-المراجعة-${period}.pdf`, "تم تصدير تقرير الملاحظات.")}>
          <FileDown /> تقرير الملاحظات
        </Button>
      </FilterBar>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>رقم الإيصال</Th>
            <Th>النوع</Th>
            <Th>البيان</Th>
            <Th>الخزينة / بواسطة</Th>
            <Th num>المبلغ</Th>
            <Th>المراجعة</Th>
            <Th className="w-48" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((t) => {
            const st = reviewState(db, t);
            const r = db.reviews[t.id];
            return (
              <tr key={t.id} className="border-b align-top last:border-0 hover:bg-muted/50">
                <Td num className="text-right">
                  {dateLabel(t.date)}
                </Td>
                <Td className="font-mono text-xs">
                  <span dir="ltr">{t.receiptId}</span>
                </Td>
                <Td>
                  <KindBadge kind={t.kind} />
                </Td>
                <Td>
                  <p>{t.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <DeptBadge id={t.department} />
                    <span className="text-[10px] text-muted-foreground">{TX_SOURCE_LABELS[t.source]}</span>
                  </div>
                </Td>
                <Td className="text-xs">
                  <p>{findBox(db, t.boxId).name}</p>
                  {t.by && <p className="text-muted-foreground">{t.by}</p>}
                </Td>
                <Td num className="font-semibold">
                  {money(t.amount)}
                </Td>
                <Td>
                  <StatusBadge
                    status={st === "approved" ? "paid" : st === "pending" ? "pending" : "rejected"}
                    label={STATE_LABELS[st]}
                  />
                  {r && (
                    <p className="mt-1 max-w-48 text-[10px] text-muted-foreground">
                      {r.by}
                      {r.note ? ` — ${r.note}` : ""}
                      {st === "changed" ? ` (كان ${money(r.amount)})` : ""}
                    </p>
                  )}
                </Td>
                <Td>
                  {canEdit &&
                    (noteFor === t.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (reviewTransaction(t.id, "flagged", note)) {
                            toast.success("تم تسجيل الملاحظة.");
                            setNoteFor(null);
                          }
                        }}
                      >
                        <Input autoFocus className="h-8 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="الملاحظة" aria-label="الملاحظة" />
                        <Button size="sm" type="submit" variant="destructive">
                          حفظ
                        </Button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1">
                        {st !== "approved" && (
                          <Button size="sm" variant="secondary" onClick={() => reviewTransaction(t.id, "approved")}>
                            <CheckCircle2 /> اعتماد
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-expense"
                          onClick={() => {
                            setNote(r?.note ?? "");
                            setNoteFor(t.id);
                          }}
                        >
                          <MessageSquareWarning /> ملاحظة
                        </Button>
                        {r && (
                          <Button size="icon" variant="ghost" aria-label="إلغاء المراجعة" title="إلغاء المراجعة" onClick={() => clearReview(t.id)}>
                            <RotateCcw />
                          </Button>
                        )}
                      </div>
                    ))}
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={8} text="لا توجد حركات بهذه الحالة في الفترة." />}
        </tbody>
      </TableCard>

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="تقرير ملاحظات المراجعة الداخلية"
        subtitle={period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`}
        issuedOn={dateLabel(isoDate(new Date()))}
        orientation="landscape"
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>رقم الإيصال</th>
              <th>البيان</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>الملاحظة</th>
              <th>المراجع</th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((t) => (
              <tr key={t.id} data-pdf-break>
                <td>{dateLabel(t.date)}</td>
                <td dir="ltr">{t.receiptId}</td>
                <td className="text-start">{t.description}</td>
                <td>{money(t.amount)}</td>
                <td>{STATE_LABELS[reviewState(db, t)]}</td>
                <td className="text-start">{db.reviews[t.id]?.note ?? ""}</td>
                <td>{db.reviews[t.id]?.by ?? ""}</td>
              </tr>
            ))}
            {!flagged.length && (
              <tr data-pdf-break>
                <td colSpan={7}>لا توجد ملاحظات في هذه الفترة.</td>
              </tr>
            )}
          </tbody>
        </table>
        <SignatureBlock roles={["المراجع الداخلي", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function Approvals() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const approver = useCanApprove();
  const pay = db.paymentOrders.filter((o) => o.status === "pending");
  const petty = db.pettyRequests.filter((r) => r.status === "pending");
  const pos = db.purchaseOrders.filter((o) => o.status === "pending");
  const iss = db.issueOrders.filter((o) => o.status === "pending");
  const reqs = db.editRequests.filter((r) => r.status === "pending");
  const delPatients = db.patientDeleteRequests.filter((r) => r.status === "pending");
  const inv = (id: string) => db.patientInvoices.find((i) => i.id === id);
  const item = (id: string) => db.stockItems.find((i) => i.id === id);
  const empty = !pay.length && !petty.length && !pos.length && !iss.length && !reqs.length && !delPatients.length;
  return (
    <div className="grid gap-6">
      <p className="rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        {me?.role === "finance"
          ? "أنت المدير المالي: تعتمد أو ترفض كل الطلبات هنا، عدا الطلبات التي قدّمتها بنفسك."
          : me?.role === "admin"
            ? "الاعتماد للمدير المالي. يمكنك كمدير مستشفى اعتماد الطلبات التي قدّمها المدير المالي نفسه فقط."
            : "الاعتماد للمدير المالي فقط — تظهر لك الطلبات للمتابعة."}
      </p>
      {empty && (
        <div className="ledger-card p-10 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 size-8 text-income" />
          لا توجد طلبات بانتظار الاعتماد.
        </div>
      )}
      {pay.length > 0 && (
        <ApprovalCard title="أوامر صرف نقدية" link="/orders">
          {pay.map((o) => (
            <ApprovalRow
              key={o.id}
              number={o.number}
              title={`${o.beneficiary} — ${o.description}`}
              meta={`طلبه ${o.requestedBy} • ${dateLabel(o.date)}`}
              amount={o.amount}
              canEdit={approver(o)}
              onApprove={() => decidePaymentOrder(o.id, true)}
              onReject={() => {
                const note = window.prompt("سبب الرفض:");
                if (note !== null) decidePaymentOrder(o.id, false, note);
              }}
            />
          ))}
        </ApprovalCard>
      )}
      {petty.length > 0 && (
        <ApprovalCard title="طلبات صرف نثريات" link="/petty-cash">
          {petty.map((r) => (
            <ApprovalRow
              key={r.id}
              number={r.number}
              title={`${r.description}${r.paidTo ? ` — المستلم: ${r.paidTo}` : ""}`}
              meta={`${listLabel(db.lists.pettyCategories, r.category)} • ${findDepartment(db.departments, r.department).name} • طلبه ${r.requestedBy} • ${dateLabel(r.date)}`}
              amount={r.amount}
              canEdit={approver(r)}
              onApprove={() => decidePettyRequest(r.id, true)}
              onReject={() => {
                const note = window.prompt("سبب الرفض:");
                if (note !== null) decidePettyRequest(r.id, false, note);
              }}
            />
          ))}
        </ApprovalCard>
      )}
      {pos.length > 0 && (
        <ApprovalCard title="طلبيات شراء" link="/orders">
          {pos.map((o) => (
            <ApprovalRow
              key={o.id}
              number={o.number}
              title={`${o.supplierName} — ${o.lines.map((l) => `${l.description} (${l.qty})`).join("، ")}`}
              meta={`طلبها ${o.requestedBy} • ${dateLabel(o.date)}`}
              amount={o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)}
              canEdit={approver(o)}
              onApprove={() => decidePurchaseOrder(o.id, true)}
              onReject={() => window.confirm("رفض الطلبية؟") && decidePurchaseOrder(o.id, false)}
            />
          ))}
        </ApprovalCard>
      )}
      {iss.length > 0 && (
        <ApprovalCard title="طلبات الأقسام من المخزن" link="/orders">
          {iss.map((o) => (
            <ApprovalRow
              key={o.id}
              number={o.number}
              title={`${findDepartment(db.departments, o.department).name} — ${o.lines.map((l) => `${item(l.stockItemId)?.name ?? "صنف"} (${l.qty})`).join("، ")}`}
              meta={`طلبه ${o.by} • المستلم ${o.receiver} • ${dateLabel(o.date)}`}
              canEdit={approver(o)}
              onApprove={() => decideIssueOrder(o.id, true)}
              onReject={() => {
                const note = window.prompt("سبب الرفض:");
                if (note !== null) decideIssueOrder(o.id, false, note);
              }}
            />
          ))}
        </ApprovalCard>
      )}
      {reqs.length > 0 && (
        <ApprovalCard title="طلبات تعديل / حذف إيصالات مرضى" link="/billing">
          {reqs.map((r) => {
            const i = inv(r.invoiceId);
            return (
              <ApprovalRow
                key={r.id}
                number={i?.number ?? "—"}
                title={`${r.action === "delete" ? "حذف" : "تعديل"} إيصال ${i?.patientName ?? ""} — السبب: ${r.reason}`}
                meta={`طلبه ${r.requestedBy}`}
                canEdit={approver(r)}
                onApprove={() => decideInvoiceChange(r.id, true)}
                onReject={() => decideInvoiceChange(r.id, false)}
              />
            );
          })}
        </ApprovalCard>
      )}
      {delPatients.length > 0 && (
        <ApprovalCard title="طلبات حذف ملفات مرضى" link="/patients">
          {delPatients.map((r) => (
            <ApprovalRow
              key={r.id}
              number={r.patientMrn}
              title={`حذف ملف المريض ${r.patientName} — السبب: ${r.reason}`}
              meta={`طلبه ${r.requestedBy} • الموافقة تحذف الملف الطبي ومرفقاته نهائيًا، وتبقى إيصالاته المالية في السجلات`}
              canEdit={approver(r)}
              onApprove={() => {
                if (!window.confirm(`اعتماد حذف ملف ${r.patientName} نهائيًا؟`)) return;
                void decidePatientDelete(r.id, true).then((ok) => ok && toast.success("تم اعتماد الحذف وحُذف ملف المريض."));
              }}
              onReject={() => void decidePatientDelete(r.id, false)}
            />
          ))}
        </ApprovalCard>
      )}
    </div>
  );
}

function ApprovalCard({ title, link, children }: { title: string; link: "/orders" | "/billing" | "/petty-cash" | "/patients"; children: React.ReactNode }) {
  return (
    <section className="ledger-card overflow-hidden">
      <div className="flex items-center justify-between border-b bg-secondary/60 px-4 py-3">
        <h2 className="font-bold">{title}</h2>
        <Link to={link} className="text-xs text-primary hover:underline">
          فتح الصفحة
        </Link>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function ApprovalRow(p: {
  number: string;
  title: string;
  meta: string;
  amount?: number;
  canEdit: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 border-b px-4 py-3 last:border-0 md:flex-row md:items-center">
      <span className="font-mono text-xs" dir="ltr">
        {p.number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{p.title}</p>
        <p className="text-[11px] text-muted-foreground">{p.meta}</p>
      </div>
      {p.amount !== undefined && <span className="num font-semibold">{money(p.amount)} ج.م</span>}
      {p.canEdit && (
        <div className="flex gap-1">
          <Button size="sm" onClick={p.onApprove}>
            <CheckCircle2 /> اعتماد
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={p.onReject}>
            رفض
          </Button>
        </div>
      )}
    </li>
  );
}

const SECTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(SECTIONS.map((s) => [s.key, s.label])),
  system: "إدارة النظام",
};
const timeFmt = new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "short" });

function AuditLog() {
  const db = useHospitalDB();
  const [user, setUser] = useState("all");
  const [section, setSection] = useState("all");
  const [day, setDay] = useState("");
  const [query, setQuery] = useState("");
  const users = useMemo(() => [...new Map(db.auditLog.map((e) => [e.byId, e.by])).entries()], [db.auditLog]);
  const rows = useMemo(
    () =>
      db.auditLog
        .filter(
          (e) =>
            (user === "all" || e.byId === user) &&
            (section === "all" || e.section === section) &&
            (!day || isoDate(new Date(e.at)) === day) &&
            matches(query, e.summary, e.by),
        )
        .slice()
        .reverse()
        .slice(0, 500),
    [db.auditLog, user, section, day, query],
  );
  return (
    <div>
      <FilterBar>
        <Select value={user} onValueChange={setUser}>
          <SelectTrigger className="bg-card md:w-48" aria-label="المستخدم">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل المستخدمين</SelectItem>
            {users.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger className="bg-card md:w-56" aria-label="القسم">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الأقسام</SelectItem>
            {Object.entries(SECTION_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="bg-card md:w-44" aria-label="اليوم" />
        <SearchBox value={query} onChange={setQuery} placeholder="ابحث في العمليات" className="md:flex-1" />
      </FilterBar>
      <TableCard minWidth={860}>
        <thead>
          <HeadRow>
            <Th>الوقت</Th>
            <Th>المستخدم</Th>
            <Th>القسم</Th>
            <Th>العملية</Th>
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right text-xs whitespace-nowrap">
                {timeFmt.format(new Date(e.at))}
              </Td>
              <Td>
                <p className="font-medium">{e.by}</p>
                <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[e.role]}</p>
              </Td>
              <Td className="text-xs">{SECTION_LABEL[e.section] ?? e.section}</Td>
              <Td className="text-sm">{e.summary}</Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={4} text="لا توجد عمليات مسجلة بهذه الفلاتر." />}
        </tbody>
      </TableCard>
      <p className="mt-2 text-[11px] text-muted-foreground">يعرض آخر ٥٠٠ عملية مطابقة — يحتفظ النظام بآخر ٣٬٠٠٠ عملية.</p>
    </div>
  );
}
