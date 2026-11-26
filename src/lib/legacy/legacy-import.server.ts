/** Active add-only migration plus private retention of every original source row. */
import { createHash } from 'node:crypto';
import { all, db, get, run } from '@/lib/local/db.server';
import { readState, saveState } from '@/lib/hospital/state.server';
import { runOp } from '@/lib/hospital/ops';
import type { Actor } from '@/lib/hospital/model';
import { buildLegacyPlan, legacyId, legacyPatientId, listIds, parseLegacyBackup, sourceDate, sourceKey, type LegacyPlan } from './migration';

export const PRIVATE_SOURCE_TABLES = new Set(['users', 'users_groups', 'settings', 'sms_companies']);
const DETAIL_SOURCE_TABLES = new Set(['patients','waiting','waiting_lab_rays','waiting_operations','revenues','paid','prices','analysis','rays','prices_operations','products','drugs','patient_balance','patient_multi','pays_out','pay_categories','payments','category','sub_category','units','setting_rooms','setting_rooms_types','types','branchs','doctors_percentage']);

export function ensureLegacyTables() {
  db().exec(`
CREATE TABLE IF NOT EXISTS legacy_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, by_name TEXT, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_source_rows (
  table_name TEXT NOT NULL, source_id TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL,
  patient_id TEXT, at TEXT, title TEXT NOT NULL, status TEXT NOT NULL,
  target TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY(table_name, source_id)
);
CREATE INDEX IF NOT EXISTS legacy_source_patient_idx ON legacy_source_rows(patient_id, at DESC);
CREATE INDEX IF NOT EXISTS legacy_source_status_idx ON legacy_source_rows(table_name, status);
CREATE TABLE IF NOT EXISTS legacy_source_versions (
  table_name TEXT NOT NULL, source_id TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(table_name, source_id, fingerprint)
);`);
}

const reviewReasons: Record<string, string> = {
  patient_balance: 'رصيد بلا تاريخ ومعناه غير مؤكد؛ لم يضف مديونية جديدة.',
  patient_multi: 'تداخل المبالغ مع الإيصالات يحتاج مطابقة؛ لم يحتسب مرتين.',
  doctors_percentage: 'نسب ومستحقات الأطباء تحتاج تحديد الخانات؛ لم تنشأ مستحقات تخمينية.',
  pays_out: 'لم يثبت الربط بإيراد مسجل؛ لم يضف تحصيل مكرر.',
  users: 'لم تنقل كلمات المرور أو صلاحيات الدخول؛ حسابات الموظفين ينشئها المدير.',
  users_groups: 'صلاحيات المصدر لا تقابل صلاحيات النظام الجديد تلقائياً.',
  setting_rooms: 'بيانات الغرف محفوظة؛ الربط بالإقامة يحتاج مراجعة.',
  arrange: 'معنى حالة الموعد غير محدد؛ لم ينشأ موعد تخميني.',
};

function sourceInfo(plan: LegacyPlan, table: string, r: string[]) {
  const id = r[0] ?? '';
  const patientCol = table === 'patients' ? 0 : ['waiting', 'waiting_lab_rays', 'waiting_operations', 'sales'].includes(table) ? 2 : table === 'revenues' ? 4 : ['patient_balance', 'patient_multi', 'arrange'].includes(table) ? 1 : -1;
  const patientId = patientCol < 0 ? null : legacyPatientId(r[patientCol]);
  const dateCol = table === 'patients' ? 14 : table === 'revenues' ? 9 : table === 'paid' ? 5 : table === 'waiting_lab_rays' ? 12 : table === 'sales' ? 4 : ['waiting','waiting_operations','pays_out','arrange'].includes(table) ? 3 : -1;
  const at = dateCol < 0 ? null : sourceDate(r[dateCol]);
  let title = PRIVATE_SOURCE_TABLES.has(table) ? `سجل خاص #${id}` : r[1]?.trim() || `سجل #${id}`;
  if (table === 'revenues') title = `إيصال ${r[2] || id}`;
  if (table === 'waiting') title = plan.serviceNames.get(sourceKey('prices', r[6] ?? '')) || `زيارة #${id}`;
  if (table === 'waiting_operations') title = plan.serviceNames.get(sourceKey('prices_operations', r[5] ?? '')) || `عملية #${id}`;
  if (table === 'waiting_lab_rays') title = listIds(r[4]).map((i) => plan.serviceNames.get(sourceKey(r[3] === 'rays' ? 'rays' : 'analysis', i)) || `فحص #${i}`).join('، ');
  return { patientId, at, title };
}

