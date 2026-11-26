import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isDeskRole } from "@/lib/hospital/permissions";
import { HandCoins, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BoxSelect, FieldRow, MethodSelect } from "@/components/hospital/kit";
import { StatCard } from "@/components/hospital/ui";
import { findDepartment } from "@/lib/hospital/constants";
import { listFiles } from "@/lib/hospital/files.functions";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import { ageOn } from "@/lib/hospital/national-id";
import {
  collectPatientRemaining,
  flushPending,
  requestPatientDelete,
  useCan,
  useHospitalDB,
  useHospitalSession,
} from "@/lib/hospital/store";
import { ACCEPTED_FILES, errorText, uploadPrivateFile } from "@/lib/hospital/upload";
import { getPatientFile } from "@/lib/medical/medical.functions";
import { getLegacyPatientHistory } from "@/lib/legacy/legacy.functions";
import { LEGACY_LABEL } from "@/lib/legacy/labels";
import type { Patient } from "@/lib/medical/model";
import { getPatientMoney } from "@/lib/medical/patient-money.functions";
import { cn } from "@/lib/utils";

export const patientMoneyKey = ["patient-money"] as const;

export function PatientFileSheet({
  patientId,
  onOpenChange,
  onEdit,
}: {
  patientId: string | null;
  onOpenChange: (o: boolean) => void;
  onEdit: (p: Patient) => void;
}) {
  return (
    <Sheet open={!!patientId} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-2xl">
        {patientId && <PatientFile id={patientId} onEdit={onEdit} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function PatientFile({ id, onEdit, onClose }: { id: string; onEdit: (p: Patient) => void; onClose: () => void }) {
  const db = useHospitalDB();
  const { version } = useHospitalSession();
  const qc = useQueryClient();
  const canEdit = useCan("patients", "edit");
  const canAdd = useCan("patients", "add");
  const canCollect = useCan("billing", "add");
  const file = useQuery({ queryKey: ["patient-file", id], queryFn: () => getPatientFile({ data: { id } }) });
  const legacy = useQuery({ queryKey: ["patient-legacy", id], queryFn: () => getLegacyPatientHistory({ data: { patientId: id } }), enabled: id.startsWith("legacy-") });
  const moneyQ = useQuery({
    queryKey: [...patientMoneyKey, version, id],
    queryFn: () => getPatientMoney({ data: { ids: [id] } }),
  });
  const files = useQuery({ queryKey: ["files", "patient", id], queryFn: () => listFiles({ data: { ownerKind: "patient", ownerId: id } }) });
  const [collecting, setCollecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const p = file.data?.patient;
  const m = moneyQ.data?.[id];
  const receipts = db.patientInvoices.filter((i) => i.patientId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const pendingDelete = db.patientDeleteRequests.find((r) => r.patientId === id && r.status === "pending");
  const rejected = db.patientDeleteRequests.filter((r) => r.patientId === id && r.status === "rejected").at(-1);

  if (file.isLoading)
    return (
      <p className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> جارٍ فتح الملف...
      </p>
    );
  if (!p) return <p className="p-8 text-sm text-destructive">{errorText(file.error, "تعذّر فتح الملف.")}</p>;

  async function upload(f: File) {
    setUploading(true);
    try {
      await uploadPrivateFile({ ownerKind: "patient", ownerId: id, kind: "attachment", file: f, fileName: f.name });
      toast.success("تم إرفاق الملف.");
      void qc.invalidateQueries({ queryKey: ["files", "patient", id] });
    } catch (e) {
      toast.error(errorText(e, "تعذّر رفع الملف."));
    } finally {
      setUploading(false);
    }
  }

  const info: [string, string][] = [
    ["رقم الملف", p.mrn],
    ["الرقم القومي", p.nationalId || "—"],
    ["التليفون", p.phone || "—"],
    ["السن", p.birthDate ? `${ageOn(p.birthDate, isoDate(new Date()))} سنة (${dateLabel(p.birthDate)})` : "—"],
    ["النوع", p.gender === "male" ? "ذكر" : p.gender === "female" ? "أنثى" : "—"],
    ["فصيلة الدم", p.bloodType || "—"],
    ["العنوان", p.address || "—"],
    ["حساسية", p.allergies || "—"],
    ["أمراض مزمنة", p.chronicConditions || "—"],
    ["للطوارئ", p.emergencyContact || "—"],
  ];

  return (
    <>
      <SheetHeader className="text-right sm:text-right">
        <SheetTitle className="font-display text-2xl">{p.fullName}</SheetTitle>
        <SheetDescription>
          ملف <span dir="ltr" className="num">{p.mrn}</span> — مفتوح منذ {dateLabel(p.createdAt.slice(0, 10))}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-2 grid gap-3 px-4 sm:grid-cols-3">
        <StatCard label="إجمالي المطلوب منه" value={m ? egp(m.billed) : "…"} hint={m ? `${int(m.receipts)} إيصال` : undefined} />
        <StatCard label="المدفوع" value={m ? egp(m.paidAtDesk + m.collected) : "…"} tone="income" />
        <StatCard label="المتبقي عليه" value={m ? egp(m.remaining) : "…"} tone={m && m.remaining > 0 ? "expense" : "default"} />
      </div>
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        {m && m.remaining > 0 && canCollect && (
          <Button onClick={() => setCollecting(true)}>
            <HandCoins /> تحصيل المتبقي
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => onEdit(p)}>
            <Pencil /> تعديل البيانات
          </Button>
        )}
        {canAdd && !pendingDelete && (
          <Button variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>
            <Trash2 /> طلب حذف الملف
          </Button>
        )}
      </div>
      {pendingDelete && (
        <p className="mx-4 mt-3 rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-3 py-2 text-sm">
          طلب حذف هذا الملف بانتظار اعتماد المدير المالي (طلبه {pendingDelete.requestedBy}: {pendingDelete.reason}).
        </p>
      )}
      {!pendingDelete && rejected && (
        <p className="mx-4 mt-3 text-xs text-muted-foreground">رفض {rejected.decidedBy} آخر طلب حذف لهذا الملف.</p>
      )}

      <Tabs defaultValue="receipts" dir="rtl" className="px-4 pt-4 pb-6">
        <TabsList className="mb-3">
          <TabsTrigger value="receipts">الإيصالات ({int(receipts.length)})</TabsTrigger>
          <TabsTrigger value="info">البيانات</TabsTrigger>
          <TabsTrigger value="visits">الزيارات ({int(file.data?.visits.length ?? 0)})</TabsTrigger>
          <TabsTrigger value="files">المرفقات</TabsTrigger>
          {id.startsWith("legacy-") && <TabsTrigger value="legacy">السيستم القديم ({int(legacy.data?.length ?? 0)})</TabsTrigger>}
        </TabsList>
        <TabsContent value="receipts">
          {receipts.length ? (
            <ul className="ledger-card divide-y">
              {receipts.map((inv) => {
                const a = invoiceAmounts(inv);
                const own = inv.credit?.accountId.startsWith("pt-") ? a.credit : 0;
                return (
                  <li key={inv.id} className="grid grid-cols-[1fr_auto] gap-1 px-3 py-2.5 text-sm">
                    <span>
                      <span className="num font-mono text-xs" dir="ltr">{inv.number}</span> — {findDepartment(db.departments, inv.department).name}
                      <span className="block text-xs text-muted-foreground">
                        {dateLabel(inv.date)} • {inv.items.map((i) => i.description).slice(0, 3).join("، ")}
                      </span>
                    </span>
                    <span className="text-left">
                      <span className="num block font-semibold">{money(a.patientShare)}</span>
                      {own > 0 ? (
                        <span className="num text-xs text-expense">متبقي {money(own)}</span>
                      ) : (
                        <span className="text-xs text-income">مدفوع</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ledger-card p-6 text-center text-sm text-muted-foreground">لا توجد إيصالات مربوطة بهذا الملف بعد.</p>
          )}
          {m && m.collected > 0 && <p className="mt-2 text-xs text-muted-foreground">حُصِّل من المتبقي لاحقًا: {egp(m.collected)}</p>}
        </TabsContent>
        <TabsContent value="info">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn((k === "رقم الملف" || k === "الرقم القومي") && "num")}>{v}</dd>
              </div>
            ))}
          </dl>
          {p.notes && <p className="mt-3 rounded-md bg-muted/60 p-3 text-sm">{p.notes}</p>}
        </TabsContent>
        <TabsContent value="visits">
          {file.data?.visits.length ? (
            <ul className="ledger-card divide-y text-sm">
              {file.data.visits.map((v) => (
                <li key={v.id} className="px-3 py-2.5">
                  <span className="font-semibold">{dateLabel(v.visitDate)}</span> — {findDepartment(db.departments, v.department).name}
                  {v.diagnosis && <span className="block text-xs text-muted-foreground">التشخيص: {v.diagnosis}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ledger-card p-6 text-center text-sm text-muted-foreground">لا توجد زيارات مسجلة.</p>
          )}
        </TabsContent>
        <TabsContent value="legacy">
          {legacy.data?.length ? (
            <ul className="ledger-card divide-y text-sm">
              {legacy.data.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 px-3 py-2.5">
                  <span>
                    <span className="font-semibold">{LEGACY_LABEL[r.kind] ?? r.kind}</span> — {r.title || "—"}
                    {r.at && <span className="block text-xs text-muted-foreground">{r.at}</span>}
                  </span>
                  <span className="text-end tabular-nums">
                    {money(r.amount)}
                    {r.paid !== null && r.paid !== r.amount && <span className="block text-xs text-muted-foreground">مدفوع {money(r.paid)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ledger-card p-6 text-center text-sm text-muted-foreground">{legacy.isLoading ? "جاري التحميل…" : "لا توجد سجلات من السيستم القديم."}</p>
          )}
        </TabsContent>
        <TabsContent value="files">
          <div className="grid gap-2">
            {canAdd && (
              <>
                <input ref={input} type="file" accept={ACCEPTED_FILES} className="hidden" aria-label="إرفاق ملف للمريض" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                <Button variant="outline" className="justify-self-start" disabled={uploading} onClick={() => input.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />} إرفاق (بطاقة، تحاليل، أشعة ...)
                </Button>
              </>
            )}
            {(files.data ?? []).map((f) => (
              <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                {f.fileName || "مرفق"} — {dateLabel(f.createdAt.slice(0, 10))}
              </a>
            ))}
            {!files.isLoading && !files.data?.length && <p className="text-xs text-muted-foreground">لا توجد مرفقات.</p>}
          </div>
        </TabsContent>
      </Tabs>

      <CollectDialog
        open={collecting}
        onClose={() => setCollecting(false)}
        patient={p}
        remaining={m?.remaining ?? 0}
        onDone={() => void qc.invalidateQueries({ queryKey: patientMoneyKey })}
      />
      <DeleteRequestDialog open={deleting} onClose={() => setDeleting(false)} patient={p} onRequested={onClose} />
    </>
  );
}

function CollectDialog({ open, onClose, patient, remaining, onDone }: { open: boolean; onClose: () => void; patient: Patient; remaining: number; onDone: () => void }) {
  const { me } = useHospitalSession();
  const db = useHospitalDB();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(db.lists.paymentMethods[0]?.id ?? "cash");
  const [boxId, setBoxId] = useState(me?.boxId ?? db.cashboxes[0]?.id ?? "main");
  const desk = isDeskRole(me?.role);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount || remaining);
    if (!collectPatientRemaining({ patientId: patient.id, date: isoDate(new Date()), amount: n, method, boxId: desk ? undefined : boxId })) return;
    await flushPending();
    toast.success(`تم تحصيل ${egp(n)} من ${patient.fullName}.`);
    onDone();
    setAmount("");
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>تحصيل المتبقي — {patient.fullName}</DialogTitle>
          <DialogDescription>المتبقي عليه {egp(remaining)}. يُسجَّل المبلغ في الخزينة ويقل المتبقي في ملفه.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <FieldRow label="المبلغ المحصَّل" htmlFor="col-amt">
            <Input id="col-amt" type="number" min="0" step="0.01" max={remaining} value={amount} placeholder={String(remaining)} onChange={(e) => setAmount(e.target.value)} />
          </FieldRow>
          <FieldRow label="طريقة الدفع">
            <MethodSelect value={method} onChange={setMethod} />
          </FieldRow>
          {!desk && (
            <FieldRow label="الخزينة">
              <BoxSelect value={boxId} onChange={setBoxId} />
            </FieldRow>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">تسجيل التحصيل</Button>
            <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRequestDialog({ open, onClose, patient, onRequested }: { open: boolean; onClose: () => void; patient: Patient; onRequested: () => void }) {
  const [reason, setReason] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestPatientDelete({ patientId: patient.id, patientName: patient.fullName, patientMrn: patient.mrn, reason })) return;
    toast.success("أُرسل طلب الحذف للمدير المالي — لن يُحذف الملف إلا بعد اعتماده.");
    setReason("");
    onClose();
    onRequested();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>طلب حذف ملف {patient.fullName}</DialogTitle>
          <DialogDescription>
            لا يُحذف أي ملف مريض إلا بموافقة المدير المالي. بعد الموافقة يُحذف الملف الطبي ومرفقاته، وتبقى إيصالاته المالية محفوظة في الحسابات.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <FieldRow label="سبب الحذف" htmlFor="del-reason">
            <Textarea id="del-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: ملف مكرر لنفس المريض برقم MRN-000123" />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" variant="destructive">إرسال الطلب للمدير المالي</Button>
            <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
