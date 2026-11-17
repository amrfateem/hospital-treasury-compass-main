import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, FileDown, IdCard, Loader2, Pencil, Plus, Printer, Trash2, Upload, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldRow, usePdfExport } from "@/components/hospital/kit";
import { findDepartment } from "@/lib/hospital/constants";
import { deleteStoredFile, listFiles, type StoredFile } from "@/lib/hospital/files.functions";
import { dateLabel, egp, isoDate } from "@/lib/hospital/format";
import { CONTRACT_STATUS, CONTRACT_TYPES } from "@/lib/hospital/hr";
import { ageOn, parseNationalId } from "@/lib/hospital/national-id";
import { deleteContract, endContract, signContract, useCan, useHospitalDB, type Employee, type EmploymentContract } from "@/lib/hospital/store";
import { ACCEPTED_FILES, errorText, uploadPrivateFile, urlToDataUrl } from "@/lib/hospital/upload";
import { cn } from "@/lib/utils";
import { ContractDialog } from "./ContractDialog";
import { ContractDocument } from "./ContractDocument";

export const staffFilesKey = (id: string) => ["files", "employee", id] as const;

export function StaffFileSheet({
  employee,
  onOpenChange,
  onEdit,
}: {
  employee: Employee | null;
  onOpenChange: (o: boolean) => void;
  onEdit: (e: Employee) => void;
}) {
  return (
    <Sheet open={!!employee} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-2xl">
        {employee && <StaffFile employee={employee} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  );
}

function StaffFile({ employee: e, onEdit }: { employee: Employee; onEdit: (e: Employee) => void }) {
  const db = useHospitalDB();
  const canAdd = useCan("hr", "add");
  const canEdit = useCan("hr", "edit");
  const qc = useQueryClient();
  const files = useQuery({ queryKey: staffFilesKey(e.id), queryFn: () => listFiles({ data: { ownerKind: "employee", ownerId: e.id } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: staffFilesKey(e.id) });
  const contracts = db.contracts.filter((c) => c.employeeId === e.id).sort((a, b) => b.createdAt - a.createdAt);
  const nid = e.nationalId ? parseNationalId(e.nationalId) : null;
  const info = nid && !("error" in nid) ? nid : null;
  const birth = e.personal?.birthDate || info?.birthDate;
  const today = isoDate(new Date());

  const rows: [string, string][] = [
    ["الوظيفة", e.jobTitle || "—"],
    ["القسم", findDepartment(db.departments, e.department).name],
    ["تاريخ التعيين", e.hireDate ? dateLabel(e.hireDate) : "—"],
    ["الرقم القومي", e.nationalId || "—"],
    ["تاريخ الميلاد", birth ? `${dateLabel(birth)} (${ageOn(birth, today)} سنة)` : "—"],
    ["النوع", (e.personal?.gender ?? info?.gender) === "female" ? "أنثى" : (e.personal?.gender ?? info?.gender) === "male" ? "ذكر" : "—"],
    ["المحافظة (من الرقم القومي)", info?.governorate ?? "—"],
    ["التليفون", e.personal?.phone || "—"],
    ["العنوان", e.personal?.address || "—"],
    ["المؤهل", e.personal?.qualification || "—"],
    ["الحالة الاجتماعية", e.personal?.maritalStatus || "—"],
    ["الرقم التأميني", e.personal?.insuranceNo || "—"],
    ["للطوارئ", e.personal?.emergencyContact || "—"],
  ];
  if (e.personal?.leftOn) rows.push(["ترك العمل", dateLabel(e.personal.leftOn)]);

  return (
    <>
      <SheetHeader className="text-right sm:text-right">
        <SheetTitle className="font-display text-2xl">{e.name}</SheetTitle>
        <SheetDescription>
          {e.jobTitle} — {findDepartment(db.departments, e.department).name}
        </SheetDescription>
      </SheetHeader>
      <Tabs defaultValue="contracts" dir="rtl" className="px-4 pb-6">
        <TabsList className="mb-4">
          <TabsTrigger value="contracts">العقود</TabsTrigger>
          <TabsTrigger value="id">البطاقة والمستندات</TabsTrigger>
          <TabsTrigger value="info">البيانات</TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn(k === "الرقم القومي" && "num")}>{v}</dd>
              </div>
            ))}
          </dl>
          {canAdd && (
            <Button className="mt-5" variant="outline" onClick={() => onEdit(e)}>
              <Pencil /> تعديل البيانات
            </Button>
          )}
        </TabsContent>
        <TabsContent value="id">
          <IdCardPanel employee={e} files={files.data ?? []} loading={files.isLoading} canAdd={canAdd} canEdit={canEdit} onChange={refresh} />
        </TabsContent>
        <TabsContent value="contracts">
          <ContractsPanel employee={e} contracts={contracts} files={files.data ?? []} canAdd={canAdd} canEdit={canEdit} onFilesChanged={refresh} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ---------------- National ID card + other documents ---------------- */

function FilePicker({ label, onPick, busy, accept = ACCEPTED_FILES }: { label: string; onPick: (f: File) => void; busy?: boolean; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={label}
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (f) onPick(f);
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} {label}
      </Button>
    </>
  );
}