function insertMedical(plan: LegacyPlan, blocked: Set<string>) {
  const counts = { patients: 0, visits: 0, labOrders: 0 };
  const rows = (name: string) => plan.tables.get(name) ?? [];
  const knownPatients = new Set(all<{id: string}>('SELECT id FROM patients').map((r) => r.id));
  for (const r of rows('patients')) {
    const id = legacyPatientId(r[0]); const name = r[1]?.trim();
    if (!id || !name || blocked.has(sourceKey('patients', r[0] ?? ''))) continue;
    const created = sourceDate(r[14]) ?? sourceDate(r[15]) ?? '';
    const notes = `منقول من السيستم القديم؛ العمر المسجل بالمصدر: ${r[2] || 'غير محدد'}. التفاصيل الأصلية محفوظة.`;
    if (!knownPatients.has(id)) {
      run(`INSERT INTO patients(id,mrn,full_name,birth_date,gender,phone,notes,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, id, `OLD-${r[0]}`, name, null, r[3] === '1' ? 'male' : r[3] === '2' ? 'female' : null, r[9]?.trim() || null, notes, created, created);
      knownPatients.add(id); counts.patients++;
    } else {
      // Repair only untouched patients from the previous archive importer; preserve manual edits.
      run("UPDATE patients SET created_at=?,updated_at=?,notes=? WHERE id=? AND notes='منقول من السيستم القديم'", created, created, notes, id);
    }
    plan.disposition.set(sourceKey('patients', r[0] ?? ''), { target: 'patients', targetId: id, reason: created ? '' : 'تاريخ إنشاء الملف غير موجود بالمصدر؛ لم يُختلق تاريخ.' });
  }
  const visits = new Set(all<{id: string}>('SELECT id FROM medical_visits').map((r) => r.id));
  const labIds = new Set(all<{id: string}>('SELECT id FROM lab_orders').map((r) => r.id));
  for (const table of ['waiting','waiting_operations','waiting_lab_rays']) for (const r of rows(table)) {
    const sourceId = r[0]; const patientId = legacyPatientId(r[2]);
    if (!sourceId || !patientId || !knownPatients.has(patientId) || blocked.has(sourceKey(table, sourceId))) continue;
    const info = sourceInfo(plan, table, r);
    if (!info.at) continue;
    const targetId = legacyId(table, sourceId);
    const isLab = table === 'waiting_lab_rays' && r[3] !== 'rays';
    if (isLab) {
      const tests = listIds(r[4]).map((i) => ({ name: plan.serviceNames.get(sourceKey('analysis', i)) || `تحليل قديم #${i}`, result: '', unit: '', range: '' }));
      if (!tests.length) continue;
      if (!labIds.has(targetId)) {
        run(`INSERT INTO lab_orders(id,order_no,patient_id,ordered_at,status,tests,notes,created_by,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`, targetId, `OLD-LAB-${sourceId}-${r[9] || '0'}`, patientId, info.at, 'ordered', JSON.stringify(tests), 'طلب منقول؛ ملف النتيجة القديم غير مرفق، لم يتم اختلاق نتيجة.', 'السيستم القديم', info.at);
        labIds.add(targetId); counts.labOrders++;
      }
      plan.disposition.set(sourceKey(table, sourceId), { target: 'lab_orders', targetId, reason: 'تفاصيل الطلب منقولة؛ نتائج التحليل غير مرفقة.' });
    } else {
      const department = table === 'waiting_operations' ? 'surgery' : table === 'waiting_lab_rays' ? 'radiology' : plan.clinicDepartments.get(r[11] ?? '') || 'general';
      if (!visits.has(targetId)) {
        run(`INSERT INTO medical_visits(id,patient_id,visit_date,department,notes,vitals,created_by,created_at)
          VALUES(?,?,?,?,?,?,?,?)`, targetId, patientId, info.at.slice(0,10), department, `${info.title} — الوقت الأصلي ${info.at}${table === 'waiting_operations' && r[17] ? ` — ${r[17]}` : ''} — مرجع المصدر ${table} #${sourceId}`, '{}', 'السيستم القديم', info.at);
        visits.add(targetId); counts.visits++;
      }
      plan.disposition.set(sourceKey(table, sourceId), { target: 'medical_visits', targetId, reason: table === 'waiting_lab_rays' ? 'الأشعة منقولة كزيارة؛ ملف النتيجة غير مرفق.' : '' });
    }
  }
  return counts;
}

export async function importLegacyDump(text: string, actor: Actor) {
  if (actor.role !== 'admin') throw new Error('نقل السيستم القديم لمدير المستشفى فقط.');
  const plan = buildLegacyPlan(parseLegacyBackup(text));
  ensureLegacyTables();
  const { runBackup } = await import('@/lib/local/backup.server');
  const backup = await runBackup('legacy-before-import');
  if (!backup.ok.length) throw new Error('تعذر إنشاء نسخة أمان قبل النقل؛ لم تتغير البيانات.');
  const known = all<{table_name:string; source_id:string; fingerprint:string; status:string; target_id:string}>('SELECT table_name,source_id,fingerprint,status,target_id FROM legacy_source_rows');
  const knownMap = new Map(known.map((r) => [sourceKey(r.table_name,r.source_id),r]));
  const blocked = new Set<string>();
  const blockedTargets = new Set<string>();
  for (const [table, rows] of plan.tables) for (const r of rows) {
    const key = sourceKey(table,r[0] ?? ''); const previous = knownMap.get(key);
    const fingerprint = createHash('sha256').update(JSON.stringify(r)).digest('hex');
    if (previous && (previous.status === 'imported' || previous.fingerprint !== fingerprint)) {
      blocked.add(key);
      if (previous.target_id) blockedTargets.add(previous.target_id);
      const target = plan.disposition.get(key);
      if (target) blockedTargets.add(target.targetId);
    }
  }
  const d = plan.document;
  const document = { ...d, departments: d.departments.filter((x) => !blockedTargets.has(x.id)), services: d.services.filter((x) => !blockedTargets.has(x.id)), stockItems: d.stockItems.filter((x) => !blockedTargets.has(x.id)), branches: d.branches.filter((x) => !blockedTargets.has(x.id)), expenseCategories: d.expenseCategories.filter((x) => !blockedTargets.has(x.id)), paymentMethods: d.paymentMethods.filter((x) => !blockedTargets.has(x.id)), stockCategories: d.stockCategories.filter((x) => !blockedTargets.has(x.id)), patientInvoices: d.patientInvoices.filter((x) => !blockedTargets.has(x.id)), transactions: d.transactions.filter((x) => !blockedTargets.has(x.id) && !blockedTargets.has(x.ref ?? '')) };
  const now = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = await readState();
    const next = runOp(before.db,'importLegacyData',{ document },{ actor, now, today: new Date(now).toISOString().slice(0,10) });
    let summary = { patients: 0, visits: 0, labOrders: 0, invoices: next.patientInvoices.length-before.db.patientInvoices.length, transactions: next.transactions.length-before.db.transactions.length, services: next.lists.services.length-before.db.lists.services.length, stockItems: next.stockItems.length-before.db.stockItems.length, sourceRows: 0, reviewRows: 0 };
    const saved = await saveState(before.version,before.db,next,() => {
      const medical = insertMedical(plan,blocked);
      summary = { ...summary, ...medical };
      for (const [table, rows] of plan.tables) for (const r of rows) {
        const sourceId = r[0]; if (!sourceId) continue;
        const key = sourceKey(table,sourceId); const previous = knownMap.get(key);
        const data = JSON.stringify(r); const fingerprint = createHash('sha256').update(data).digest('hex');
        const info = sourceInfo(plan,table,r); const target = plan.disposition.get(key);
        if (previous && previous.fingerprint !== fingerprint) {
          run('INSERT OR IGNORE INTO legacy_source_versions(table_name,source_id,fingerprint,data) SELECT table_name,source_id,fingerprint,data FROM legacy_source_rows WHERE table_name=? AND source_id=?',table,sourceId);
          run('UPDATE legacy_source_rows SET fingerprint=?,data=?,reason=? WHERE table_name=? AND source_id=?',fingerprint,data,'المصدر تغيّر بعد النقل؛ السجل الفعلي لم يُستبدل ويحتاج مطابقة.',table,sourceId);
          continue;
        }
        if (previous?.status === 'imported') continue;
        const status = target ? 'imported' : 'review';
        run(`INSERT INTO legacy_source_rows(table_name,source_id,fingerprint,data,patient_id,at,title,status,target,target_id,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(table_name,source_id) DO UPDATE SET status=excluded.status,target=excluded.target,target_id=excluded.target_id,reason=excluded.reason`, table,sourceId,fingerprint,data,info.patientId,info.at,info.title,status,target?.target ?? '',target?.targetId ?? '',target ? target.reason : reviewReasons[table] || 'تفاصيل المصدر محفوظة؛ الخانات أو الربط غير مؤكدة ولم تُحوّل إلى بيانات تخمينية.');
        if (!previous) summary.sourceRows++;
      }
      summary.reviewRows = get<{n:number}>("SELECT COUNT(*) AS n FROM legacy_source_rows WHERE status='review' OR reason LIKE 'المصدر تغيّر%'")?.n ?? 0;
      run('INSERT INTO legacy_imports(at,by_name,summary) VALUES(?,?,?)',new Date(now).toISOString(),actor.name,JSON.stringify(summary));
    });
    if (saved !== null) return summary;
  }
  throw new Error('النظام مشغول؛ أعد المحاولة. لم تُنقل بيانات جزئية.');
}

