import { Database, FileUp, Loader2, Search, Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getLegacyOverview, searchLegacyRecords, getLegacyDetails } from '@/lib/legacy/legacy.functions';
import { LEGACY_LABEL } from '@/lib/legacy/labels';
import { int } from '@/lib/hospital/format';

type Overview = Awaited<ReturnType<typeof getLegacyOverview>>;
type Row = Awaited<ReturnType<typeof searchLegacyRecords>>[number];
type Fields = Awaited<ReturnType<typeof getLegacyDetails>>;
type Summary = { patients: number; visits: number; labOrders: number; invoices: number; transactions: number; services: number; stockItems: number; sourceRows: number; reviewRows: number };

export function LegacyImportPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Overview | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kind, setKind] = useState('revenues');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [fields, setFields] = useState<Fields>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const detailsFn = useServerFn(getLegacyDetails);
  const load = () => { void getLegacyOverview().then(setInfo).catch(() => setInfo(null)); };
  useEffect(load, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void searchLegacyRecords({ data: { kind, q } }).then((r) => { if (active) setRows(r); }).catch(() => { if (active) setRows([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, q, info]);

  const upload = async (file: File) => {
    if (!/\.sql$/i.test(file.name)) { toast.error('اختار ملف SQL بعد فك النسخة من RAR.'); return; }
    if (!window.confirm('سيتم نقل السجلات المؤكدة إلى النظام وترحيل التحصيل والمصروفات القديمة إلى الخزينة الرئيسية بتواريخها. سيتم إنشاء نسخة أمان أولاً. البيانات غير المؤكدة تبقى للمراجعة. هل تتابع؟')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/legacy-import', { method: 'POST', body: file, credentials: 'include' });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { summary: Summary };
      setSummary(result.summary);
      toast.success(`تم النقل الفعلي: ${int(result.summary.invoices)} إيصال و${int(result.summary.transactions)} حركة جديدة.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر النقل.');
    } finally { setBusy(false); }
  };
  const showDetails = async (row: Row) => {
    setSelected(row); setFields([]); setLoadingDetails(true);
    try { setFields(await detailsFn({ data: { table: row.kind, id: row.sourceId } })); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر عرض التفاصيل.'); }
    finally { setLoadingDetails(false); }
  };
  const reviewCount = info?.counts.reduce((n, c) => n + c.review, 0) ?? 0;
  const rowCount = info?.counts.reduce((n, c) => n + c.n, 0) ?? 0;
  return (
    <section className="grid gap-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold"><Database className="size-5 text-primary" />نقل بيانات السيستم القديم</h3>
        <input ref={input} type="file" accept=".sql" className="hidden" aria-label="ملف نسخة السيستم القديم" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
        <Button disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <FileUp />}{busy ? 'جاري النقل…' : 'رفع نسخة السيستم القديم'}</Button>
      </div>
      <p className="text-sm text-muted-foreground">السجلات المؤكدة تدخل في الأقسام والتقارير؛ التحصيل والمصروفات القديمة تؤثر على الخزينة الرئيسية. الحسابات والنسب والكميات غير المحددة تبقى للمراجعة، ولا تُحوَّل إلى أرقام تخمينية.</p>
      {summary && <dl className="grid grid-cols-2 gap-3 border-y py-3 text-sm sm:grid-cols-4">
        {([['مرضى جدد',summary.patients],['زيارات جديدة',summary.visits],['طلبات تحاليل جديدة',summary.labOrders],['إيصالات جديدة',summary.invoices],['حركات خزينة جديدة',summary.transactions],['أسعار خدمات جديدة',summary.services],['أصناف جديدة',summary.stockItems],['سجلات للمراجعة',summary.reviewRows]] as const).map(([label,n]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-bold tabular-nums">{int(n)}</dd></div>)}
      </dl>}
      {info && rowCount > 0 && <>
        <div className="flex flex-wrap gap-6 text-sm"><span>سجلات المصدر: <strong>{int(rowCount)}</strong></span><span>مرضى منقولين: <strong>{int(info.patients)}</strong></span><span>للمراجعة: <strong>{int(reviewCount)}</strong></span></div>
        {info.last && <p className="text-xs text-muted-foreground">آخر نقل: {new Date(info.last.at).toLocaleString('ar-EG')} — {info.last.by_name}</p>}
        <div className="flex flex-wrap gap-2">
          <select className="h-9 max-w-full rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="قسم المصدر">
            {info.counts.map((c) => <option key={c.kind} value={c.kind}>{LEGACY_LABEL[c.kind] || c.kind} — {int(c.n)} / للمراجعة {int(c.review)}</option>)}
          </select>
          <div className="relative min-w-48 flex-1"><Search className="absolute right-2 top-2.5 size-4 text-muted-foreground" /><Input className="pr-8" placeholder="بحث في سجلات المصدر…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <ul className="max-h-96 divide-y overflow-auto border-y text-sm">
          {rows.map((r) => <li key={r.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0"><span className="break-words font-medium">{r.title || '—'}</span><span className="block text-xs text-muted-foreground">#{r.sourceId}{r.at ? ` — ${r.at}` : ' — التاريخ غير موجود بالمصدر'}</span><span className="block text-xs text-muted-foreground">{r.reason}</span></div>
            <div className="flex shrink-0 items-center gap-2"><span className={r.status === 'imported' ? 'text-primary' : 'text-muted-foreground'}>{r.status === 'imported' ? 'منقول' : 'للمراجعة'}</span>{r.detailsAllowed && <Button variant="ghost" size="icon" title="تفاصيل المصدر" aria-label={`تفاصيل المصدر ${r.sourceId}`} onClick={() => void showDetails(r)}><Eye className="size-4" /></Button>}</div>
          </li>)}
          {!rows.length && <li className="py-4 text-center text-muted-foreground">لا توجد نتائج.</li>}
        </ul>
      </>}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader className="pl-10 text-right sm:text-right"><DialogTitle>تفاصيل المصدر — {selected?.sourceId}</DialogTitle></DialogHeader>
          {loadingDetails ? <Loader2 className="animate-spin" /> : <dl className="divide-y text-sm">{fields.map((f) => <div key={f.index} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2"><dt className="text-muted-foreground">خانة {f.index}</dt><dd className="whitespace-pre-wrap break-words">{f.value}</dd></div>)}</dl>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
