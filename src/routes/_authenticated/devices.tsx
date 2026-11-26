import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, BookOpenCheck, CalendarClock, ClipboardList, FileDown, Gauge, Plus, Power, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, DocInfoGrid, EmptyRow, FieldRow, FilterBar, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { RangePicker, thisYear, type Range } from "@/components/hospital/accounting/RangePicker";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import { guidesForDepartment, suggestGuide, type BuiltInGuide } from "@/lib/hospital/calibration-guides";
import {
  CALIBRATION_RESULTS,
  DEVICE_LOG_KINDS,
  DEVICE_RISK,
  DEVICE_STATUS,
  DUE_LABELS,
  deviceSchedule,
  devicesSummary,
  maintenanceCost,
  type CalibrationGuide,
  type CalibrationResult,
  type DeviceLog,
  type DeviceLogKind,
  type DeviceRisk,
  type DeviceStatus,
  type DueInfo,
  type MedicalDevice,
} from "@/lib/hospital/devices";
import {
  deleteCalibrationGuide,
  deleteDevice,
  deleteDeviceLog,
  newId,
  saveCalibrationGuide,
  saveDevice,
  saveDeviceLog,
  useCan,
  useHospitalDB,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({
    meta: [
      { title: "الأجهزة الطبية والصيانة والمعايرة | مستشفى الرحمة التخصصي" },
      { name: "description", content: "سجل كل الأجهزة الطبية لكل قسم مع الصيانة الوقائية والإصلاحية والمعايرة ومواعيدها وأدلة المعايرة الإرشادية." },
      { property: "og:title", content: "الأجهزة الطبية والصيانة والمعايرة | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "سجل الأجهزة الطبية ومواعيد الصيانة والمعايرة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevicesPage,
});

const STATUS_TONE: Record<DeviceStatus, string> = {
  working: "bg-income/15 text-income",
  maintenance: "bg-copper/15 text-copper",
  out: "bg-destructive/10 text-destructive",
  retired: "bg-muted text-muted-foreground",
};
const DUE_TONE: Record<DueInfo["state"], string> = {
  none: "text-muted-foreground",
  never: "text-copper",
  ok: "text-income",
  soon: "text-copper",
  overdue: "text-destructive font-semibold",
};
const today = () => isoDate(new Date());
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
type AnyGuide = BuiltInGuide | CalibrationGuide;
const isBuiltIn = (g: AnyGuide): g is BuiltInGuide => "departments" in g;

const newDevice = (): MedicalDevice => ({
  id: newId(),
  code: "",
  name: "",
  department: "",
  status: "working",
  risk: "medium",
  maintenanceEveryMonths: 6,
  calibrationEveryMonths: 12,
  createdAt: Date.now(),
});
const newLog = (deviceId: string, kind: DeviceLogKind = "preventive"): DeviceLog => ({
  id: newId(),
  deviceId,
  kind,
  date: today(),
  performedBy: "",
  description: "",
  cost: 0,
  createdAt: Date.now(),
});

function Due({ d }: { d: DueInfo }) {
  return (
    <div className={cn("text-xs", DUE_TONE[d.state])}>
      {DUE_LABELS[d.state]}
      {d.next && d.state !== "none" && <div className="num text-[11px] text-muted-foreground">{dateLabel(d.next)}</div>}
    </div>
  );
}

function DevicesPage() {
  const db = useHospitalDB();
  const canAdd = useCan("devices", "add");
  const canEdit = useCan("devices", "edit");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<"all" | DeviceStatus | "due">("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<Range>(thisYear);
  const [guideDept, setGuideDept] = useState("icu");
  const [editing, setEditing] = useState<MedicalDevice | null>(null);
  const [logging, setLogging] = useState<DeviceLog | null>(null);
  const [history, setHistory] = useState<MedicalDevice | null>(null);
  const [guide, setGuide] = useState<AnyGuide | null>(null);
  const [guideDraft, setGuideDraft] = useState<(CalibrationGuide & { toolsText: string; stepsText: string; acceptanceText: string }) | null>(null);
  const [printGuide, setPrintGuide] = useState<AnyGuide | null>(null);
  const registerPdf = usePdfExport();
  const cardPdf = usePdfExport();
  const guidePdf = usePdfExport();
  const now = today();
  const deptName = (id: string) => findDepartment(db.departments, id).name;
  const deviceById = useMemo(() => new Map(db.medicalDevices.map((d) => [d.id, d])), [db.medicalDevices]);

  const summary = devicesSummary(db.medicalDevices, db.deviceLogs, now);
  const rows = useMemo(() => {
    const s = q.trim();
    return db.medicalDevices
      .map((d) => ({ d, s: deviceSchedule(d, db.deviceLogs, now) }))
      .filter(({ d, s: sc }) => {
        if (dept !== "all" && d.department !== dept) return false;
        if (status === "due") {
          const late = (x: DueInfo) => x.state === "overdue" || x.state === "soon" || x.state === "never";
          if (!late(sc.maintenance) && !late(sc.calibration)) return false;
        } else if (status !== "all" && d.status !== status) return false;
        return !s || d.name.includes(s) || d.code.includes(s) || (d.serial ?? "").includes(s) || (d.brand ?? "").includes(s);
      })
      .sort((a, b) => deptName(a.d.department).localeCompare(deptName(b.d.department), "ar") || a.d.code.localeCompare(b.d.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.medicalDevices, db.deviceLogs, dept, status, q, now]);

  const logs = useMemo(
    () =>
      db.deviceLogs
        .filter((l) => l.date >= range.from && l.date <= range.to && (dept === "all" || deviceById.get(l.deviceId)?.department === dept))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [db.deviceLogs, range, dept, deviceById],
  );
  const cost = maintenanceCost(logs, range.from, range.to);
  const guides = guidesForDepartment(guideDept, db.calibrationGuides);

  function saveDev() {
    if (!editing) return;
    if (saveDevice(editing)) {
      toast.success("اتحفظ الجهاز.");
      setEditing(null);
    }
  }
  function saveLogEntry() {
    if (!logging) return;
    if (saveDeviceLog(logging)) {
      toast.success("اتسجّلت العملية على الجهاز.");
      setLogging(null);
    }
  }
  function removeDevice(d: MedicalDevice) {
    if (!window.confirm(`حذف الجهاز ${d.name} وكل سجل صيانته؟ الأفضل تغيير حالته إلى «مُكهَّن» لو خرج من الخدمة.`)) return;
    if (deleteDevice(d.id)) toast.success("اتحذف الجهاز.");
  }
  function saveGuideDraft() {
    if (!guideDraft) return;
    const { toolsText, stepsText, acceptanceText, ...g } = guideDraft;
    if (saveCalibrationGuide({ ...g, tools: lines(toolsText), steps: lines(stepsText), acceptance: lines(acceptanceText) })) {
      toast.success("اتحفظ دليل المعايرة للقسم.");
      setGuideDraft(null);
    }
  }
  function exportGuide(g: AnyGuide) {
    setPrintGuide(g);
    setTimeout(() => void guidePdf.run(`${g.title}.pdf`, "اتصدّر دليل المعايرة."), 80);
  }
  function exportCard(d: MedicalDevice) {
    setHistory(d);
    setTimeout(() => void cardPdf.run(`كارت-جهاز-${d.code}.pdf`, "اتصدّر كارت الجهاز."), 80);
  }
  const suggested = editing?.deviceType ? suggestGuide(editing.deviceType, editing.department) : undefined;
  const historyLogs = history ? db.deviceLogs.filter((l) => l.deviceId === history.id).sort((a, b) => b.date.localeCompare(a.date)) : [];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المخازن والأصول"
        title="الأجهزة الطبية والصيانة والمعايرة"
        description="سجل كل جهاز في كل قسم، وكل صيانة وقائية أو إصلاحية ومعايرة واختبار سلامة. المواعيد الجاية بتتحسب تلقائيًا من آخر عملية، والمتأخر بيظهر بالأحمر."
        actions={
          <>
            {canAdd && (
              <Button onClick={() => setEditing(newDevice())}>
                <Plus /> جهاز جديد
              </Button>
            )}
            <Button variant="outline" disabled={!rows.length || registerPdf.busy} onClick={() => registerPdf.run(`سجل-الأجهزة-الطبية-${now}.pdf`, "اتصدّر سجل الأجهزة.")}>
              <FileDown /> {registerPdf.busy ? "جارٍ التصدير..." : "سجل الأجهزة PDF"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="أجهزة في الخدمة" value={int(summary.total)} icon={Gauge} tone="primary" />
        <StatCard label="تعمل" value={int(summary.working)} icon={Power} tone="income" />
        <StatCard label="عطلانة / تحت الصيانة" value={int(summary.down)} icon={AlertTriangle} tone="expense" />
        <StatCard label="صيانة متأخرة" value={int(summary.maintenanceDue)} icon={Wrench} tone="expense" hint={`مستحق قريبًا: ${int(summary.soon)}`} />
        <StatCard label="معايرة متأخرة" value={int(summary.calibrationDue)} icon={CalendarClock} tone="copper" />
      </div>

      <Tabs defaultValue="register" dir="rtl">
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="register">سجل الأجهزة ({int(db.medicalDevices.length)})</TabsTrigger>
          <TabsTrigger value="log">سجل الصيانة والمعايرة</TabsTrigger>
          <TabsTrigger value="guides">أدلة المعايرة للأقسام</TabsTrigger>
        </TabsList>

        <TabsContent value="register">
          <FilterBar>
            <DeptSelect value={dept} onChange={setDept} allowAll className="w-52" />
            <select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
              <option value="all">كل الحالات</option>
              <option value="due">صيانة أو معايرة مستحقة</option>
              {Object.entries(DEVICE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <Input aria-label="بحث" placeholder="اسم / كود / سيريال / ماركة" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
          </FilterBar>
          <TableCard minWidth={1100}>
            <thead>
              <HeadRow>
                <Th>الكود</Th>
                <Th>الجهاز</Th>
                <Th>القسم</Th>
                <Th>الحالة</Th>
                <Th>الخطورة</Th>
                <Th>الصيانة الوقائية</Th>
                <Th>المعايرة</Th>
                <Th />
              </HeadRow>
            </thead>
            <tbody>
              {rows.map(({ d, s }) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                  <Td className="num font-semibold">{d.code}</Td>
                  <Td>
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{[d.brand, d.model, d.serial && `S/N ${d.serial}`].filter(Boolean).join(" • ")}</div>
                  </Td>
                  <Td>{deptName(d.department)}</Td>
                  <Td>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", STATUS_TONE[d.status])}>{DEVICE_STATUS[d.status]}</span>
                  </Td>
                  <Td className="text-xs">{DEVICE_RISK[d.risk]}</Td>
                  <Td><Due d={s.maintenance} /></Td>
                  <Td>
                    <Due d={s.calibration} />
                    {s.lastResult && <div className={cn("text-[11px]", s.lastResult === "fail" ? "text-destructive" : "text-muted-foreground")}>آخر نتيجة: {CALIBRATION_RESULTS[s.lastResult]}</div>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {canAdd && d.status !== "retired" && (
                        <Button size="sm" onClick={() => setLogging(newLog(d.id))}>
                          <Wrench /> تسجيل عملية
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setHistory(d)}>
                        <ClipboardList /> السجل
                      </Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ ...d })}>تعديل</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeDevice(d)}>حذف</Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {!rows.length && <EmptyRow cols={8} text={db.medicalDevices.length ? "مفيش أجهزة بالفلاتر دي." : "لسه مفيش أجهزة مسجلة — ابدأ بـ«جهاز جديد»."} />}
            </tbody>
          </TableCard>
        </TabsContent>

        <TabsContent value="log">
          <FilterBar>
            <RangePicker value={range} onChange={setRange} />
            <DeptSelect value={dept} onChange={setDept} allowAll className="w-52" />
          </FilterBar>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="عمليات الفترة" value={int(cost.count)} />
            <StatCard label="تكلفة الصيانة والمعايرة" value={money(cost.total)} hint="ج.م" tone="expense" />
            <StatCard label="أعطال (صيانة إصلاحية)" value={int(logs.filter((l) => l.kind === "corrective").length)} tone="copper" />
          </div>
          <TableCard minWidth={1000}>
            <thead>
              <HeadRow>
                <Th>التاريخ</Th>
                <Th>الجهاز</Th>
                <Th>العملية</Th>
                <Th>الوصف</Th>
                <Th>المنفذ</Th>
                <Th>النتيجة</Th>
                <Th num>التكلفة</Th>
                <Th />
              </HeadRow>
            </thead>
            <tbody>
              {logs.map((l) => {
                const d = deviceById.get(l.deviceId);
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <Td className="whitespace-nowrap">{dateLabel(l.date)}</Td>
                    <Td>{d ? <>{d.name} <span className="num text-xs text-muted-foreground">{d.code}</span></> : "—"}</Td>
                    <Td className="text-xs">{DEVICE_LOG_KINDS[l.kind]}</Td>
                    <Td className="max-w-72 text-xs">{l.description}{l.parts ? ` — قطع: ${l.parts}` : ""}</Td>
                    <Td className="text-xs">{l.performedBy}{l.company ? ` (${l.company})` : ""}</Td>
                    <Td className="text-xs">{l.result ? CALIBRATION_RESULTS[l.result] : "—"}{l.certificateNo ? ` • شهادة ${l.certificateNo}` : ""}</Td>
                    <Td num>{money(l.cost)}</Td>
                    <Td>
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setLogging({ ...l })}>تعديل</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("حذف التسجيل؟") && deleteDeviceLog(l.id) && toast.success("اتحذف التسجيل.")}>حذف</Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {!logs.length && <EmptyRow cols={8} text="مفيش عمليات صيانة أو معايرة في الفترة دي." />}
            </tbody>
          </TableCard>
        </TabsContent>

        <TabsContent value="guides" className="grid gap-4">
          <FilterBar>
            <DeptSelect value={guideDept} onChange={setGuideDept} className="w-60" />
            {canAdd && (
              <Button
                variant="outline"
                onClick={() =>
                  setGuideDraft({ id: newId(), department: guideDept, deviceType: "", title: "", interval: "", tools: [], steps: [], acceptance: [], createdAt: Date.now(), toolsText: "", stepsText: "", acceptanceText: "" })
                }
              >
                <Plus /> دليل خاص بالقسم
              </Button>
            )}
          </FilterBar>
          <p className="text-xs text-muted-foreground">الأدلة الجاهزة إرشادية — دليل الشركة المصنّعة واللوائح المحلية لها الأولوية، ومهندس الأجهزة يحدد حدود القبول.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {guides.map((g) => (
              <div key={g.id} className="ledger-card flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{g.title}</p>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", isBuiltIn(g) ? "bg-primary/10 text-primary" : "bg-copper/15 text-copper")}>
                    {isBuiltIn(g) ? "جاهز" : "خاص بالقسم"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{g.deviceType} • {g.interval}</p>
                {g.standard && <p className="text-[11px] text-muted-foreground" dir="ltr">{g.standard}</p>}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <Button size="sm" onClick={() => setGuide(g)}>
                    <BookOpenCheck /> عرض الدليل
                  </Button>
                  <Button size="sm" variant="outline" disabled={guidePdf.busy} onClick={() => exportGuide(g)}>
                    <FileDown /> PDF
                  </Button>
                  {!isBuiltIn(g) && canEdit && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("حذف الدليل؟") && deleteCalibrationGuide(g.id) && toast.success("اتحذف الدليل.")}>
                      حذف
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!guides.length && <p className="ledger-card p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">مفيش أدلة لهذا القسم — أضف دليل خاص بالقسم.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {/* Device form */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing && db.medicalDevices.some((d) => d.id === editing.id) ? `تعديل ${editing.name}` : "جهاز طبي جديد"}</DialogTitle>
            <DialogDescription>الكود بيتعمل تلقائيًا لو سبته فاضي. فترات الصيانة والمعايرة بالشهور (صفر = غير مطلوب).</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-3">
              <FieldRow label="اسم الجهاز" htmlFor="dv-name" className="sm:col-span-2">
                <Input id="dv-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </FieldRow>
              <FieldRow label="الكود" htmlFor="dv-code">
                <Input id="dv-code" dir="ltr" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="تلقائي" />
              </FieldRow>
              <FieldRow label="القسم">
                <DeptSelect value={editing.department} onChange={(v) => setEditing({ ...editing, department: v })} />
              </FieldRow>
              <FieldRow label="نوع الجهاز (للدليل)" htmlFor="dv-type">
                <Input id="dv-type" value={editing.deviceType ?? ""} onChange={(e) => setEditing({ ...editing, deviceType: e.target.value })} placeholder="مثال: جهاز تنفس صناعي" />
              </FieldRow>
              <FieldRow label="المكان" htmlFor="dv-loc">
                <Input id="dv-loc" value={editing.location ?? ""} onChange={(e) => setEditing({ ...editing, location: e.target.value })} placeholder="مثال: سرير 3" />
              </FieldRow>
              {suggested && <p className="rounded-md bg-primary/10 p-2 text-xs text-primary sm:col-span-3">الدليل المقترح: {suggested.title} — {suggested.interval}</p>}
              <FieldRow label="الماركة" htmlFor="dv-brand">
                <Input id="dv-brand" value={editing.brand ?? ""} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} />
              </FieldRow>
              <FieldRow label="الموديل" htmlFor="dv-model">
                <Input id="dv-model" dir="ltr" value={editing.model ?? ""} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
              </FieldRow>
              <FieldRow label="الرقم المسلسل" htmlFor="dv-serial">
                <Input id="dv-serial" dir="ltr" value={editing.serial ?? ""} onChange={(e) => setEditing({ ...editing, serial: e.target.value })} />
              </FieldRow>
              <FieldRow label="الحالة">
                <select aria-label="حالة الجهاز" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as DeviceStatus })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                  {Object.entries(DEVICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="درجة الخطورة">
                <select aria-label="درجة الخطورة" value={editing.risk} onChange={(e) => setEditing({ ...editing, risk: e.target.value as DeviceRisk })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                  {Object.entries(DEVICE_RISK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="التكلفة (ج.م)" htmlFor="dv-cost">
                <Input id="dv-cost" type="number" min={0} value={editing.cost ?? ""} onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) || undefined })} />
              </FieldRow>
              <FieldRow label="صيانة وقائية كل (شهر)" htmlFor="dv-pm">
                <Input id="dv-pm" type="number" min={0} max={120} value={editing.maintenanceEveryMonths} onChange={(e) => setEditing({ ...editing, maintenanceEveryMonths: Number(e.target.value) || 0 })} />
              </FieldRow>
              <FieldRow label="معايرة كل (شهر)" htmlFor="dv-cal">
                <Input id="dv-cal" type="number" min={0} max={120} value={editing.calibrationEveryMonths} onChange={(e) => setEditing({ ...editing, calibrationEveryMonths: Number(e.target.value) || 0 })} />
              </FieldRow>
              <FieldRow label="تاريخ التركيب" htmlFor="dv-inst">
                <Input id="dv-inst" type="date" value={editing.installDate ?? ""} onChange={(e) => setEditing({ ...editing, installDate: e.target.value || undefined })} />
              </FieldRow>
              <FieldRow label="تاريخ الشراء" htmlFor="dv-buy">
                <Input id="dv-buy" type="date" value={editing.purchaseDate ?? ""} onChange={(e) => setEditing({ ...editing, purchaseDate: e.target.value || undefined })} />
              </FieldRow>
              <FieldRow label="نهاية الضمان" htmlFor="dv-war">
                <Input id="dv-war" type="date" value={editing.warrantyEnd ?? ""} onChange={(e) => setEditing({ ...editing, warrantyEnd: e.target.value || undefined })} />
              </FieldRow>
              <FieldRow label="المورد" htmlFor="dv-sup">
                <Input id="dv-sup" value={editing.supplier ?? ""} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} />
              </FieldRow>
              <FieldRow label="شركة الصيانة" htmlFor="dv-svc">
                <Input id="dv-svc" value={editing.serviceCompany ?? ""} onChange={(e) => setEditing({ ...editing, serviceCompany: e.target.value })} />
              </FieldRow>
              <FieldRow label="تليفون الصيانة" htmlFor="dv-ph">
                <Input id="dv-ph" dir="ltr" value={editing.servicePhone ?? ""} onChange={(e) => setEditing({ ...editing, servicePhone: e.target.value })} />
              </FieldRow>
              <FieldRow label="نهاية عقد الصيانة" htmlFor="dv-ce">
                <Input id="dv-ce" type="date" value={editing.contractEnd ?? ""} onChange={(e) => setEditing({ ...editing, contractEnd: e.target.value || undefined })} />
              </FieldRow>
              <FieldRow label="ملاحظات" htmlFor="dv-notes" className="sm:col-span-2">
                <Input id="dv-notes" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={saveDev}>حفظ الجهاز</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance / calibration entry */}
      <Dialog open={!!logging} onOpenChange={(o) => !o && setLogging(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تسجيل عملية على {logging ? deviceById.get(logging.deviceId)?.name : ""}</DialogTitle>
            <DialogDescription>الموعد الجاي بيتحسب من فترة الجهاز، أو اكتبه بنفسك.</DialogDescription>
          </DialogHeader>
          {logging && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="نوع العملية">
                <select aria-label="نوع العملية" value={logging.kind} onChange={(e) => setLogging({ ...logging, kind: e.target.value as DeviceLogKind })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                  {Object.entries(DEVICE_LOG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="التاريخ" htmlFor="lg-date">
                <Input id="lg-date" type="date" max={now} value={logging.date} onChange={(e) => setLogging({ ...logging, date: e.target.value })} />
              </FieldRow>
              <FieldRow label="المهندس / الفني" htmlFor="lg-by">
                <Input id="lg-by" value={logging.performedBy} onChange={(e) => setLogging({ ...logging, performedBy: e.target.value })} />
              </FieldRow>
              <FieldRow label="الشركة" htmlFor="lg-co">
                <Input id="lg-co" value={logging.company ?? ""} onChange={(e) => setLogging({ ...logging, company: e.target.value })} />
              </FieldRow>
              <FieldRow label="وصف العمل" htmlFor="lg-desc" className="sm:col-span-2">
                <Textarea id="lg-desc" rows={2} value={logging.description} onChange={(e) => setLogging({ ...logging, description: e.target.value })} />
              </FieldRow>
              {(logging.kind === "calibration" || logging.kind === "safety") && (
                <>
                  <FieldRow label="النتيجة">
                    <select aria-label="النتيجة" value={logging.result ?? ""} onChange={(e) => setLogging({ ...logging, result: (e.target.value || undefined) as CalibrationResult | undefined })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                      <option value="">اختر النتيجة</option>
                      {Object.entries(CALIBRATION_RESULTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label="رقم الشهادة" htmlFor="lg-cert">
                    <Input id="lg-cert" dir="ltr" value={logging.certificateNo ?? ""} onChange={(e) => setLogging({ ...logging, certificateNo: e.target.value })} />
                  </FieldRow>
                </>
              )}
              <FieldRow label="قطع الغيار" htmlFor="lg-parts">
                <Input id="lg-parts" value={logging.parts ?? ""} onChange={(e) => setLogging({ ...logging, parts: e.target.value })} />
              </FieldRow>
              <FieldRow label="التكلفة (ج.م)" htmlFor="lg-cost">
                <Input id="lg-cost" type="number" min={0} value={logging.cost || ""} onChange={(e) => setLogging({ ...logging, cost: Number(e.target.value) || 0 })} />
              </FieldRow>
              <FieldRow label="ساعات التوقف" htmlFor="lg-down">
                <Input id="lg-down" type="number" min={0} value={logging.downtimeHours ?? ""} onChange={(e) => setLogging({ ...logging, downtimeHours: Number(e.target.value) || undefined })} />
              </FieldRow>
              <FieldRow label="الموعد القادم (اختياري)" htmlFor="lg-next">
                <Input id="lg-next" type="date" value={logging.nextDue ?? ""} onChange={(e) => setLogging({ ...logging, nextDue: e.target.value || undefined })} />
              </FieldRow>
              <FieldRow label="حالة الجهاز بعد العملية">
                <select aria-label="حالة الجهاز بعد العملية" value={logging.statusAfter ?? ""} onChange={(e) => setLogging({ ...logging, statusAfter: (e.target.value || undefined) as DeviceStatus | undefined })} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">بدون تغيير</option>
                  {Object.entries(DEVICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogging(null)}>إلغاء</Button>
            <Button onClick={saveLogEntry}>حفظ العملية</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Device history */}
      <Dialog open={!!history && !cardPdf.busy} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>سجل {history?.name} <span className="num text-muted-foreground">{history?.code}</span></DialogTitle>
            <DialogDescription>{history ? `${deptName(history.department)} • ${DEVICE_STATUS[history.status]}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {historyLogs.map((l) => (
              <div key={l.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <b>{DEVICE_LOG_KINDS[l.kind]}</b>
                  <span className="text-xs text-muted-foreground">{dateLabel(l.date)} • {l.performedBy}{l.cost ? ` • ${egp(l.cost)}` : ""}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{l.description}</p>
                {l.result && <p className="text-xs">النتيجة: {CALIBRATION_RESULTS[l.result]}</p>}
              </div>
            ))}
            {!historyLogs.length && <p className="py-8 text-center text-sm text-muted-foreground">مفيش عمليات مسجلة على الجهاز ده لسه.</p>}
          </div>
          <DialogFooter>
            {history && (
              <Button variant="outline" onClick={() => exportCard(history)}>
                <FileDown /> كارت الجهاز PDF
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guide view */}
      <Dialog open={!!guide} onOpenChange={(o) => !o && setGuide(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{guide?.title}</DialogTitle>
            <DialogDescription>{guide ? `${guide.deviceType} • ${guide.interval}` : ""}</DialogDescription>
          </DialogHeader>
          {guide && <GuideBody g={guide} />}
        </DialogContent>
      </Dialog>

      {/* Custom guide form */}
      <Dialog open={!!guideDraft} onOpenChange={(o) => !o && setGuideDraft(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>دليل معايرة خاص بالقسم</DialogTitle>
            <DialogDescription>كل سطر في الأدوات والخطوات وحدود القبول = بند مستقل.</DialogDescription>
          </DialogHeader>
          {guideDraft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="القسم">
                <DeptSelect value={guideDraft.department} onChange={(v) => setGuideDraft({ ...guideDraft, department: v })} />
              </FieldRow>
              <FieldRow label="نوع الجهاز" htmlFor="gd-type">
                <Input id="gd-type" value={guideDraft.deviceType} onChange={(e) => setGuideDraft({ ...guideDraft, deviceType: e.target.value })} />
              </FieldRow>
              <FieldRow label="عنوان الدليل" htmlFor="gd-title" className="sm:col-span-2">
                <Input id="gd-title" value={guideDraft.title} onChange={(e) => setGuideDraft({ ...guideDraft, title: e.target.value })} />
              </FieldRow>
              <FieldRow label="التكرار" htmlFor="gd-int">
                <Input id="gd-int" value={guideDraft.interval} onChange={(e) => setGuideDraft({ ...guideDraft, interval: e.target.value })} placeholder="مثال: كل 12 شهر" />
              </FieldRow>
              <FieldRow label="المعيار" htmlFor="gd-std">
                <Input id="gd-std" dir="ltr" value={guideDraft.standard ?? ""} onChange={(e) => setGuideDraft({ ...guideDraft, standard: e.target.value })} />
              </FieldRow>
              <FieldRow label="الأدوات" htmlFor="gd-tools" className="sm:col-span-2">
                <Textarea id="gd-tools" rows={3} value={guideDraft.toolsText} onChange={(e) => setGuideDraft({ ...guideDraft, toolsText: e.target.value })} />
              </FieldRow>
              <FieldRow label="خطوات المعايرة" htmlFor="gd-steps" className="sm:col-span-2">
                <Textarea id="gd-steps" rows={5} value={guideDraft.stepsText} onChange={(e) => setGuideDraft({ ...guideDraft, stepsText: e.target.value })} />
              </FieldRow>
              <FieldRow label="حدود القبول" htmlFor="gd-acc" className="sm:col-span-2">
                <Textarea id="gd-acc" rows={3} value={guideDraft.acceptanceText} onChange={(e) => setGuideDraft({ ...guideDraft, acceptanceText: e.target.value })} />
              </FieldRow>
              <FieldRow label="ملاحظات" htmlFor="gd-notes" className="sm:col-span-2">
                <Input id="gd-notes" value={guideDraft.notes ?? ""} onChange={(e) => setGuideDraft({ ...guideDraft, notes: e.target.value })} />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuideDraft(null)}>إلغاء</Button>
            <Button onClick={saveGuideDraft}>حفظ الدليل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Printable: device register */}
      <OfficialDocument ref={registerPdf.ref} settings={db.settings} title="سجل الأجهزة الطبية ومواعيد الصيانة والمعايرة" subtitle={dept === "all" ? "كل الأقسام" : deptName(dept)} issuedOn={dateLabel(now)} orientation="landscape">
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>الكود</th><th>الجهاز</th><th>القسم</th><th>السيريال</th><th>الحالة</th><th>الصيانة القادمة</th><th>المعايرة القادمة</th><th>آخر نتيجة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, s }) => (
              <tr key={d.id} data-pdf-break>
                <td>{d.code}</td>
                <td className="text-start">{d.name}</td>
                <td>{deptName(d.department)}</td>
                <td>{d.serial || "—"}</td>
                <td>{DEVICE_STATUS[d.status]}</td>
                <td>{DUE_LABELS[s.maintenance.state]}{s.maintenance.next ? ` — ${dateLabel(s.maintenance.next)}` : ""}</td>
                <td>{DUE_LABELS[s.calibration.state]}{s.calibration.next ? ` — ${dateLabel(s.calibration.next)}` : ""}</td>
                <td>{s.lastResult ? CALIBRATION_RESULTS[s.lastResult] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <SignatureBlock roles={["مهندس الأجهزة الطبية", "رئيس القسم", "المدير الطبي"]} />
      </OfficialDocument>

      {/* Printable: device card */}
      {history && (
        <OfficialDocument ref={cardPdf.ref} settings={db.settings} title={`كارت جهاز: ${history.name}`} subtitle={deptName(history.department)} issuedOn={dateLabel(now)}>
          <DocInfoGrid
            items={[
              ["الكود", history.code],
              ["الحالة", DEVICE_STATUS[history.status]],
              ["الماركة / الموديل", [history.brand, history.model].filter(Boolean).join(" / ") || "—"],
              ["الرقم المسلسل", history.serial || "—"],
              ["تاريخ التركيب", history.installDate ? dateLabel(history.installDate) : "—"],
              ["نهاية الضمان", history.warrantyEnd ? dateLabel(history.warrantyEnd) : "—"],
              ["شركة الصيانة", history.serviceCompany || "—"],
              ["الخطورة", DEVICE_RISK[history.risk]],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break><th>التاريخ</th><th>العملية</th><th>الوصف</th><th>المنفذ</th><th>النتيجة</th><th>التكلفة</th></tr>
            </thead>
            <tbody>
              {historyLogs.map((l) => (
                <tr key={l.id} data-pdf-break>
                  <td>{dateLabel(l.date)}</td><td>{DEVICE_LOG_KINDS[l.kind]}</td><td className="text-start">{l.description}</td><td>{l.performedBy}</td><td>{l.result ? CALIBRATION_RESULTS[l.result] : "—"}</td><td>{money(l.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SignatureBlock roles={["مهندس الأجهزة الطبية", "رئيس القسم"]} />
        </OfficialDocument>
      )}

      {/* Printable: calibration guide */}
      {printGuide && (
        <OfficialDocument ref={guidePdf.ref} settings={db.settings} title={printGuide.title} subtitle={`${printGuide.deviceType} — ${printGuide.interval}`} issuedOn={dateLabel(now)}>
          <GuideBody g={printGuide} doc />
          <SignatureBlock roles={["مهندس الأجهزة الطبية", "رئيس القسم"]} />
        </OfficialDocument>
      )}
    </div>
  );
}

function GuideBody({ g, doc }: { g: AnyGuide; doc?: boolean }) {
  const block = (title: string, items: string[], ordered = false) =>
    items.length ? (
      <section data-pdf-break className={doc ? undefined : "grid gap-1"} style={doc ? { marginBottom: 10, fontSize: 12.5 } : undefined}>
        <p className={doc ? undefined : "text-sm font-bold"} style={doc ? { fontWeight: 700 } : undefined}>{title}</p>
        {ordered ? (
          <ol className={doc ? undefined : "list-decimal space-y-1 ps-5 text-sm"} style={doc ? { paddingInlineStart: 20 } : undefined}>
            {items.map((x, i) => <li key={i}>{x}</li>)}
          </ol>
        ) : (
          <ul className={doc ? undefined : "list-disc space-y-1 ps-5 text-sm"} style={doc ? { paddingInlineStart: 20 } : undefined}>
            {items.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        )}
      </section>
    ) : null;
  return (
    <div className={doc ? undefined : "grid gap-3"}>
      {g.standard && <p data-pdf-break className={doc ? undefined : "text-xs text-muted-foreground"} dir="ltr" style={doc ? { fontSize: 12 } : undefined}>{g.standard}</p>}
      {block("الأدوات المطلوبة", g.tools)}
      {block("خطوات الفحص والمعايرة", g.steps, true)}
      {block("حدود القبول", g.acceptance)}
      {g.notes && <p data-pdf-break className={doc ? undefined : "rounded-md bg-copper/10 p-2 text-xs text-copper"} style={doc ? { fontSize: 11.5 } : undefined}>{g.notes}</p>}
    </div>
  );
}
