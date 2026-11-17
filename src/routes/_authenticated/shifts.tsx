import { createFileRoute } from "@tanstack/react-router";
import { isDeskRole } from "@/lib/hospital/permissions";
import { DoorClosed, DoorOpen, FileDown, Timer } from "lucide-react";
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
import { PageHeader } from "@/components/hospital/ui";
import { DocInfoGrid, EmptyRow, FieldRow, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { shiftDifferences, shiftExpected } from "@/lib/hospital/finance";
import { dateLabel, egp, isoDate, money } from "@/lib/hospital/format";
import {
  closeShift,
  findBox,
  listLabel,
  openShift,
  openShiftOf,
  useHospitalDB,
  useHospitalSession,
  type Shift,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/shifts")({
  head: () => ({
    meta: [
      { title: "الورديات وتقفيل الشيفت | مستشفى الرحمة التخصصي" },
      { name: "description", content: "فتح وتقفيل وردية كل موظف على الخزينة الرئيسية مع المتوقع والفعلي لكل طريقة دفع والعجز والزيادة." },
      { property: "og:title", content: "الورديات وتقفيل الشيفت | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تقفيل الشيفت: المتوقع مقابل الفعلي لكل موظف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShiftsPage,
});

const fmtTime = new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "short" });
const sum = (r?: Record<string, number>) => Object.values(r ?? {}).reduce((s, v) => s + v, 0);

function ShiftsPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const [closing, setClosing] = useState<Shift | null>(null);
  const [printing, setPrinting] = useState<Shift | null>(null);
  const pdf = usePdfExport();
  const reception = isDeskRole(me?.role);
  const mine = openShiftOf(db, me?.id);
  const others = reception ? [] : db.shifts.filter((s) => !s.closedAt && s.openedById !== me?.id);
  const history = useMemo(
    () => db.shifts.filter((s) => s.closedAt && (!reception || s.openedById === me?.id)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [db.shifts, reception, me?.id],
  );

  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      void pdf.run(`تقفيل-وردية-${printing.number}-${findBox(db, printing.boxId).name}.pdf`, "تم تصدير تقرير التقفيل.").finally(() => setPrinting(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الخزينة"
        title="الورديات وتقفيل الشيفت"
        description="كل موظف بيفتح ورديته على الخزينة الرئيسية قبل التحصيل، وفي نهاية الشيفت يعدّ اللي معاه لكل طريقة دفع ويسلّمه: الفرق بيتسجل تلقائيًا عجزًا أو زيادة باسمه."
      />
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mine ? <OpenShiftCard shift={mine} onClose={() => setClosing(mine)} /> : <ClosedBoxCard boxId="main" />}
        {others.map((s) => (
          <OpenShiftCard key={s.id} shift={s} onClose={() => setClosing(s)} />
        ))}
      </div>

      <h2 className="mb-3 text-lg font-bold">سجل الورديات المقفلة</h2>
      <TableCard minWidth={980}>
        <thead>
          <HeadRow>
            <Th>الموظف</Th>
            <Th>الوردية</Th>
            <Th>الفتح</Th>
            <Th>التقفيل</Th>
            <Th num>المتوقع</Th>
            <Th num>الفعلي</Th>
            <Th num>الفرق</Th>
            <Th>التسليم</Th>
            <Th className="w-12" />
          </HeadRow>
        </thead>
        <tbody>
          {history.map((s) => {
            const diff = sum(s.counted) - sum(s.expected);
            return (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-medium">{s.openedBy}</Td>
                <Td className="num">{s.number}</Td>
                <Td className="text-xs">
                  {fmtTime.format(new Date(s.openedAt))}
                  <p className="text-muted-foreground">{s.openedBy}</p>
                </Td>
                <Td className="text-xs">
                  {s.closedAt ? fmtTime.format(new Date(s.closedAt)) : ""}
                  <p className="text-muted-foreground">{s.closedBy}</p>
                </Td>
                <Td num>{money(sum(s.expected))}</Td>
                <Td num>{money(sum(s.counted))}</Td>
                <Td num className={cn("font-bold", diff < -0.004 ? "text-expense" : diff > 0.004 ? "text-income" : "")}>
                  {money(diff)}
                </Td>
                <Td className="text-xs">للخزينة الرئيسية</Td>
                <Td>
                  <Button size="icon" variant="ghost" aria-label="تقرير التقفيل" onClick={() => setPrinting(s)} disabled={pdf.busy}>
                    <FileDown />
                  </Button>
                </Td>
              </tr>
            );
          })}
          {!history.length && <EmptyRow cols={9} text="لا توجد ورديات مقفلة بعد." />}
        </tbody>
      </TableCard>

      <CloseDialog shift={closing} onClose={() => setClosing(null)} />

      {printing && (
        <OfficialDocument ref={pdf.ref} settings={db.settings} title="تقرير تقفيل وردية" subtitle={`${findBox(db, printing.boxId).name} — وردية ${printing.number}`} issuedOn={dateLabel(isoDate(new Date(printing.closedAt ?? Date.now())))}>
          <DocInfoGrid
            items={[
              ["فتح بواسطة", `${printing.openedBy} — ${fmtTime.format(new Date(printing.openedAt))}`],
              ["قفل بواسطة", `${printing.closedBy ?? ""} — ${printing.closedAt ? fmtTime.format(new Date(printing.closedAt)) : ""}`],
              ["عهدة الافتتاح", egp(printing.openingFloat)],
              ["التسليم", "للخزينة الرئيسية"],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>طريقة الدفع</th>
                <th>المتوقع</th>
                <th>الفعلي</th>
                <th>الفرق</th>
              </tr>
            </thead>
            <tbody>
              {shiftDifferences(printing.expected ?? {}, printing.counted ?? {}).rows.map((r) => (
                <tr key={r.method} data-pdf-break>
                  <td>{listLabel(db.lists.paymentMethods, r.method)}</td>
                  <td>{money(r.expected)}</td>
                  <td>{money(r.counted)}</td>
                  <td>{money(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {printing.note && <p data-pdf-break style={{ fontSize: 12.5, marginTop: 10 }}>ملاحظات: {printing.note}</p>}
          <SignatureBlock roles={["الموظف صاحب الوردية", "أمين الخزينة الرئيسية", "المراجع الداخلي"]} />
        </OfficialDocument>
      )}
    </div>
  );
}

function OpenShiftCard({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const db = useHospitalDB();
  const expected = shiftExpected(shift, db.transactions);
  return (
    <section className="ledger-card border-primary/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">{shift.openedBy} — الخزينة الرئيسية</h3>
        <span className="flex items-center gap-1 rounded-full bg-income/10 px-2 py-0.5 text-xs font-semibold text-income">
          <Timer className="size-3.5" /> وردية {shift.number} مفتوحة
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        فتحها {shift.openedBy} — {fmtTime.format(new Date(shift.openedAt))}
      </p>
      <ul className="my-3 space-y-1 text-sm">
        {Object.entries(expected).map(([m, v]) => (
          <li key={m} className="flex justify-between">
            <span>{listLabel(db.lists.paymentMethods, m)}</span>
            <span className="num font-semibold">{money(v)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm">
          المتوقع معاه: <strong className="num">{egp(sum(expected))}</strong>
        </span>
        <Button size="sm" variant="destructive" onClick={onClose}>
          <DoorClosed /> تقفيل
        </Button>
      </div>
    </section>
  );
}

function ClosedBoxCard({ boxId }: { boxId: string }) {
  const db = useHospitalDB();
  const [float, setFloat] = useState("");
  return (
    <section className="ledger-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">ورديتك على الخزينة الرئيسية</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">لا توجد وردية مفتوحة</span>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (openShift(boxId, Number(float) || 0)) {
            toast.success("تم فتح الوردية.");
            setFloat("");
          }
        }}
      >
        <FieldRow label="عهدة افتتاح (نقدي)" htmlFor={`fl-${boxId}`} className="flex-1">
          <Input id={`fl-${boxId}`} type="number" min="0" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" />
        </FieldRow>
        <Button type="submit">
          <DoorOpen /> فتح وردية
        </Button>
      </form>
    </section>
  );
}

function CloseDialog({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const db = useHospitalDB();
  const expected = useMemo(() => (shift ? shiftExpected(shift, db.transactions) : {}), [shift, db.transactions]);
  const methods = useMemo(
    () => [...new Set([...Object.keys(expected), ...db.lists.paymentMethods.map((m) => m.id)])],
    [expected, db.lists.paymentMethods],
  );
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!shift) return;
    setCounted(Object.fromEntries(Object.entries(expected).map(([m, v]) => [m, String(v)])));
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);
  if (!shift) return null;
  const nums = Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, Number(v) || 0]));
  const diffs = shiftDifferences(expected, nums);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">تقفيل وردية {shift.number}</DialogTitle>
          <DialogDescription>{findBox(db, shift.boxId).name} — اكتب المبلغ الفعلي لكل طريقة دفع.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {methods.map((m) => {
            const row = diffs.rows.find((r) => r.method === m);
            return (
              <div key={m} className="grid grid-cols-[1fr_7rem_6rem] items-center gap-2 text-sm">
                <span>
                  {listLabel(db.lists.paymentMethods, m)}
                  <span className="block text-[10px] text-muted-foreground">المتوقع {money(expected[m] ?? 0)}</span>
                </span>
                <Input type="number" min="0" step="0.01" value={counted[m] ?? ""} onChange={(e) => setCounted({ ...counted, [m]: e.target.value })} aria-label={`الفعلي ${listLabel(db.lists.paymentMethods, m)}`} />
                <span className={cn("num text-left text-xs font-semibold", (row?.diff ?? 0) < 0 ? "text-expense" : (row?.diff ?? 0) > 0 ? "text-income" : "text-muted-foreground")}>
                  {money(row?.diff ?? 0)}
                </span>
              </div>
            );
          })}
          <p className={cn("mt-2 rounded-lg p-2 text-sm font-semibold", diffs.diff < 0 ? "bg-expense/10 text-expense" : diffs.diff > 0 ? "bg-income/10 text-income" : "bg-muted")}>
            {diffs.diff < 0 ? `عجز ${egp(-diffs.diff)}` : diffs.diff > 0 ? `زيادة ${egp(diffs.diff)}` : "مطابق — لا يوجد فرق"}
          </p>
          <p className="mt-2 rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
            الفلوس بتتسلّم للخزينة الرئيسية — التقفيل بيثبت اللي اتسلّم على اسم صاحب الوردية.
          </p>
          <FieldRow label="ملاحظات (اختياري)" htmlFor="cl-note">
            <Input id="cl-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldRow>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            variant="destructive"
            onClick={() => {
              if (closeShift(shift.id, nums, "main", note)) {
                toast.success("تم تقفيل الوردية.");
                onClose();
              }
            }}
          >
            <DoorClosed /> تأكيد التقفيل
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
