import { Check, FileDown, PackageCheck, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptBadge } from "@/components/hospital/ui";
import {
  DeptSelect,
  DocInfoGrid,
  EmptyRow,
  FieldRow,
  FilterBar,
  HeadRow,
  matches,
  MonthYearPicker,
  SearchBox,
  StockItemSelect,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { findDepartment } from "@/lib/hospital/constants";
import { stockStatus } from "@/lib/hospital/finance";
import { dateLabel, isoDate, periodOf } from "@/lib/hospital/format";
import {
  decideIssueOrder,
  deleteIssueOrder,
  deliverIssueOrder,
  ISSUE_STATUS_LABELS,
  issueStatus,
  newId,
  saveIssueOrder,
  useCan,
  useCanApprove,
  useHospitalDB,
  type IssueOrder,
  type IssueStatus,
} from "@/lib/hospital/store";

/** Department store requests: a department asks → the finance manager approves → the store issues. */
export function IssueOrders() {
  const db = useHospitalDB();
  const canAdd = useCan("orders", "add");
  const canEdit = useCan("orders");
  const canDeliver = useCan("stock", "add");
  const approver = useCanApprove();
  const today = isoDate(new Date());
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [status, setStatus] = useState<"all" | IssueStatus>("all");
  const [dept, setDept] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<IssueOrder | null | "new">(null);
  const [printing, setPrinting] = useState<IssueOrder | null>(null);
  const pdf = usePdfExport();
  const itemOf = (id: string) => db.stockItems.find((i) => i.id === id);

  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      void pdf.run(`إذن-صرف-${printing.number}.pdf`, "تم تصدير إذن الصرف.").finally(() => setPrinting(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  const rows = useMemo(
    () =>
      db.issueOrders
        .filter(
          (o) =>
            (period === "all" || o.date.startsWith(period)) &&
            (status === "all" || issueStatus(o) === status) &&
            (dept === "all" || o.department === dept) &&
            matches(query, o.number, o.receiver, o.note, o.by),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [db.issueOrders, period, status, dept, query],
  );

  function reject(o: IssueOrder) {
    const note = window.prompt("سبب الرفض:");
    if (note !== null && decideIssueOrder(o.id, false, note)) toast.success("تم رفض الطلب.");
  }

  return (
    <div>
      <p className="mb-4 rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        أي قسم يطلب أصنافًا من المخزن بطلب صرف، ولا يُسلَّم شيء إلا بعد <b className="text-foreground">موافقة المدير المالي</b>، ثم يسلّمه أمين المخزن ويُخصم من الرصيد بأقرب صلاحية أولًا.
      </p>
      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="bg-card md:w-56" aria-label="الحالة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الحالات</SelectItem>
            {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ISSUE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DeptSelect value={dept} onChange={setDept} allowAll className="md:w-56" />
        <SearchBox value={query} onChange={setQuery} placeholder="رقم الطلب أو المستلم" className="md:flex-1" />
        {canAdd && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> طلب صرف من المخزن
          </Button>
        )}
      </FilterBar>

      <TableCard minWidth={1000}>
        <thead>
          <HeadRow>
            <Th>رقم الطلب</Th>
            <Th>التاريخ</Th>
            <Th>القسم الطالب</Th>
            <Th>المستلم</Th>
            <Th>الأصناف</Th>
            <Th>الحالة</Th>
            <Th className="w-48" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((o) => {
            const st = issueStatus(o);
            return (
              <tr key={o.id} className="border-b align-top last:border-0 hover:bg-muted/50">
                <Td className="font-mono text-xs">
                  <span dir="ltr">{o.number}</span>
                </Td>
                <Td num className="text-right">
                  {dateLabel(o.date)}
                </Td>
                <Td>
                  <DeptBadge id={o.department} />
                </Td>
                <Td>
                  <p>{o.receiver}</p>
                  <p className="text-[10px] text-muted-foreground">طلبه: {o.by}</p>
                </Td>
                <Td className="text-xs">
                  {o.lines.map((l, i) => {
                    const it = itemOf(l.stockItemId);
                    const bal = it ? stockStatus(it, db.stockMoves, today).balance : 0;
                    return (
                      <p key={i}>
                        {it?.name ?? "صنف محذوف"} — <span className="num">{l.qty}</span> {it?.unit}
                        {st === "approved" && bal < l.qty && <span className="text-destructive"> (المتاح {bal})</span>}
                      </p>
                    );
                  })}
                </Td>
                <Td>
                  <StatusBadge status={st} label={ISSUE_STATUS_LABELS[st]} />
                  {o.decidedBy && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {st === "rejected" ? "رفضه" : "اعتمده"}: {o.decidedBy}
                      {o.decisionNote ? ` — ${o.decisionNote}` : ""}
                    </p>
                  )}
                  {st === "issued" && o.issuedBy && (
                    <p className="text-[10px] text-muted-foreground">
                      سلّمه {o.issuedBy} {o.issuedOn ? dateLabel(o.issuedOn) : ""}
                    </p>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1">
                    {st === "pending" && approver(o) && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => decideIssueOrder(o.id, true) && toast.success("تم اعتماد طلب الصرف.")}>
                          <Check /> اعتماد
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="رفض" className="text-destructive" onClick={() => reject(o)}>
                          <X />
                        </Button>
                      </>
                    )}
                    {st === "approved" && canDeliver && (
                      <Button size="sm" onClick={() => deliverIssueOrder(o.id, isoDate(new Date())) && toast.success("تم التسليم وخصم الكميات من المخزن.")}>
                        <PackageCheck /> تسليم
                      </Button>
                    )}
                    {st === "pending" && canEdit && (
                      <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setEditing(o)}>
                        <Pencil />
                      </Button>
                    )}
                    {st !== "pending" && st !== "rejected" && (
                      <Button size="icon" variant="ghost" aria-label="طباعة" onClick={() => setPrinting(o)} disabled={pdf.busy}>
                        <FileDown />
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="حذف"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          window.confirm(st === "issued" ? `حذف إذن الصرف ${o.number}؟ ستعود الكميات للمخزن.` : `حذف الطلب ${o.number}؟`) &&
                          deleteIssueOrder(o.id)
                        }
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={7} text="لا توجد طلبات صرف بهذه الفلاتر." />}
        </tbody>
      </TableCard>

      <IssueDialog open={editing !== null} order={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />

      {printing && (
        <OfficialDocument ref={pdf.ref} settings={db.settings} title="إذن صرف مخزني" subtitle={<span dir="ltr">{printing.number}</span>} issuedOn={dateLabel(printing.issuedOn ?? printing.date)}>
          <DocInfoGrid
            items={[
              ["القسم المستلم", findDepartment(db.departments, printing.department).name],
              ["المستلم", printing.receiver],
              ["مقدم الطلب", printing.by],
              ["اعتماد المدير المالي", printing.decidedBy ?? "—"],
              ["أمين المخزن", printing.issuedBy ?? "—"],
              ["ملاحظات", printing.note ?? "—"],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>م</th>
                <th>الصنف</th>
                <th>الوحدة</th>
                <th>الكمية</th>
              </tr>
            </thead>
            <tbody>
              {printing.lines.map((l, i) => (
                <tr key={i} data-pdf-break>
                  <td>{i + 1}</td>
                  <td className="text-start">{itemOf(l.stockItemId)?.name ?? "—"}</td>
                  <td>{itemOf(l.stockItemId)?.unit ?? ""}</td>
                  <td>{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SignatureBlock roles={["مقدم الطلب", "المدير المالي", "أمين المخزن", "المستلم"]} />
        </OfficialDocument>
      )}
    </div>
  );
}

function IssueDialog({ open, order, onOpenChange }: { open: boolean; order: IssueOrder | null; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const today = isoDate(new Date());
  const [f, setF] = useState({ date: today, department: "", receiver: "", note: "" });
  const [lines, setLines] = useState<{ id: string; stockItemId: string; qty: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    setF(
      order
        ? { date: order.date, department: order.department, receiver: order.receiver, note: order.note ?? "" }
        : { date: isoDate(new Date()), department: db.departments.find((d) => d.active && d.id === "nursing")?.id ?? "general", receiver: "", note: "" },
    );
    setLines(
      order?.lines.length
        ? order.lines.map((l) => ({ id: newId(), stockItemId: l.stockItemId, qty: String(l.qty) }))
        : [{ id: newId(), stockItemId: "", qty: "1" }],
    );
  }, [open, order, db.departments]);
  const balances = useMemo(
    () => Object.fromEntries(db.stockItems.map((i) => [i.id, stockStatus(i, db.stockMoves, today).balance])),
    [db.stockItems, db.stockMoves, today],
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      saveIssueOrder(
        {
          ...f,
          lines: lines.filter((l) => l.stockItemId).map((l) => ({ stockItemId: l.stockItemId, qty: Number(l.qty) || 0 })),
        },
        order,
      )
    ) {
      toast.success(order ? "تم تعديل الطلب." : "تم إرسال الطلب للمدير المالي للاعتماد.");
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{order ? "تعديل طلب صرف" : "طلب صرف من المخزن"}</DialogTitle>
          <DialogDescription>يُرسل الطلب للمدير المالي للاعتماد، ثم يسلّمه المخزن للقسم.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="is-date">
              <Input id="is-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </FieldRow>
            <FieldRow label="القسم الطالب">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
            <FieldRow label="اسم المستلم" htmlFor="is-rec">
              <Input id="is-rec" value={f.receiver} onChange={(e) => setF({ ...f, receiver: e.target.value })} />
            </FieldRow>
            <FieldRow label="ملاحظات" htmlFor="is-note">
              <Input id="is-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </FieldRow>
          </div>
          <div className="rounded-lg border">
            {lines.map((l) => {
              const short = l.stockItemId && (Number(l.qty) || 0) > (balances[l.stockItemId] ?? 0);
              return (
                <div key={l.id} className="border-b px-3 py-2 last:border-0">
                  <div className="grid grid-cols-[1fr_6rem_2.5rem] items-center gap-2">
                    <StockItemSelect
                      value={l.stockItemId}
                      balances={balances}
                      preferDept={f.department}
                      onChange={(v) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, stockItemId: v } : x)))}
                    />
                    <Input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))} aria-label="الكمية" />
                    <Button type="button" size="icon" variant="ghost" aria-label="حذف السطر" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                      <Trash2 />
                    </Button>
                  </div>
                  {short && <p className="mt-1 text-[11px] text-copper">الكمية أكبر من الرصيد الحالي — يمكن الطلب، لكن التسليم يتم بعد توفر الرصيد.</p>}
                </div>
              );
            })}
            <div className="px-3 py-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { id: newId(), stockItemId: "", qty: "1" }])}>
                <Plus /> صنف آخر
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{order ? "حفظ التعديل" : "إرسال للاعتماد"}</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
