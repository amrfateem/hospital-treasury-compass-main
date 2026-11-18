import { Check, Info, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyRow,
  FilterBar,
  HeadRow,
  SearchBox,
  TableCard,
  Td,
  Th,
  matches,
} from "@/components/hospital/kit";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { findDepartment, GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import { expenseDetails, pettyDetails, revenueDetails, totalsOf } from "@/lib/hospital/cash-details";
import { dateLabel, money } from "@/lib/hospital/format";
import {
  findBox,
  listLabel,
  MAIN_BOX_ID,
  TX_SOURCE_LABELS,
  useHospitalDB,
  useHospitalSession,
} from "@/lib/hospital/store";
import { canApprove, isDeskRole } from "@/lib/hospital/permissions";
import { decideInvoiceChange, decidePaymentOrder, decidePettyRequest } from "@/lib/hospital/store";
import type { EditRequest, PaymentOrder, PettyRequest } from "@/lib/hospital/model";
import { cn } from "@/lib/utils";

type Tab = "revenue" | "expenses" | "petty";

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  paid: "مصروف",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

export function CashDetails({
  tab,
  from,
  to,
  ledgerTotal,
}: {
  tab: Tab;
  from: string;
  to: string;
  ledgerTotal: number;
}) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [box, setBox] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<null | { kind: Tab; id: string }>(null);

  const boxName = (id?: string) => findBox(db, id || MAIN_BOX_ID).name;
  const deptName = (id: string) => findDepartment(db.departments, id).name;
  const deptOf = (id: string) => (id === GENERAL_DEPT_ID ? "الإدارة العامة" : deptName(id));

  const revenue = useMemo(() => revenueDetails(db, from, to), [db, from, to]);
  const expenses = useMemo(() => expenseDetails(db, from, to), [db, from, to]);
  const petty = useMemo(() => pettyDetails(db, from, to), [db, from, to]);

  const pendingChanges = useMemo(
    () => db.editRequests.filter((r) => r.status === "pending" && r.snapshot?.date && r.snapshot.date >= from && r.snapshot.date <= to),
    [db.editRequests, from, to],
  );
  const pendingOrders = useMemo(
    () => db.paymentOrders.filter((r) => r.status === "pending" && r.date >= from && r.date <= to),
    [db.paymentOrders, from, to],
  );
  const pendingPetty = useMemo(
    () => db.pettyRequests.filter((r) => r.status === "pending" && r.date >= from && r.date <= to),
    [db.pettyRequests, from, to],
  );

  const myShifts = useMemo(
    () => (me && isDeskRole(me.role) ? new Set(db.shifts.filter((s) => s.openedById === me.id).map((s) => s.id)) : null),
    [db.shifts, me],
  );

  const visibleRevenue = useMemo(() => {
    const rows = myShifts ? revenue.filter((r) => !!r.invoice.shiftId && myShifts.has(r.invoice.shiftId)) : revenue;
    return rows.filter(
      (r) =>
        (dept === "all" || r.invoice.department === dept) &&
        (box === "all" || (r.invoice.boxId || MAIN_BOX_ID) === box) &&
        (status === "all" ||
          (status === "printed" ? !!r.invoice.printedAt : status === "unprinted" ? !r.invoice.printedAt : status === "credit" ? r.amounts.credit > 0 : true)) &&
        matches(query, r.invoice.number, r.invoice.patientName, r.invoice.patientMrn, r.invoice.notes),
    );
  }, [revenue, myShifts, dept, box, status, query]);

  const visibleExpenses = useMemo(
    () =>
      expenses.filter(
        (t) =>
          (dept === "all" || t.department === dept) &&
          (box === "all" || (t.boxId || MAIN_BOX_ID) === box) &&
          (status === "all" || t.source === status) &&
          matches(query, t.description, t.receiptId, t.paidTo, t.by, t.category && listLabel(db.lists.expenseCategories, t.category)),
      ),
    [expenses, dept, box, status, query, db.lists.expenseCategories],
  );

  const visiblePetty = useMemo(
    () =>
      petty.filter(
        (p) =>
          (dept === "all" || p.request.department === dept) &&
          (box === "all" || (p.request.boxId || MAIN_BOX_ID) === box) &&
          (status === "all" || p.request.status === status) &&
          matches(
            query,
            p.request.number,
            p.request.description,
            p.request.paidTo,
            p.request.requestedBy,
            p.request.category && listLabel(db.lists.pettyCategories, p.request.category),
          ),
      ),
    [petty, dept, box, status, query, db.lists.pettyCategories],
  );

  const total =
    tab === "revenue"
      ? visibleRevenue.reduce((s, r) => s + r.amounts.total, 0)
      : tab === "expenses"
        ? totalsOf(visibleExpenses)
        : totalsOf(visiblePetty.map((p) => p.request));

  const approvalCount =
    tab === "revenue" ? pendingChanges.length : tab === "expenses" ? pendingOrders.length : pendingPetty.length;

  function decide(kind: Tab, id: string, approve: boolean) {
    const ok =
      kind === "revenue"
        ? decideInvoiceChange(id, approve)
        : kind === "expenses"
          ? decidePaymentOrder(id, approve)
          : decidePettyRequest(id, approve);
    if (ok) toast.success(approve ? "تم الاعتماد." : "تم الرفض.");
  }

  function approveBox() {
    if (!me) return null;
    const rows: { id: string; title: string; sub: string; amount: number; req: EditRequest | PaymentOrder | PettyRequest }[] =
      tab === "revenue"
        ? pendingChanges.map((r) => ({
            id: r.id,
            title: `${r.action === "delete" ? "طلب إلغاء" : "طلب تعديل"} إيصال ${r.snapshot?.number ?? ""}`,
            sub: `${r.requestedBy} — ${r.reason}`,
            amount: r.snapshot?.total ?? 0,
            req: r,
          }))
        : tab === "expenses"
          ? pendingOrders.map((r) => ({
              id: r.id,
              title: `أمر صرف ${r.number}`,
              sub: `${r.requestedBy} — ${r.description}`,
              amount: r.amount,
              req: r,
            }))
          : pendingPetty.map((r) => ({
              id: r.id,
              title: `طلب نثرية ${r.number}`,
              sub: `${r.requestedBy} — ${r.description}`,
              amount: r.amount,
              req: r,
            }));
    if (!rows.length) return null;
    return (
      <section className="mb-5 overflow-hidden rounded-xl border border-copper/40 bg-copper/5">
        <div className="flex items-center gap-2 border-b border-copper/30 px-4 py-2.5 text-sm font-bold">
          <Info className="size-4 text-copper" />
          بانتظار اعتمادك ({rows.length})
        </div>
        <ul className="divide-y divide-copper/20">
          {rows.map((row) => {
            const allowed = canApprove(me!, row.req);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{row.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.sub}</p>
                </div>
                <span className="num font-semibold">{money(row.amount)}</span>
                {allowed ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => decide(tab, row.id, true)}>
                      <Check /> اعتماد
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(tab, row.id, false)}>
                      <X /> رفض
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">بانتظار المعتمد المختص</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <>
      {approveBox()}

      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={tab === "revenue" ? "رقم الإيصال أو المريض" : "البيان أو الرقم أو المستلم"}
          className="md:flex-1"
        />
        <select
          aria-label="القسم"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
        >
          <option value="all">كل الأقسام</option>
          {db.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="الخزينة"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={box}
          onChange={(e) => setBox(e.target.value)}
        >
          <option value="all">كل الخزائن</option>
          {db.cashboxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {tab === "revenue" ? (
          <select aria-label="الحالة" className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">كل الحالات</option>
            <option value="printed">مطبوع</option>
            <option value="unprinted">غير مطبوع</option>
            <option value="credit">عليه متبقي</option>
          </select>
        ) : tab === "petty" ? (
          <select aria-label="الحالة" className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">كل الحالات</option>
            {Object.entries(STATUS_AR).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <select aria-label="المصدر" className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">كل المصادر</option>
            {Object.entries(TX_SOURCE_LABELS)
              .filter(([k]) => k !== "petty")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        )}
      </FilterBar>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
        <span>
          إجمالي التفاصيل: <b className="num">{money(total)}</b>
        </span>
        <span className="text-muted-foreground">
          إجمالي القيود لنفس الفترة: <b className="num">{money(ledgerTotal)}</b>
        </span>
        {approvalCount > 0 && <span className="font-semibold text-copper">{approvalCount} بانتظار الاعتماد</span>}
      </div>

      {tab === "revenue" ? (
        <TableCard minWidth={980}>
          <thead>
            <HeadRow>
              <Th>التاريخ</Th>
              <Th>الإيصال</Th>
              <Th>المريض</Th>
              <Th>القسم</Th>
              <Th>الخدمات</Th>
              <Th num>الإجمالي</Th>
              <Th num>المدفوع</Th>
              <Th num>المتبقي</Th>
              <Th>الطريقة / الخزينة</Th>
              <Th>الحالة</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {visibleRevenue.map(({ invoice, amounts }) => {
              const last = invoice.items[invoice.items.length - 1];
              const services =
                invoice.items.length > 1
                  ? `${invoice.items[0]?.description ?? ""} +${invoice.items.length - 1}`
                  : (last?.description ?? "—");
              const rest = amounts.credit + (!invoice.insurerPaid && invoice.payer ? amounts.insurerShare : 0);
              return (
                <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/50">
                  <Td num>{dateLabel(invoice.date)}</Td>
                  <Td className="font-mono text-xs">
                    <span dir="ltr">{invoice.number}</span>
                  </Td>
                  <Td className="font-medium">{invoice.patientName}</Td>
                  <Td className="text-xs">{deptOf(invoice.department)}</Td>
                  <Td className="max-w-52 truncate text-xs">{services}</Td>
                  <Td num className="font-semibold text-income">
                    {money(amounts.total)}
                  </Td>
                  <Td num>{money(amounts.paidNow)}</Td>
                  <Td num className={cn(rest > 0 && "text-copper")}>
                    {money(rest)}
                  </Td>
                  <Td className="text-xs">
                    {listLabel(db.lists.paymentMethods, invoice.paymentMethod)} • {boxName(invoice.boxId)}
                  </Td>
                  <Td className="text-xs">
                    {invoice.unlocked ? "مفتوح للتعديل" : invoice.printedAt ? "مطبوع" : "غير مطبوع"}
                    {pendingChanges.some((r) => r.invoiceId === invoice.id) && (
                      <span className="ms-1 text-copper">• طلب معلق</span>
                    )}
                  </Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => setSelected({ kind: "revenue", id: invoice.id })}>
                      تفاصيل
                    </Button>
                  </Td>
                </tr>
              );
            })}
            {!visibleRevenue.length && <EmptyRow cols={11} text="مفيش إيصالات في الفترة دي." />}
          </tbody>
        </TableCard>
      ) : tab === "expenses" ? (
        <TableCard minWidth={1040}>
          <thead>
            <HeadRow>
              <Th>التاريخ</Th>
              <Th>المستند</Th>
              <Th>البيان</Th>
              <Th>البند</Th>
              <Th>القسم</Th>
              <Th>المستلم</Th>
              <Th>الخزينة / الطريقة</Th>
              <Th>المصدر</Th>
              <Th num>المبلغ</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {visibleExpenses.map((t) => (
              <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td num>{dateLabel(t.date)}</Td>
                <Td className="font-mono text-xs">
                  <span dir="ltr">{t.receiptId}</span>
                </Td>
                <Td className="max-w-64 truncate">{t.description}</Td>
                <Td className="text-xs">{t.category ? listLabel(db.lists.expenseCategories, t.category) : "—"}</Td>
                <Td className="text-xs">{deptOf(t.department)}</Td>
                <Td className="text-xs">{t.paidTo || "—"}</Td>
                <Td className="text-xs">
                  {boxName(t.boxId)} • {listLabel(db.lists.paymentMethods, t.method || "cash")}
                </Td>
                <Td className="text-[11px] text-muted-foreground">{TX_SOURCE_LABELS[t.source]}</Td>
                <Td num className="font-semibold text-expense">
                  {money(t.amount)}
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => setSelected({ kind: "expenses", id: t.id })}>
                    تفاصيل
                  </Button>
                </Td>
              </tr>
            ))}
            {!visibleExpenses.length && <EmptyRow cols={10} text="مفيش مصروفات في الفترة دي." />}
          </tbody>
        </TableCard>
      ) : (
        <TableCard minWidth={980}>
          <thead>
            <HeadRow>
              <Th>التاريخ</Th>
              <Th>الطلب</Th>
              <Th>البيان</Th>
              <Th>البند / القسم</Th>
              <Th>المستلم</Th>
              <Th>الخزينة</Th>
              <Th>الحالة</Th>
              <Th num>المبلغ</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {visiblePetty.map(({ request, spend }) => (
              <tr key={request.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td num>{dateLabel(request.date)}</Td>
                <Td className="font-mono text-xs">
                  <span dir="ltr">{request.number}</span>
                </Td>
                <Td className="max-w-64 truncate">{request.description}</Td>
                <Td className="text-xs">
                  {request.category ? listLabel(db.lists.pettyCategories, request.category) : "—"} • {deptOf(request.department)}
                </Td>
                <Td className="text-xs">{request.paidTo || "—"}</Td>
                <Td className="text-xs">{boxName(request.boxId)}</Td>
                <Td>
                  <StatusBadge
                    status={request.status === "approved" ? "approved" : request.status}
                    label={STATUS_AR[request.status] ?? request.status}
                  />
                </Td>
                <Td num className="font-semibold text-expense">
                  {money(request.amount)}
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => setSelected({ kind: "petty", id: request.id })}>
                    تفاصيل
                  </Button>
                </Td>
              </tr>
            ))}
            {!visiblePetty.length && <EmptyRow cols={9} text="مفيش نثريات في الفترة دي." />}
          </tbody>
        </TableCard>
      )}

      <DetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
        revenue={revenue}
        expenses={expenses}
        petty={petty}
        locks={{
          boxName,
          deptName: deptOf,
          method: (id?: string) => listLabel(db.lists.paymentMethods, id || "cash"),
          expenseCat: (id?: string) => (id ? listLabel(db.lists.expenseCategories, id) : "—"),
          pettyCat: (id?: string) => (id ? listLabel(db.lists.pettyCategories, id) : "—"),
        }}
      />
    </>
  );
}

function DetailDialog({
  selected,
  onClose,
  revenue,
  expenses,
  petty,
  locks,
}: {
  selected: null | { kind: Tab; id: string };
  onClose: () => void;
  revenue: ReturnType<typeof revenueDetails>;
  expenses: ReturnType<typeof expenseDetails>;
  petty: ReturnType<typeof pettyDetails>;
  locks: {
    boxName: (id?: string) => string;
    deptName: (id: string) => string;
    method: (id?: string) => string;
    expenseCat: (id?: string) => string;
    pettyCat: (id?: string) => string;
  };
}) {
  const invoice = selected?.kind === "revenue" ? revenue.find((r) => r.invoice.id === selected.id) : undefined;
  const expense = selected?.kind === "expenses" ? expenses.find((r) => r.id === selected.id) : undefined;
  const pettyRow = selected?.kind === "petty" ? petty.find((r) => r.request.id === selected.id) : undefined;

  return (
    <Dialog open={!!selected} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {invoice && (
          <>
            <DialogHeader className="text-right sm:text-right">
              <DialogTitle className="font-display text-2xl">إيصال {invoice.invoice.number}</DialogTitle>
              <DialogDescription>
                {invoice.invoice.patientName} — {locks.deptName(invoice.invoice.department)} — {dateLabel(invoice.invoice.date)}
              </DialogDescription>
            </DialogHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-start">الخدمة</th>
                  <th className="py-2">الكمية</th>
                  <th className="py-2 text-end">القيمة</th>
                </tr>
              </thead>
              <tbody>
                {invoice.invoice.items.map((it, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">{it.description}</td>
                    <td className="py-2 text-center">{it.qty}</td>
                    <td className="py-2 text-end">{money(it.qty * it.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">الإجمالي</dt>
                <dd className="num font-bold">{money(invoice.amounts.total)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">المدفوع</dt>
                <dd className="num font-bold">{money(invoice.amounts.paidNow)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">خصم</dt>
                <dd className="num">{money(invoice.amounts.discount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تأمين / آجل</dt>
                <dd className="num">
                  {money(invoice.amounts.insurerShare)} / {money(invoice.amounts.credit)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الطريقة</dt>
                <dd>{locks.method(invoice.invoice.paymentMethod)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الخزينة</dt>
                <dd>{locks.boxName(invoice.invoice.boxId)}</dd>
              </div>
            </dl>
          </>
        )}
        {expense && (
          <>
            <DialogHeader className="text-right sm:text-right">
              <DialogTitle className="font-display text-2xl">مستند {expense.receiptId}</DialogTitle>
              <DialogDescription>
                {expense.description} — {dateLabel(expense.date)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">المبلغ</dt>
                <dd className="num font-bold text-expense">{money(expense.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">البند</dt>
                <dd>{locks.expenseCat(expense.category)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">القسم</dt>
                <dd>{locks.deptName(expense.department)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">المستلم</dt>
                <dd>{expense.paidTo || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الخزينة</dt>
                <dd>{locks.boxName(expense.boxId)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">طريقة الدفع</dt>
                <dd>{locks.method(expense.method)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">المصدر</dt>
                <dd>{TX_SOURCE_LABELS[expense.source]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">سجّله</dt>
                <dd>{expense.by || "—"}</dd>
              </div>
            </dl>
          </>
        )}
        {pettyRow && (
          <>
            <DialogHeader className="text-right sm:text-right">
              <DialogTitle className="font-display text-2xl">طلب نثرية {pettyRow.request.number}</DialogTitle>
              <DialogDescription>
                {pettyRow.request.description} — {dateLabel(pettyRow.request.date)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">المبلغ</dt>
                <dd className="num font-bold text-expense">{money(pettyRow.request.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الحالة</dt>
                <dd>{STATUS_AR[pettyRow.request.status] ?? pettyRow.request.status}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">البند</dt>
                <dd>{locks.pettyCat(pettyRow.request.category)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">القسم</dt>
                <dd>{locks.deptName(pettyRow.request.department)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">طالب الصرف</dt>
                <dd>{pettyRow.request.requestedBy}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">اعتمده</dt>
                <dd>{pettyRow.request.decidedBy || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">صرفه</dt>
                <dd>{pettyRow.request.paidBy || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الخزينة</dt>
                <dd>{locks.boxName(pettyRow.request.boxId)}</dd>
              </div>
            </dl>
            {pettyRow.request.decisionNote && (
              <p className="rounded-md border border-copper/30 bg-copper/5 px-3 py-2 text-sm">ملاحظة الاعتماد: {pettyRow.request.decisionNote}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