function Preview({ file }: { file: StoredFile }) {
  if (!file.url) return <p className="text-xs text-muted-foreground">تعذّر عرض الملف.</p>;
  if (file.mimeType === "application/pdf")
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
        <FileDown className="size-4" /> {file.fileName || "ملف PDF"}
      </a>
    );
  return (
    <a href={file.url} target="_blank" rel="noreferrer">
      <img src={file.url} alt={file.fileName} className="max-h-48 w-full rounded-md border object-contain" />
    </a>
  );
}

function IdCardPanel({
  employee,
  files,
  loading,
  canAdd,
  canEdit,
  onChange,
}: {
  employee: Employee;
  files: StoredFile[];
  loading: boolean;
  canAdd: boolean;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function upload(kind: string, f: File, replace: boolean) {
    setBusy(kind);
    try {
      await uploadPrivateFile({ ownerKind: "employee", ownerId: employee.id, kind, file: f, fileName: f.name, replace });
      toast.success("تم رفع الملف وحفظه في ملف الموظف.");
      onChange();
    } catch (e) {
      toast.error(errorText(e, "تعذّر رفع الملف."));
    } finally {
      setBusy(null);
    }
  }
  async function remove(f: StoredFile) {
    if (!window.confirm("حذف هذا الملف نهائيًا؟")) return;
    try {
      await deleteStoredFile({ data: { id: f.id } });
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  const slot = (kind: "id_front" | "id_back", title: string) => {
    const f = files.find((x) => x.kind === kind);
    return (
      <div className="ledger-card grid content-start gap-3 p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <IdCard className="size-4 text-primary" /> {title}
          </p>
          {f && canEdit && (
            <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label={`حذف ${title}`} onClick={() => void remove(f)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        {loading ? <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /> : f ? <Preview file={f} /> : <p className="py-6 text-center text-xs text-muted-foreground">لم تُرفع بعد</p>}
        {canAdd && <FilePicker label={f ? "استبدال الصورة" : "رفع صورة"} busy={busy === kind} onPick={(file) => void upload(kind, file, true)} />}
      </div>
    );
  };
  const others = files.filter((f) => f.kind === "other");
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        صورة وجه وظهر بطاقة الرقم القومي ({employee.nationalId ? <span className="num">{employee.nationalId}</span> : "لم يُسجَّل الرقم بعد"}). الملفات محفوظة بشكل خاص ولا يراها إلا من له صلاحية شؤون العاملين.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {slot("id_front", "البطاقة — الوجه")}
        {slot("id_back", "البطاقة — الظهر")}
      </div>
      <div className="ledger-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">مستندات أخرى (مؤهل، فيش، شهادة ميلاد ...)</p>
          {canAdd && <FilePicker label="إضافة مستند" busy={busy === "other"} onPick={(file) => void upload("other", file, false)} />}
        </div>
        {others.length ? (
          <ul className="grid gap-2">
            {others.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{f.fileName || "مستند"}</a>
                <span className="text-xs text-muted-foreground">{dateLabel(f.createdAt.slice(0, 10))}</span>
                {canEdit && (
                  <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="حذف المستند" onClick={() => void remove(f)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">لا توجد مستندات أخرى.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------- Contracts: write, print, employee signs on paper, record it, end ---------------- */

function ContractsPanel({
  employee,
  contracts,
  files,
  canAdd,
  canEdit,
  onFilesChanged,
}: {
  employee: Employee;
  contracts: EmploymentContract[];
  files: StoredFile[];
  canAdd: boolean;
  canEdit: boolean;
  onFilesChanged: () => void;
}) {
  const db = useHospitalDB();
  const [editing, setEditing] = useState<EmploymentContract | null | "new">(null);
  const [signing, setSigning] = useState<EmploymentContract | null>(null);
  const [printNext, setPrintNext] = useState<string | null>(null);
  const [ending, setEnding] = useState<EmploymentContract | null>(null);
  const [printing, setPrinting] = useState<{ c: EmploymentContract; signature: string | null } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const pdf = usePdfExport();

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      void pdf.run(`عقد-عمل-${printing.c.number}.pdf`, "تم إنشاء ملف العقد — اطبعه ليوقّع عليه الموظف.").finally(() => setPrinting(null));
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  // "Save and print": print as soon as the saved contract shows up in the list.
  useEffect(() => {
    if (!printNext) return;
    const c = contracts.find((x) => x.id === printNext);
    if (!c) return;
    setPrintNext(null);
    void print(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printNext, contracts]);

  async function print(c: EmploymentContract) {
    const sig = files.find((f) => f.kind === "signature" && f.refId === c.id);
    let signature: string | null = null;
    if (sig?.url) signature = await urlToDataUrl(sig.url).catch(() => null);
    setPrinting({ c, signature });
  }

  async function uploadScan(c: EmploymentContract, f: File) {
    setUploading(c.id);
    try {
      await uploadPrivateFile({ ownerKind: "employee", ownerId: employee.id, kind: "contract_scan", refId: c.id, file: f, fileName: f.name, replace: true });
      if (c.status === "draft" && signContract({ id: c.id, via: "scan", signedAt: isoDate(new Date()) }))
        toast.success("تم حفظ نسخة العقد الموقَّعة واعتبار العقد موقَّعًا.");
      else toast.success("تم حفظ نسخة العقد الموقَّعة.");
      onFilesChanged();
    } catch (e) {
      toast.error(errorText(e, "تعذّر رفع النسخة الموقَّعة."));
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="grid gap-3">
      {canAdd && (
        <Button className="justify-self-start" onClick={() => setEditing("new")} disabled={!employee.nationalId}>
          <Plus /> تحرير عقد عمل جديد
        </Button>
      )}
      {!employee.nationalId && <p className="text-xs text-expense">سجّل الرقم القومي للموظف في بياناته أولًا ليظهر في العقد.</p>}
      {!contracts.length && <p className="ledger-card p-8 text-center text-sm text-muted-foreground">لا توجد عقود لهذا الموظف بعد.</p>}
      {contracts.map((c) => {
        const scan = files.find((f) => f.kind === "contract_scan" && f.refId === c.id);
        return (
          <article key={c.id} className="ledger-card grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-bold">
                  {CONTRACT_TYPES[c.type]} <span className="num text-xs text-muted-foreground" dir="ltr">{c.number}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  من {dateLabel(c.startDate)} {c.endDate ? `إلى ${dateLabel(c.endDate)}` : ""} — {c.jobTitle} — {egp(c.basicSalary + c.allowances)} شهريًا
                </p>
              </div>
              <span className={cn("contract-status", c.status === "signed" ? "contract-status-signed" : c.status === "ended" ? "contract-status-ended" : "contract-status-draft")}>
                {CONTRACT_STATUS[c.status]}
              </span>
            </div>
            {c.status === "draft" && (
              <p className="rounded-md bg-copper/10 px-3 py-2 text-xs text-copper">
                اطبع العقد ليوقّع عليه الموظف بالقلم، ثم اضغط «تم توقيع الموظف» ليُسجَّل العقد ساريًا على النظام.
              </p>
            )}
            {c.status !== "draft" && (
              <p className="text-xs text-muted-foreground">
                {c.signedAt && `وُقِّع ${dateLabel(c.signedAt)} ${c.signedVia === "screen" ? "على الشاشة" : c.signedVia === "scan" ? "ورقيًا (مرفق نسخة ممسوحة)" : "ورقيًا بالقلم"}`}
                {c.status === "ended" && c.endedOn ? ` — انتهى ${dateLabel(c.endedOn)}: ${c.endReason ?? ""}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={c.status === "draft" ? "default" : "outline"} disabled={!!printing || pdf.busy} onClick={() => void print(c)}>
                {printing?.c.id === c.id ? <Loader2 className="animate-spin" /> : <Printer />} {c.status === "draft" ? "طباعة العقد للتوقيع" : "طباعة / PDF"}
              </Button>
              {scan?.url && (
                <Button size="sm" variant="outline" asChild>
                  <a href={scan.url} target="_blank" rel="noreferrer">
                    <FileDown /> النسخة الموقَّعة
                  </a>
                </Button>
              )}
              {c.status === "draft" && canAdd && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setSigning(c)}>
                    <FileCheck2 /> تم توقيع الموظف
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    <Pencil /> تعديل
                  </Button>
                </>
              )}
              {c.status === "signed" && !scan && canAdd && (
                <FilePicker label="إرفاق نسخة ممسوحة" busy={uploading === c.id} onPick={(f) => void uploadScan(c, f)} />
              )}
              {c.status === "signed" && canEdit && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEnding(c)}>
                  <XCircle /> إنهاء العقد
                </Button>
              )}
              {c.status === "draft" && canEdit && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("حذف مسودة العقد؟") && deleteContract(c.id)}>
                  <Trash2 /> حذف المسودة
                </Button>
              )}
            </div>
          </article>
        );
      })}

      <ContractDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        employee={employee}
        contract={editing === "new" ? null : editing}
        onSaved={(id, andPrint) => andPrint && setPrintNext(id)}
      />
      <PaperSignDialog contract={signing} employee={employee} onClose={() => setSigning(null)} onSigned={onFilesChanged} />
      <EndDialog contract={ending} onClose={() => setEnding(null)} />
      {printing && <ContractDocument ref={pdf.ref} db={db} contract={printing.c} employee={employee} signature={printing.signature} />}
    </div>
  );
}

/** Records that the employee signed the printed contract with a pen; attaching a scan is optional. */
function PaperSignDialog({ contract, employee, onClose, onSigned }: { contract: EmploymentContract | null; employee: Employee; onClose: () => void; onSigned: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDate(isoDate(new Date()));
    setFile(null);
  }, [contract]);
  async function confirm() {
    if (!contract) return;
    setBusy(true);
    try {
      if (file) await uploadPrivateFile({ ownerKind: "employee", ownerId: employee.id, kind: "contract_scan", refId: contract.id, file, fileName: file.name, replace: true });
      if (signContract({ id: contract.id, via: file ? "scan" : "paper", signedAt: date })) {
        toast.success(file ? "تم تسجيل العقد موقَّعًا وحفظ النسخة الممسوحة." : "تم تسجيل العقد موقَّعًا — يمكنك إرفاق نسخة ممسوحة لاحقًا.");
        onSigned();
        onClose();
      }
    } catch (e) {
      toast.error(errorText(e, "تعذّر رفع النسخة الممسوحة."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!contract} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>تسجيل توقيع {employee.name} على العقد {contract?.number}</DialogTitle>
          <DialogDescription>بعد التسجيل يصبح العقد ساريًا ولا يمكن تعديله، ويُحدَّث أجر الموظف ووظيفته وقسمه في الأجور.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FieldRow label="تاريخ التوقيع" htmlFor="sign-date">
            <Input id="sign-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldRow>
          <FieldRow label="صورة العقد الموقَّع (اختياري)" htmlFor="sign-scan">
            <Input id="sign-scan" type="file" accept={ACCEPTED_FILES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </FieldRow>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void confirm()} disabled={busy || !date}>
            {busy ? <Loader2 className="animate-spin" /> : <FileCheck2 />} تسجيل العقد موقَّعًا
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndDialog({ contract, onClose }: { contract: EmploymentContract | null; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [reason, setReason] = useState("");
  useEffect(() => {
    setDate(isoDate(new Date()));
    setReason("");
  }, [contract]);
  return (
    <Dialog open={!!contract} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>إنهاء العقد {contract?.number}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <FieldRow label="تاريخ الإنهاء" htmlFor="end-date">
            <Input id="end-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldRow>
          <FieldRow label="السبب" htmlFor="end-reason">
            <Input id="end-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="استقالة / انتهاء المدة / ..." />
          </FieldRow>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant="destructive" onClick={() => contract && endContract({ id: contract.id, endedOn: date, reason }) && onClose()}>إنهاء العقد</Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
