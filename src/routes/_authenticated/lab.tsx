import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileDown, FlaskConical, Hourglass, Plus, TestTubes, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DocInfoGrid, EmptyRow, FieldRow, FilterBar, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { PatientPicker, type PickedPatient } from "@/components/hospital/medical/PatientPicker";
import { dateLabel, int, isoDate } from "@/lib/hospital/format";
import { useCan, useHospitalDB } from "@/lib/hospital/store";
import { errorText } from "@/lib/hospital/upload";
import { listLabOrders, saveLabOrder } from "@/lib/medical/medical.functions";
import { LAB_PRESETS, LAB_STATUS, labFlag, type LabOrder, type LabStatus, type LabTest } from "@/lib/medical/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/lab")({
  head: () => ({
    meta: [
      { title: "طلبات ونتائج المعمل | مستشفى الرحمة التخصصي" },
      { name: "description", content: "طلبات التحاليل لكل مريض، تسجيل النتائج مع المعدلات الطبيعية، وطباعة تقرير النتيجة." },
      { property: "og:title", content: "طلبات ونتائج المعمل | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "طلبات التحاليل والنتائج وطباعتها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LabPage,
});

const STATUS_TONE: Record<LabStatus, string> = {
  ordered: "bg-primary/10 text-primary",
  in_progress: "bg-copper/15 text-copper",
  done: "bg-income/15 text-income",
  cancelled: "bg-muted text-muted-foreground",
};
const FLAG: Record<"low" | "high" | "normal", [string, string]> = {
  low: ["منخفض", "text-destructive font-bold"],
  high: ["مرتفع", "text-destructive font-bold"],
  normal: ["طبيعي", "text-income"],
};
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—");

interface Draft {
  id?: string;
  orderNo?: string;
  patient: PickedPatient | null;
  doctorId: string;
  tests: LabTest[];
  notes: string;
  status?: LabStatus;
}

function LabPage() {
  const db = useHospitalDB();
  const qc = useQueryClient();
  const canAdd = useCan("lab", "add");
  const canEdit = useCan("lab", "edit");
  const [range, setRange] = useState<Range>(thisMonth);
  const [status, setStatus] = useState<"all" | LabStatus>("all");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"order" | "results">("order");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState<LabOrder | null>(null);
  const pdf = usePdfExport();
  const from = new Date(`${range.from}T00:00:00`).toISOString();
  const toD = new Date(`${range.to}T00:00:00`);
  toD.setDate(toD.getDate() + 1);
  const to = toD.toISOString();
  const list = useQuery({
    queryKey: ["lab-orders", from, to, status],
    queryFn: () => listLabOrders({ data: { status, from, to } }),
    placeholderData: keepPreviousData,
  });
  const all = list.data ?? [];
  const s = q.trim();
  const rows = all.filter((o) => !s || o.patientName.includes(s) || o.patientMrn.includes(s) || o.orderNo.includes(s));
  const doctor = (id: string | null) => (id ? db.doctors.find((d) => d.id === id)?.name : undefined);
  const count = (st: LabStatus) => all.filter((o) => o.status === st).length;

  function startNew() {
    setMode("order");
    setDraft({ patient: null, doctorId: "", tests: [], notes: "" });
  }
  function open(o: LabOrder, m: "order" | "results") {
    setMode(m);
    setDraft({
      id: o.id,
      orderNo: o.orderNo,
      patient: { id: o.patientId, mrn: o.patientMrn, fullName: o.patientName, phone: null },
      doctorId: o.doctorId ?? "",
      tests: o.tests.map((t) => ({ ...t })),
      notes: o.notes ?? "",
      status: o.status,
    });
  }
  const setTest = (i: number, p: Partial<LabTest>) => draft && setDraft({ ...draft, tests: draft.tests.map((t, k) => (k === i ? { ...t, ...p } : t)) });
  const hasTest = (name: string) => !!draft?.tests.some((t) => t.name === name);

  async function save(cancel = false) {
    if (!draft) return;
    if (!draft.patient) {
      toast.error("اختر ملف المريض.");
      return;
    }
    const tests = draft.tests.filter((t) => t.name.trim());
    if (!tests.length) {
      toast.error("اختر تحليل واحد على الأقل.");
      return;
    }
    setSaving(true);
    try {
      const r = await saveLabOrder({
        data: {
          id: draft.id,
          patientId: draft.patient.id,
          doctorId: draft.doctorId || null,
          tests: tests.map((t) => ({ name: t.name.trim(), result: t.result.trim(), unit: t.unit.trim(), range: t.range.trim() })),
          notes: draft.notes.trim() || null,
          status: cancel ? "cancelled" : draft.status === "cancelled" ? "ordered" : draft.status,
        },
      });
      toast.success(cancel ? "اتلغى الطلب." : r.status === "done" ? `النتيجة جاهزة — ${r.orderNo}` : `اتحفظ الطلب ${r.orderNo}.`);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["lab-orders"] });
    } catch (e) {
      toast.error(errorText(e, "تعذّر حفظ طلب التحليل."));
    } finally {
      setSaving(false);
    }
  }
  function printResult(o: LabOrder) {
    setPrinting(o);
    setTimeout(() => void pdf.run(`نتيجة-تحليل-${o.orderNo}.pdf`, "تقرير النتيجة جاهز."), 80);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الملف الطبي"
        title="طلبات ونتائج المعمل"
        description="سجّل طلب التحاليل للمريض، واكتب النتائج أول بأول — النتيجة خارج المعدل الطبيعي بتظهر بالأحمر. الطلب بيبقى «النتيجة جاهزة» لما كل التحاليل تتكتب."
        actions={
          canAdd && (
            <Button onClick={startNew}>
              <Plus /> طلب تحليل جديد
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="طلبات الفترة" value={int(all.length)} icon={TestTubes} tone="primary" />
        <StatCard label="مطلوب" value={int(count("ordered"))} icon={FlaskConical} />
        <StatCard label="جارٍ التحليل" value={int(count("in_progress"))} icon={Hourglass} tone="copper" />
        <StatCard label="النتيجة جاهزة" value={int(count("done"))} tone="income" />
      </div>

      <FilterBar>
        <RangePicker value={range} onChange={setRange} />
        <select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
          <option value="all">كل الحالات</option>
          {Object.entries(LAB_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Input aria-label="بحث" placeholder="اسم المريض / رقم الملف / رقم الطلب" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
      </FilterBar>

      <TableCard minWidth={980}>
        <thead>
          <HeadRow>
            <Th>رقم الطلب</Th>
            <Th>التاريخ</Th>
            <Th>المريض</Th>
            <Th>الطبيب</Th>
            <Th>التحاليل</Th>
            <Th>الحالة</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((o) => {
            const abnormal = o.tests.filter((t) => {
              const f = labFlag(t.result, t.range);
              return f === "low" || f === "high";
            }).length;
            return (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/30">
                <Td className="num font-semibold">{o.orderNo}</Td>
                <Td className="text-xs whitespace-nowrap">{stamp(o.orderedAt)}</Td>
                <Td>
                  <div className="font-semibold">{o.patientName}</div>
                  <div className="num text-xs text-muted-foreground">{o.patientMrn}</div>
                </Td>
                <Td>{doctor(o.doctorId) ? `د. ${doctor(o.doctorId)}` : "—"}</Td>
                <Td className="max-w-72 text-xs">
                  {o.tests.map((t) => t.name).join("، ")}
                  {abnormal > 0 && <div className="font-semibold text-destructive">{int(abnormal)} نتيجة خارج الطبيعي</div>}
                </Td>
                <Td>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", STATUS_TONE[o.status])}>{LAB_STATUS[o.status]}</span>
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canEdit && o.status !== "cancelled" && o.status !== "done" && <Button size="sm" onClick={() => open(o, "results")}>إدخال النتائج</Button>}
                    {canEdit && o.status === "done" && <Button size="sm" variant="ghost" onClick={() => open(o, "results")}>تعديل النتائج</Button>}
                    {o.status !== "cancelled" && (
                      <Button size="sm" variant="outline" disabled={pdf.busy} onClick={() => printResult(o)}>
                        <FileDown /> {o.status === "done" ? "تقرير النتيجة" : "طباعة الطلب"}
                      </Button>
                    )}
                    {canEdit && o.status === "ordered" && <Button size="sm" variant="ghost" onClick={() => open(o, "order")}>تعديل الطلب</Button>}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={7} text={list.isLoading ? "جارٍ التحميل..." : list.isError ? errorText(list.error, "تعذّر تحميل الطلبات.") : "مفيش طلبات تحاليل في الفترة دي."} />}
        </tbody>
      </TableCard>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{mode === "results" ? `نتائج الطلب ${draft?.orderNo ?? ""}` : draft?.id ? `تعديل الطلب ${draft.orderNo ?? ""}` : "طلب تحليل جديد"}</DialogTitle>
            <DialogDescription>{mode === "results" ? `${draft?.patient?.fullName ?? ""} — اكتب النتيجة جنب كل تحليل.` : "اختر المريض والتحاليل المطلوبة."}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              {mode === "order" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldRow label="المريض">
                      <PatientPicker value={draft.patient} onChange={(patient) => setDraft({ ...draft, patient })} section="lab" />
                    </FieldRow>
                    <FieldRow label="الطبيب الطالب">
                      <select aria-label="الطبيب الطالب" value={draft.doctorId} onChange={(e) => setDraft({ ...draft, doctorId: e.target.value })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                        <option value="">بدون طبيب محدد</option>
                        {db.doctors.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>د. {d.name} — {d.specialty}</option>)}
                      </select>
                    </FieldRow>
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold">تحاليل شائعة</p>
                    <div className="flex flex-wrap gap-1.5">
                      {LAB_PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          aria-pressed={hasTest(p.name)}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              tests: hasTest(p.name) ? draft.tests.filter((t) => t.name !== p.name) : [...draft.tests, { ...p, result: "" }],
                            })
                          }
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                            hasTest(p.name) ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                          )}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-secondary/60 text-xs">
                      <th className="p-2 text-right">التحليل</th>
                      {mode === "results" && <th className="p-2 text-right">النتيجة</th>}
                      <th className="p-2 text-right">الوحدة</th>
                      <th className="p-2 text-right">المعدل الطبيعي</th>
                      {mode === "results" && <th className="p-2 text-right">التقييم</th>}
                      {mode === "order" && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.tests.map((t, i) => {
                      const f = labFlag(t.result, t.range);
                      return (
                        <tr key={i} className="border-t">
                          <td className="p-1"><Input aria-label={`اسم التحليل ${i + 1}`} value={t.name} disabled={mode === "results"} onChange={(e) => setTest(i, { name: e.target.value })} /></td>
                          {mode === "results" && (
                            <td className="w-32 p-1"><Input aria-label={`نتيجة ${t.name}`} dir="ltr" value={t.result} onChange={(e) => setTest(i, { result: e.target.value })} /></td>
                          )}
                          <td className="w-28 p-1"><Input aria-label={`وحدة ${t.name}`} dir="ltr" value={t.unit} onChange={(e) => setTest(i, { unit: e.target.value })} /></td>
                          <td className="w-32 p-1"><Input aria-label={`المعدل الطبيعي ${t.name}`} dir="ltr" value={t.range} onChange={(e) => setTest(i, { range: e.target.value })} /></td>
                          {mode === "results" && <td className={cn("w-20 p-1 text-xs", f && FLAG[f][1])}>{f ? FLAG[f][0] : "—"}</td>}
                          {mode === "order" && (
                            <td className="w-10 p-1">
                              <Button type="button" size="icon" variant="ghost" aria-label="حذف التحليل" onClick={() => setDraft({ ...draft, tests: draft.tests.filter((_, k) => k !== i) })}>
                                <Trash2 />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {!draft.tests.length && (
                      <tr><td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">اختر من التحاليل الشائعة أو أضف تحليل آخر.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {mode === "order" && (
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setDraft({ ...draft, tests: [...draft.tests, { name: "", result: "", unit: "", range: "" }] })}>
                  <Plus /> تحليل آخر
                </Button>
              )}
              <FieldRow label="ملاحظات" htmlFor="lb-notes">
                <Textarea id="lb-notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </FieldRow>
            </div>
          )}
          <DialogFooter className="gap-2">
            {draft?.id && canEdit && draft.status !== "done" && (
              <Button variant="outline" className="text-destructive" disabled={saving} onClick={() => window.confirm("إلغاء طلب التحليل؟") && void save(true)}>
                إلغاء الطلب
              </Button>
            )}
            <Button variant="outline" onClick={() => setDraft(null)}>إغلاق</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? "جارٍ الحفظ..." : mode === "results" ? "حفظ النتائج" : "حفظ الطلب"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printing && (
        <OfficialDocument
          ref={pdf.ref}
          settings={db.settings}
          title={printing.status === "done" ? "تقرير نتيجة تحاليل" : "طلب تحاليل معملية"}
          subtitle={`رقم ${printing.orderNo}`}
          issuedOn={dateLabel(isoDate(new Date()))}
        >
          <DocInfoGrid
            items={[
              ["اسم المريض", printing.patientName],
              ["رقم الملف", printing.patientMrn],
              ["الطبيب الطالب", doctor(printing.doctorId) ? `د. ${doctor(printing.doctorId)}` : "—"],
              ["تاريخ الطلب", stamp(printing.orderedAt)],
              ["تاريخ النتيجة", stamp(printing.resultAt)],
              ["الحالة", LAB_STATUS[printing.status]],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break><th>التحليل</th><th>النتيجة</th><th>الوحدة</th><th>المعدل الطبيعي</th><th>التقييم</th></tr>
            </thead>
            <tbody>
              {printing.tests.map((t, i) => {
                const f = labFlag(t.result, t.range);
                return (
                  <tr key={i} data-pdf-break>
                    <td className="text-start">{t.name}</td>
                    <td style={f === "low" || f === "high" ? { fontWeight: 700 } : undefined}>{t.result || "........"}</td>
                    <td>{t.unit}</td>
                    <td>{t.range}</td>
                    <td>{f ? FLAG[f][0] : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {printing.notes && <p data-pdf-break style={{ fontSize: 12.5, marginTop: 8 }}>ملاحظات: {printing.notes}</p>}
          <SignatureBlock roles={["أخصائي المعمل", "مدير المعمل"]} />
        </OfficialDocument>
      )}
    </div>
  );
}
