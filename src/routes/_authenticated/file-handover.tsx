import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, FileDown, FileSpreadsheet, FileStack, Hourglass, Plus, Printer, SearchX, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, DocInfoGrid, EmptyRow, FieldRow, FilterBar, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate } from "@/lib/hospital/format";
import { downloadCsv } from "@/lib/hospital/csv";
import {
  FILE_TYPES,
  HANDOVER_PURPOSES,
  HANDOVER_STATUS,
  handoverTotals,
  patientTrail,
  receiveStatus,
  type FileHandover,
  type HandoverItem,
  type HandoverStatus,
} from "@/lib/hospital/handover";
import { deleteFileHandover, newId, receiveFileHandover, saveFileHandover, useCan, useHospitalDB, useHospitalSession } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/file-handover")({
  head: () => ({
    meta: [
      { title: "سركي تسليم ملفات المرضى بين الأقسام | مستشفى الرحمة التخصصي" },
      { name: "description", content: "تسليم واستلام ملفات المرضى بين كل أقسام المستشفى بسركي مطبوع وتتبع مكان كل ملف." },
      { property: "og:title", content: "سركي تسليم ملفات المرضى | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "سجل تسليم واستلام ملفات المرضى وتتبع حركتها بين الأقسام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FileHandoverPage,
});

const newItem = (): HandoverItem => ({ patientName: "", mrn: "", fileType: FILE_TYPES[0]!, notes: "" });
const STATUS_TONE: Record<HandoverStatus, string> = {
  sent: "bg-copper/15 text-copper",
  received: "bg-income/15 text-income",
  partial: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
};
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const stamp = (ms?: number) => (ms ? new Date(ms).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—");

function StatusPill({ status }: { status: HandoverStatus }) {
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", STATUS_TONE[status])}>{HANDOVER_STATUS[status]}</span>;
}

function FileHandoverPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("fileHandover", "add");
  const canEdit = useCan("fileHandover", "edit");
  const sheetPdf = usePdfExport();
  const reportPdf = usePdfExport();
  const [range, setRange] = useState<Range>(thisMonth);
  const [from, setFrom] = useState("all");
  const [to, setTo] = useState("all");
  const [status, setStatus] = useState<"all" | HandoverStatus>("all");
  const [search, setSearch] = useState("");
  const [trailQuery, setTrailQuery] = useState("");
  const [draft, setDraft] = useState<FileHandover | null>(null);
  const [receiving, setReceiving] = useState<FileHandover | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [receiver, setReceiver] = useState("");
  const [receiveNote, setReceiveNote] = useState("");
  const [printing, setPrinting] = useState<FileHandover | null>(null);
  const dept = (id: string) => findDepartment(db.departments, id).name;

  const filtered = useMemo(() => {
    const q = search.trim();
    return db.fileHandovers
      .filter(
        (h) =>
          h.date >= range.from &&
          h.date <= range.to &&
          (from === "all" || h.fromDept === from) &&
          (to === "all" || h.toDept === to) &&
          (status === "all" || h.status === status) &&
          (!q || h.number.includes(q) || h.items.some((it) => it.patientName.includes(q) || it.mrn === q)),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt - a.createdAt);
  }, [db.fileHandovers, range, from, to, status, search]);
  const totals = handoverTotals(filtered);
  // Waiting batches are shown whatever their date, so nothing sent is forgotten.
  const incoming = db.fileHandovers.filter((h) => h.status === "sent").sort((a, b) => a.createdAt - b.createdAt);
  const incomingDepts = [...new Set(incoming.map((h) => h.toDept))];
  const trail = patientTrail(db.fileHandovers, trailQuery);
  const isExisting = !!draft && db.fileHandovers.some((h) => h.id === draft.id);
  const missingNow = !!receiving && receiveStatus(receiving.items.map((it, i) => ({ ...it, received: !!ticks[i] })), false) !== "received";

  function startNew() {
    setDraft({
      id: newId(),
      number: "",
      date: isoDate(new Date()),
      time: nowTime(),
      fromDept: "",
      toDept: "records",
      purpose: HANDOVER_PURPOSES[0]!,
      deliveredBy: me?.name ?? "",
      items: [newItem(), newItem(), newItem()],
      status: "sent",
      createdAt: Date.now(),
    });
  }
  const patch = (p: Partial<FileHandover>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchItem = (i: number, p: Partial<HandoverItem>) =>
    setDraft((d) => (d ? { ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...p } : it)) } : d));

  function save() {
    if (!draft) return;
    const items = draft.items.filter((i) => i.patientName.trim());
    if (saveFileHandover({ ...draft, items })) {
      toast.success(isExisting ? "اتعدّل السركي." : "اتسجّل السركي — في انتظار استلام القسم.");
      setDraft(null);
    }
  }
  function startReceive(h: FileHandover) {
    setReceiving(h);
    setTicks(h.items.map(() => true));
    setReceiver(me?.name ?? "");
    setReceiveNote("");
  }
  function confirmReceive(reject: boolean) {
    if (!receiving) return;
    if (receiveFileHandover({ id: receiving.id, received: ticks, receivedBy: receiver, note: receiveNote, reject })) {
      toast.success(reject ? "اتسجّل رفض الاستلام." : "اتسجّل الاستلام.");
      setReceiving(null);
    }
  }
  function printSheet(h: FileHandover) {
    setPrinting(h);
    // Let the off-screen sheet render before capturing it.
    setTimeout(() => void sheetPdf.run(`سركي-${h.number}.pdf`, "السركي جاهز للطباعة."), 80);
  }
  function remove(h: FileHandover) {
    if (!window.confirm(`حذف السركي ${h.number}؟`)) return;
    if (deleteFileHandover(h.id)) toast.success("اتحذف السركي.");
  }
  function exportCsv() {
    const rows = filtered.flatMap((h) =>
      h.items.map((it, i) => [
        h.number, h.date, h.time, dept(h.fromDept), dept(h.toDept), h.purpose, i + 1, it.patientName, it.mrn ?? "", it.fileType, it.pages ?? "",
        it.notes ?? "", h.deliveredBy, HANDOVER_STATUS[h.status], h.status === "sent" ? "" : it.received ? "نعم" : "لا", h.receivedBy ?? "", stamp(h.receivedAt), h.receiveNote ?? "",
      ]),
    );
    downloadCsv(
      `سركي-تسليم-الملفات-${range.from}-${range.to}`,
      ["رقم السركي", "التاريخ", "الوقت", "من قسم", "إلى قسم", "الغرض", "م", "اسم المريض", "رقم الملف", "نوع الملف", "عدد الأوراق", "ملاحظات", "المُسلِّم", "الحالة", "استُلم", "المستلم", "وقت الاستلام", "ملاحظة الاستلام"],
      rows,
    );
  }

  function Register({ list, showDate = true }: { list: FileHandover[]; showDate?: boolean }) {
    return (
      <TableCard minWidth={1000}>
        <thead>
          <HeadRow>
            <Th>رقم السركي</Th>
            {showDate && <Th>التاريخ</Th>}
            <Th>من ← إلى</Th>
            <Th>الغرض</Th>
            <Th num>الملفات</Th>
            <Th>المُسلِّم</Th>
            <Th>الحالة</Th>
            <Th>المستلم</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {list.map((h) => (
            <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30">
              <Td className="num font-semibold" >{h.number}</Td>
              {showDate && (
                <Td className="whitespace-nowrap">
                  {dateLabel(h.date)} <span className="num text-xs text-muted-foreground">{h.time}</span>
                </Td>
              )}
              <Td>
                {dept(h.fromDept)} <span className="text-muted-foreground">←</span> <b>{dept(h.toDept)}</b>
              </Td>
              <Td className="text-xs">{h.purpose}</Td>
              <Td num>
                {h.status === "sent" ? int(h.items.length) : `${int(h.items.filter((i) => i.received).length)} / ${int(h.items.length)}`}
              </Td>
              <Td>{h.deliveredBy}</Td>
              <Td><StatusPill status={h.status} /></Td>
              <Td className="text-xs">
                {h.receivedBy ? <>{h.receivedBy}<br /><span className="text-muted-foreground">{stamp(h.receivedAt)}</span></> : "—"}
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {canAdd && h.status === "sent" && (
                    <Button size="sm" onClick={() => startReceive(h)}>
                      <CheckCheck /> استلام
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={sheetPdf.busy} onClick={() => printSheet(h)}>
                    <Printer /> طباعة السركي
                  </Button>
                  {canEdit && h.status === "sent" && (
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...h, items: h.items.map((i) => ({ ...i })) })}>
                      تعديل
                    </Button>
                  )}
                  {canEdit && (h.status === "sent" || me?.role === "admin") && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(h)}>
                      حذف
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {!list.length && <EmptyRow cols={showDate ? 9 : 8} text="مفيش سراكي هنا." />}
        </tbody>
      </TableCard>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الملف الطبي"
        title="سركي تسليم ملفات المرضى"
        description="كل قسم يسلّم ملفات المرضى لأي قسم تاني بسركي مرقّم، والقسم المستلم يأكّد ملف ملف. تقدر تطبع السركي للتوقيع وتعرف مكان أي ملف في أي وقت."
        actions={
          <>
            {canAdd && (
              <Button onClick={startNew}>
                <Plus /> سركي تسليم جديد
              </Button>
            )}
            <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
              <FileSpreadsheet /> Excel
            </Button>
            <Button variant="outline" disabled={!filtered.length || reportPdf.busy} onClick={() => reportPdf.run(`سجل-تسليم-الملفات-${range.from}-${range.to}.pdf`, "اتصدّر السجل.")}>
              <FileDown /> {reportPdf.busy ? "جارٍ التصدير..." : "تصدير السجل PDF"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="سراكي الفترة" value={int(totals.batches)} icon={FileStack} tone="primary" />
        <StatCard label="ملفات مُسلَّمة" value={int(totals.files)} icon={Send} />
        <StatCard label="في انتظار الاستلام" value={int(incoming.length)} icon={Hourglass} tone="copper" hint="سراكي من أي تاريخ" />
        <StatCard label="ملفات استُلمت" value={int(totals.received)} icon={CheckCheck} tone="income" />
        <StatCard label="ملفات ناقصة / مرفوضة" value={int(totals.missing)} icon={SearchX} tone="expense" />
      </div>

      <Tabs defaultValue={incoming.length ? "incoming" : "all"} dir="rtl">
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="incoming">الوارد للاستلام ({int(incoming.length)})</TabsTrigger>
          <TabsTrigger value="all">كل السراكي</TabsTrigger>
          <TabsTrigger value="trail">تتبع ملف مريض</TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="grid gap-6">
          {!incoming.length && <p className="ledger-card p-10 text-center text-sm text-muted-foreground">مفيش ملفات مستنية استلام.</p>}
          {incomingDepts.map((id) => (
            <section key={id} className="grid gap-2">
              <h2 className="font-bold">وارد إلى {dept(id)}</h2>
              <Register list={incoming.filter((h) => h.toDept === id)} />
            </section>
          ))}
        </TabsContent>

        <TabsContent value="all">
          <FilterBar>
            <RangePicker value={range} onChange={setRange} />
            <DeptSelect value={from} onChange={setFrom} allowAll label="من قسم" allLabel="من كل الأقسام" className="w-48" />
            <DeptSelect value={to} onChange={setTo} allowAll label="إلى قسم" allLabel="إلى كل الأقسام" className="w-48" />
            <select
              aria-label="الحالة"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="all">كل الحالات</option>
              {Object.entries(HANDOVER_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <Input aria-label="بحث" placeholder="اسم مريض / رقم ملف / رقم سركي" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
          </FilterBar>
          <Register list={filtered} />
        </TabsContent>

        <TabsContent value="trail" className="grid gap-4">
          <Input
            aria-label="تتبع ملف مريض"
            placeholder="اكتب اسم المريض أو رقم الملف بالكامل"
            value={trailQuery}
            onChange={(e) => setTrailQuery(e.target.value)}
            className="max-w-md"
          />
          {trailQuery.trim() && !trail.length && <p className="text-sm text-muted-foreground">مفيش حركة لملف بالاسم أو الرقم ده.</p>}
          {!!trail.length && (
            <div className="ledger-card p-4">
              <p className="mb-1 text-xs text-muted-foreground">آخر مكان مسجّل للملف</p>
              {(() => {
                const { h, it } = trail[0]!;
                return (
                  <p className="text-lg font-bold">
                    {h.status === "sent"
                      ? `في الطريق من ${dept(h.fromDept)} إلى ${dept(h.toDept)}`
                      : it.received
                        ? `في ${dept(h.toDept)}`
                        : `في ${dept(h.fromDept)} (لم يستلمه ${dept(h.toDept)})`}
                  </p>
                );
              })()}
            </div>
          )}
          <ol className="grid gap-3 border-s-2 border-primary/30 ps-4">
            {trail.map(({ h, it }, i) => (
              <li key={`${h.id}-${i}`} className="ledger-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-semibold">
                    {it.patientName} {it.mrn && <span className="num text-muted-foreground">({it.mrn})</span>} — {it.fileType}
                  </p>
                  <p className="text-muted-foreground">
                    {dateLabel(h.date)} {h.time} • <span className="num">{h.number}</span> • {dept(h.fromDept)} ← {dept(h.toDept)} • {h.purpose}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={h.status} />
                  {h.status !== "sent" && <span className={cn("text-xs font-semibold", it.received ? "text-income" : "text-destructive")}>{it.received ? "الملف وصل" : "الملف ماوصلش"}</span>}
                </div>
              </li>
            ))}
          </ol>
        </TabsContent>
      </Tabs>

      {/* New / edit handover */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{isExisting ? `تعديل السركي ${draft?.number}` : "سركي تسليم ملفات جديد"}</DialogTitle>
            <DialogDescription>اكتب الملفات اللي خارجة من القسم. السركي يتعدّل بس قبل ما القسم التاني يستلمه.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <FieldRow label="القسم المُسلِّم">
                  <DeptSelect value={draft.fromDept} onChange={(v) => patch({ fromDept: v })} label="القسم المُسلِّم" />
                </FieldRow>
                <FieldRow label="القسم المستلم">
                  <DeptSelect value={draft.toDept} onChange={(v) => patch({ toDept: v })} label="القسم المستلم" />
                </FieldRow>
                <FieldRow label="الغرض من التسليم" htmlFor="h-purpose">
                  <Input id="h-purpose" list="h-purposes" value={draft.purpose} onChange={(e) => patch({ purpose: e.target.value })} />
                  <datalist id="h-purposes">
                    {HANDOVER_PURPOSES.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </FieldRow>
                <FieldRow label="التاريخ" htmlFor="h-date">
                  <Input id="h-date" type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} />
                </FieldRow>
                <FieldRow label="الوقت" htmlFor="h-time">
                  <Input id="h-time" type="time" value={draft.time} onChange={(e) => patch({ time: e.target.value })} />
                </FieldRow>
                <FieldRow label="اسم المُسلِّم" htmlFor="h-by">
                  <Input id="h-by" value={draft.deliveredBy} onChange={(e) => patch({ deliveredBy: e.target.value })} />
                </FieldRow>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="bg-secondary/60 text-xs">
                      <th className="p-2 text-right">م</th>
                      <th className="p-2 text-right">اسم المريض</th>
                      <th className="p-2 text-right">رقم الملف</th>
                      <th className="p-2 text-right">نوع الملف</th>
                      <th className="p-2 text-right">الأوراق</th>
                      <th className="p-2 text-right">ملاحظات</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((it, i) => (
                      <tr key={i} className="border-t">
                        <td className="num p-1 text-center text-muted-foreground">{i + 1}</td>
                        <td className="p-1"><Input aria-label={`اسم المريض ${i + 1}`} value={it.patientName} onChange={(e) => patchItem(i, { patientName: e.target.value })} /></td>
                        <td className="w-32 p-1"><Input aria-label={`رقم الملف ${i + 1}`} value={it.mrn ?? ""} onChange={(e) => patchItem(i, { mrn: e.target.value })} /></td>
                        <td className="w-44 p-1">
                          <select aria-label={`نوع الملف ${i + 1}`} value={it.fileType} onChange={(e) => patchItem(i, { fileType: e.target.value })} className="h-9 w-full rounded-md border border-input bg-card px-2">
                            {FILE_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="w-24 p-1">
                          <Input type="number" min={1} aria-label={`عدد الأوراق ${i + 1}`} value={it.pages ?? ""} onChange={(e) => patchItem(i, { pages: e.target.value ? Number(e.target.value) : undefined })} />
                        </td>
                        <td className="p-1"><Input aria-label={`ملاحظات ${i + 1}`} value={it.notes ?? ""} onChange={(e) => patchItem(i, { notes: e.target.value })} /></td>
                        <td className="p-1">
                          <Button type="button" size="sm" variant="ghost" disabled={draft.items.length === 1} onClick={() => patch({ items: draft.items.filter((_, k) => k !== i) })}>
                            حذف
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => patch({ items: [...draft.items, newItem()] })}>
                  <Plus /> صف
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => patch({ items: [...draft.items, ...Array.from({ length: 5 }, newItem)] })}>
                  <Plus /> 5 صفوف
                </Button>
                <span className="self-center text-xs text-muted-foreground">
                  {int(draft.items.filter((i) => i.patientName.trim()).length)} ملف — الصفوف الفاضية مش هتتحفظ
                </span>
              </div>
              <FieldRow label="ملاحظات" htmlFor="h-notes">
                <Textarea id="h-notes" value={draft.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} rows={2} />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>إلغاء</Button>
            <Button onClick={save} disabled={isExisting ? !canEdit : !canAdd}>
              <Send /> حفظ وإرسال للقسم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive */}
      <Dialog open={!!receiving} onOpenChange={(o) => !o && setReceiving(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>استلام السركي {receiving?.number}</DialogTitle>
            <DialogDescription>
              {receiving && `${dept(receiving.fromDept)} ← ${dept(receiving.toDept)}`} — شيل العلامة من أي ملف ماوصلش.
            </DialogDescription>
          </DialogHeader>
          {receiving && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                {receiving.items.map((it, i) => (
                  <label key={i} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm", !ticks[i] && "border-destructive/40 bg-destructive/5")}>
                    <input type="checkbox" className="size-4" checked={!!ticks[i]} onChange={(e) => setTicks((t) => t.map((x, k) => (k === i ? e.target.checked : x)))} />
                    <span className="num w-6 text-muted-foreground">{i + 1}</span>
                    <span className="font-semibold">{it.patientName}</span>
                    {it.mrn && <span className="num text-muted-foreground">{it.mrn}</span>}
                    <span className="ms-auto text-xs text-muted-foreground">{it.fileType}{it.pages ? ` • ${it.pages} ورقة` : ""}</span>
                  </label>
                ))}
              </div>
              <p className="text-sm">
                هيتسجّل استلام <b className="num">{int(ticks.filter(Boolean).length)}</b> من <b className="num">{int(receiving.items.length)}</b> ملف.
              </p>
              <FieldRow label="اسم المستلم" htmlFor="r-by">
                <Input id="r-by" value={receiver} onChange={(e) => setReceiver(e.target.value)} />
              </FieldRow>
              <FieldRow label={missingNow ? "ملاحظة بالملفات الناقصة (مطلوبة)" : "ملاحظة (اختياري)"} htmlFor="r-note">
                <Textarea id="r-note" rows={2} value={receiveNote} onChange={(e) => setReceiveNote(e.target.value)} />
              </FieldRow>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="text-destructive" onClick={() => confirmReceive(true)} disabled={!canAdd}>
              رفض الاستلام
            </Button>
            <Button onClick={() => confirmReceive(false)} disabled={!canAdd}>
              <CheckCheck /> تأكيد الاستلام
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Printable handover sheet */}
      {printing && (
        <OfficialDocument ref={sheetPdf.ref} settings={db.settings} title={`سركي تسليم ملفات مرضى رقم ${printing.number}`} subtitle={`${dept(printing.fromDept)} ← ${dept(printing.toDept)}`} issuedOn={dateLabel(printing.date)}>
          <DocInfoGrid
            items={[
              ["رقم السركي", printing.number],
              ["التاريخ والوقت", `${dateLabel(printing.date)} — ${printing.time}`],
              ["القسم المُسلِّم", dept(printing.fromDept)],
              ["القسم المستلم", dept(printing.toDept)],
              ["الغرض", printing.purpose],
              ["الحالة", HANDOVER_STATUS[printing.status]],
              ["المُسلِّم", printing.deliveredBy],
              ["المستلم", printing.receivedBy ? `${printing.receivedBy} — ${stamp(printing.receivedAt)}` : "................"],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>م</th>
                <th>اسم المريض</th>
                <th>رقم الملف</th>
                <th>نوع الملف</th>
                <th>عدد الأوراق</th>
                <th>ملاحظات</th>
                <th>استُلم ✓</th>
              </tr>
            </thead>
            <tbody>
              {printing.items.map((it, i) => (
                <tr key={i} data-pdf-break>
                  <td>{i + 1}</td>
                  <td className="text-start">{it.patientName}</td>
                  <td>{it.mrn || "—"}</td>
                  <td>{it.fileType}</td>
                  <td>{it.pages ?? "—"}</td>
                  <td className="text-start">{it.notes || ""}</td>
                  <td>{printing.status === "sent" ? "☐" : it.received ? "✓" : "✗"}</td>
                </tr>
              ))}
              <tr className="doc-total" data-pdf-break>
                <td colSpan={4} className="text-start">الإجمالي</td>
                <td>{printing.items.reduce((s, i) => s + (i.pages ?? 0), 0) || "—"}</td>
                <td colSpan={2}>{printing.items.length} ملف</td>
              </tr>
            </tbody>
          </table>
          {printing.notes && <p data-pdf-break style={{ marginTop: 10, fontSize: 12.5 }}>ملاحظات التسليم: {printing.notes}</p>}
          {printing.receiveNote && <p data-pdf-break style={{ marginTop: 6, fontSize: 12.5 }}>ملاحظات الاستلام: {printing.receiveNote}</p>}
          <SignatureBlock roles={["المُسلِّم", "المستلم", "رئيس القسم"]} />
        </OfficialDocument>
      )}

      {/* Register report */}
      <OfficialDocument ref={reportPdf.ref} settings={db.settings} title="سجل تسليم ملفات المرضى بين الأقسام" subtitle={`من ${dateLabel(range.from)} إلى ${dateLabel(range.to)}`} issuedOn={dateLabel(isoDate(new Date()))} orientation="landscape">
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>رقم السركي</th>
              <th>التاريخ</th>
              <th>من</th>
              <th>إلى</th>
              <th>الغرض</th>
              <th>الملفات</th>
              <th>المُسلِّم</th>
              <th>الحالة</th>
              <th>المستلم</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <tr key={h.id} data-pdf-break>
                <td>{h.number}</td>
                <td>{dateLabel(h.date)} {h.time}</td>
                <td>{dept(h.fromDept)}</td>
                <td>{dept(h.toDept)}</td>
                <td>{h.purpose}</td>
                <td>{h.status === "sent" ? h.items.length : `${h.items.filter((i) => i.received).length} / ${h.items.length}`}</td>
                <td>{h.deliveredBy}</td>
                <td>{HANDOVER_STATUS[h.status]}</td>
                <td>{h.receivedBy ?? "—"}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">
                {totals.batches} سركي — في الانتظار {totals.waiting}
              </td>
              <td>{totals.files}</td>
              <td colSpan={3}>مستلم {totals.received} — ناقص {totals.missing}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["مسؤول السجلات الطبية", "رئيس القسم", "المدير الطبي"]} />
      </OfficialDocument>
    </div>
  );
}
