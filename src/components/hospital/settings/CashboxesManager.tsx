import { Link } from "@tanstack/react-router";
import { Landmark, Trash2, Vault } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { boxBalance } from "@/lib/hospital/finance";
import { egp } from "@/lib/hospital/format";
import {
  deleteCashbox,
  ICU_BOX_ID,
  MAIN_BOX_ID,
  saveCashbox,
  useHospitalDB,
  type Cashbox,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

function BoxRow({ box }: { box: Cashbox }) {
  const db = useHospitalDB();
  const [name, setName] = useState(box.name);
  const cash = box.kind !== "bank";
  const main = box.id === MAIN_BOX_ID;
  const icu = box.id === ICU_BOX_ID;
  const bal = boxBalance(box.id, db.transactions, db.transfers);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Vault className={cn("size-5 shrink-0", cash ? "text-primary" : "text-copper")} />
      <Input
        value={name}
        aria-label="اسم الخزينة"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (!n) setName(box.name);
          else if (n !== box.name && saveCashbox({ ...box, name: n })) toast.success("تم الحفظ.");
        }}
        className="h-9 min-w-40 flex-1"
      />
      <span className="text-xs text-muted-foreground">
        {main ? "الخزينة الرئيسية" : icu ? "خزنة العناية المركزة" : cash ? "خزينة نقدية" : "حساب بنكي"}
      </span>
      {cash && db.shifts.some((s) => !s.closedAt && s.boxId === box.id) && (
        <span className="rounded-full bg-income/10 px-2 py-0.5 text-[11px] text-income">
          {db.shifts.filter((s) => !s.closedAt && s.boxId === box.id).length} وردية مفتوحة
        </span>
      )}
      <span className={cn("num w-32 text-left font-semibold", bal < 0 && "text-destructive")}>
        {egp(bal)}
      </span>
      {!cash && (
        <>
          <Switch
            checked={box.active}
            aria-label="تفعيل الخزينة"
            onCheckedChange={(active) => saveCashbox({ ...box, active })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`حذف ${box.name}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() =>
              window.confirm(`حذف ${box.name}؟`) &&
              deleteCashbox(box.id) &&
              toast.success("تم حذف الخزينة.")
            }
          >
            <Trash2 />
          </Button>
        </>
      )}
    </li>
  );
}

export function CashboxesManager() {
  const db = useHospitalDB();
  const rank = (b: Cashbox) => (b.id === MAIN_BOX_ID ? 0 : b.id === ICU_BOX_ID ? 1 : 2);
  const boxes = [...db.cashboxes].sort((a, b) => rank(a) - rank(b));
  return (
    <section className="ledger-card overflow-hidden">
      <div className="border-b bg-secondary/60 px-4 py-3">
        <h2 className="text-lg font-bold text-secondary-foreground">خزائن المستشفى والحسابات البنكية</h2>
        <p className="text-xs text-muted-foreground">
          فيه خزنتين نقديتين: الرئيسية وخزنة العناية المركزة. إيصالات العناية تدخل خزنتها، وباقي الأقسام
          تدخل الرئيسية. الحسابات البنكية بتتضاف من صفحة البنوك والمطابقة البنكية.
        </p>
      </div>
      <ul className="divide-y">
        {boxes.map((b) => (
          <BoxRow key={b.id} box={b} />
        ))}
      </ul>
      <div className="border-t p-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/bank">
            <Landmark /> إضافة حساب بنكي من صفحة البنوك
          </Link>
        </Button>
      </div>
    </section>
  );
}
