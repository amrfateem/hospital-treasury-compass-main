import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldRow } from "@/components/hospital/kit";
import { egp, int, isoDate, money } from "@/lib/hospital/format";
import { refundable } from "@/lib/hospital/refunds";
import { requestRefund, useHospitalDB, type PatientInvoice } from "@/lib/hospital/store";

/** Picks the cancelled lines of a paid receipt and sends the refund for the finance manager's approval. */
export function RefundDialog({
  invoice,
  onOpenChange,
}: {
  invoice: PatientInvoice | null;
  onOpenChange: (o: boolean) => void;
}) {
  const db = useHospitalDB();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(isoDate(new Date()));
  const [error, setError] = useState("");

  useEffect(() => {
    setQty({});
    setReason("");
    setError("");
    setDate(isoDate(new Date()));
  }, [invoice]);

  const r = useMemo(() => (invoice ? refundable(invoice, db.refunds) : null), [invoice, db.refunds]);
  const picked = r ? r.lines.map((l) => ({ l, q: Math.min(l.left, Math.max(0, Math.floor(Number(qty[l.index]) || 0))) })) : [];
  const sum = picked.reduce((s, p) => s + p.q * p.l.unitShare, 0);
  const amount = r ? Math.min(sum, r.cashLeft) : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const lines = picked.filter((p) => p.q > 0).map((p) => ({ index: p.l.index, qty: p.q }));
    if (!lines.length) return setError("اختر الخدمة المرتجعة واكتب كميتها.");
    if (!reason.trim()) return setError("اكتب سبب المرتجع.");
    if (requestRefund({ invoiceId: invoice.id, date, lines, reason: reason.trim() })) {
      toast.success("أُرسل طلب المرتجع للمدير المالي. بعد الاعتماد يُصرف المبلغ من صفحة المرتجعات.");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">مرتجع للمريض</DialogTitle>
          <DialogDescription>
            إيصال <span dir="ltr">{invoice?.number}</span> — {invoice?.patientName}. اختر الخدمات التي أُلغيت؛ يُحسب المبلغ بما دفعه المريض فعلًا بعد الخصم ونصيب التأمين.
          </DialogDescription>
        </DialogHeader>
        {r && (
          <form onSubmit={submit} className="grid gap-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-secondary/60 text-xs text-secondary-foreground">
                    <th className="px-3 py-2 text-right">الخدمة</th>
                    <th className="px-3 py-2 text-left">الكمية</th>
                    <th className="px-3 py-2 text-left">دفع المريض / وحدة</th>
                    <th className="px-3 py-2 text-left">الكمية المرتجعة</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.index} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {l.description}
                        {l.stockItemId && <span className="mr-1 text-[11px] text-muted-foreground">(يرجع للمخزن)</span>}
                      </td>
                      <td className="num px-3 py-2 text-left">
                        {int(l.qty)}
                        {l.left < l.qty && <span className="block text-[11px] text-muted-foreground">متاح {int(l.left)}</span>}
                      </td>
                      <td className="num px-3 py-2 text-left">{money(l.unitShare)}</td>
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`الكمية المرتجعة من ${l.description}`}
                          type="number"
                          min="0"
                          max={l.left}
                          disabled={!l.left}
                          value={qty[l.index] ?? ""}
                          onChange={(e) => setQty({ ...qty, [l.index]: e.target.value })}
                          placeholder="٠"
                          className="mr-auto h-8 w-20"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <FieldRow label="التاريخ" htmlFor="rf-date">
                <Input id="rf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FieldRow>
              <FieldRow label="سبب المرتجع" htmlFor="rf-reason">
                <Textarea id="rf-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: المريض ألغى التحليل قبل سحب العينة" />
              </FieldRow>
            </div>
            <div className="grid grid-cols-2 gap-y-1 rounded-lg border border-dashed bg-muted/60 p-3 text-sm">
              <span className="text-muted-foreground">المتاح رده من المدفوع</span>
              <span className="num text-left">{egp(r.cashLeft)}</span>
              <span className="font-semibold">المبلغ المرتجع للمريض</span>
              <span className="num text-left text-lg font-bold text-expense">{egp(amount)}</span>
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-start">
              <Button type="submit" disabled={!r.cashLeft}>إرسال للاعتماد</Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
