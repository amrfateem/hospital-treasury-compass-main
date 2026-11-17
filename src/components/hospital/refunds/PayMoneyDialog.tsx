import { useEffect, useState } from "react";
import { isDeskRole } from "@/lib/hospital/permissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BoxSelect, FieldRow, MethodSelect } from "@/components/hospital/kit";
import { egp, isoDate } from "@/lib/hospital/format";
import { findBox, MAIN_BOX_ID, useHospitalDB, useHospitalSession } from "@/lib/hospital/store";

/** Date + cash box + method for paying an approved amount out. Reception always pays from its own drawer. */
export function PayMoneyDialog({
  open,
  onOpenChange,
  title,
  description,
  amount,
  onPay,
  forceManagerBox = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  amount: number;
  onPay: (a: { date: string; boxId: string; method: string }) => boolean;
  /** The box is always chosen (no reception drawer), e.g. staff advances. */
  forceManagerBox?: boolean;
}) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const ownDrawer = !forceManagerBox && isDeskRole(me?.role);
  const [date, setDate] = useState(isoDate(new Date()));
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [method, setMethod] = useState("cash");
  useEffect(() => {
    if (!open) return;
    setDate(isoDate(new Date()));
    setBoxId(ownDrawer ? (me?.boxId ?? MAIN_BOX_ID) : MAIN_BOX_ID);
    setMethod("cash");
  }, [open, ownDrawer, me]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (onPay({ date, boxId, method })) onOpenChange(false);
          }}
        >
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            المبلغ: <b className="num text-expense">{egp(amount)}</b>
          </p>
          <FieldRow label="التاريخ" htmlFor="pay-date">
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </FieldRow>
          <FieldRow label="يُصرف من">
            {ownDrawer ? (
              <p className="rounded-md border bg-card px-3 py-2 text-sm">{findBox(db, me?.boxId ?? undefined).name}</p>
            ) : (
              <BoxSelect value={boxId} onChange={setBoxId} />
            )}
          </FieldRow>
          <FieldRow label="طريقة الدفع">
            <MethodSelect value={method} onChange={setMethod} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">تأكيد الصرف</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