export function legacyOverview() {
  ensureLegacyTables();
  const counts = all<{kind:string;n:number;imported:number;review:number}>("SELECT table_name AS kind,COUNT(*) AS n,SUM(CASE WHEN status='imported' THEN 1 ELSE 0 END) AS imported,SUM(CASE WHEN status='review' OR reason LIKE 'المصدر تغيّر%' THEN 1 ELSE 0 END) AS review FROM legacy_source_rows GROUP BY table_name ORDER BY table_name");
  const patients = get<{n:number}>("SELECT COUNT(*) AS n FROM patients WHERE id LIKE 'legacy-%'")?.n ?? 0;
  const last = get<{at:string;by_name:string|null;summary:string}>('SELECT at,by_name,summary FROM legacy_imports ORDER BY id DESC LIMIT 1');
  return { patients,counts,last:last ?? null };
}

export function legacyForPatient(patientId: string) {
  ensureLegacyTables();
  return all<{id:string;kind:string;at:string|null;title:string;amount:number;paid:number|null}>("SELECT table_name || ':' || source_id AS id,table_name AS kind,at,title,CASE table_name WHEN 'waiting' THEN CAST(json_extract(data,'$[8]') AS REAL) WHEN 'waiting_operations' THEN CAST(json_extract(data,'$[7]') AS REAL) WHEN 'waiting_lab_rays' THEN CAST(json_extract(data,'$[6]') AS REAL) ELSE 0 END AS amount,CASE table_name WHEN 'waiting' THEN CAST(json_extract(data,'$[9]') AS REAL) WHEN 'waiting_operations' THEN CAST(json_extract(data,'$[8]') AS REAL) WHEN 'waiting_lab_rays' THEN CAST(json_extract(data,'$[7]') AS REAL) ELSE NULL END AS paid FROM legacy_source_rows WHERE patient_id=? AND table_name IN ('waiting','waiting_operations','waiting_lab_rays') ORDER BY at DESC LIMIT 500",patientId);
}

export function legacySearch(kind: string,q: string,limit=200) {
  ensureLegacyTables();
  return all<{id:string;kind:string;sourceId:string;at:string|null;title:string;status:string;target:string;targetId:string;reason:string}>("SELECT table_name || ':' || source_id AS id,table_name AS kind,source_id AS sourceId,at,title,status,target,target_id AS targetId,reason FROM legacy_source_rows WHERE table_name=? AND title LIKE ? ORDER BY at DESC,source_id DESC LIMIT ?",kind,`%${q}%`,Math.min(200,limit)).map((r) => ({ ...r, detailsAllowed: DETAIL_SOURCE_TABLES.has(r.kind) }));
}

export function legacyDetails(table: string,id: string) {
  if (!DETAIL_SOURCE_TABLES.has(table)) throw new Error('بيانات الدخول والإعدادات الخاصة أو غير المحددة لا تُعرض.');
  ensureLegacyTables();
  const row = get<{data:string}>('SELECT data FROM legacy_source_rows WHERE table_name=? AND source_id=?',table,id);
  if (!row) return [];
  const values = JSON.parse(row.data) as string[];
  const withheld = table === 'waiting_lab_rays' ? new Set([10,16,17,18]) : new Set<number>();
  return values.map((value,index) => ({ index,value:withheld.has(index) ? 'مرجع ملف خاص غير مرفق' : value })).filter((r) => r.value !== '');
}
