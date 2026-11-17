/**
 * Bank accounts & reconciliation (المطابقة البنكية). Pure: statement parsing (CSV),
 * the book side of a bank account, automatic matching and the reconciliation summary.
 * Amounts are signed: + money into the account, − money out.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export interface BankLine {
  id: string;
  date: string;
  description: string;
  reference?: string | undefined;
  amount: number;
  balance?: number | undefined;
  /** Book items (transaction / transfer ids) this bank line was matched to. */
  matched?: string[] | undefined;
  /** Book entry created from this line (bank charges, interest...). */
  adjustmentTxId?: string | undefined;
}

export interface BankStatement {
  id: string;
  number: string;
  boxId: string;
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  lines: BankLine[];
  fileName?: string | undefined;
  importedAt: number;
  importedBy: string;
  status: "open" | "reconciled";
  reconciledAt?: number | undefined;
  reconciledBy?: string | undefined;
}

export interface BookItem {
  id: string;
  kind: "tx" | "transfer";
  date: string;
  amount: number;
  description: string;
  reference: string;
}

/** Everything the hospital's books say went through a bank account. */
export function bankBookItems(
  bank: { id: string; methods?: string[] | undefined },
  txs: { id: string; date: string; kind: "in" | "out"; amount: number; boxId?: string | undefined; method?: string | undefined; description: string; receiptId: string }[],
  transfers: { id: string; date: string; from: string; to: string; amount: number; method?: string | undefined; number: string; note?: string | undefined }[],
  bankIds: string[],
): BookItem[] {
  const methods = new Set(bank.methods ?? []);
  const items: BookItem[] = [];
  for (const t of txs) {
    const inBank = t.boxId === bank.id;
    // Card / transfer money taken at a drawer settles into the linked bank account.
    const viaMethod = !inBank && !bankIds.includes(t.boxId ?? "main") && !!t.method && methods.has(t.method);
    if (!inBank && !viaMethod) continue;
    items.push({
      id: t.id,
      kind: "tx",
      date: t.date,
      amount: round2(t.kind === "in" ? t.amount : -t.amount),
      description: t.description,
      reference: t.receiptId,
    });
  }
  for (const t of transfers) {
    if (t.to !== bank.id && t.from !== bank.id) continue;
    items.push({
      id: t.id,
      kind: "transfer",
      date: t.date,
      amount: round2(t.to === bank.id ? t.amount : -t.amount),
      description: t.note || "تحويل بين الخزائن والبنوك",
      reference: t.number,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

const dayDiff = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

/**
 * Matches unmatched statement lines to unmatched book items: same signed amount, dates within
 * `toleranceDays`; a reference found in the bank description wins, then the closest date.
 * Returns lineId → bookItemId for the new matches only.
 */
export function autoMatch(lines: BankLine[], book: BookItem[], usedIds: Set<string>, toleranceDays = 3) {
  const taken = new Set(usedIds);
  for (const l of lines) {
    for (const id of l.matched ?? []) taken.add(id);
    if (l.adjustmentTxId) taken.add(l.adjustmentTxId);
  }
  const out = new Map<string, string>();
  const open = lines.filter((l) => !l.matched?.length && !l.adjustmentTxId);
  for (const l of open) {
    const norm = `${l.description} ${l.reference ?? ""}`.toUpperCase();
    const candidates = book
      .filter((b) => !taken.has(b.id) && Math.abs(b.amount - l.amount) < 0.005 && dayDiff(b.date, l.date) <= toleranceDays)
      .map((b) => ({ b, ref: !!b.reference && norm.includes(b.reference.toUpperCase()), d: dayDiff(b.date, l.date) }))
      .sort((x, y) => Number(y.ref) - Number(x.ref) || x.d - y.d);
    const best = candidates[0];
    if (best) {
      out.set(l.id, best.b.id);
      taken.add(best.b.id);
    }
  }
  return out;
}

/** Reconciliation report for one statement (تسوية البنك). */
export function reconciliation(st: BankStatement, book: BookItem[], usedElsewhere: Set<string>) {
  const matchedIds = new Set(st.lines.flatMap((l) => [...(l.matched ?? []), ...(l.adjustmentTxId ? [l.adjustmentTxId] : [])]));
  const bookBalance = round2(book.filter((b) => b.date <= st.to).reduce((s, b) => s + b.amount, 0));
  const unmatchedBook = book.filter(
    (b) => b.date >= st.from && b.date <= st.to && !matchedIds.has(b.id) && !usedElsewhere.has(b.id),
  );
  const unmatchedBank = st.lines.filter((l) => !l.matched?.length && !l.adjustmentTxId);
  const depositsInTransit = round2(unmatchedBook.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0));
  const outstandingPayments = round2(unmatchedBook.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0));
  const bankCredits = round2(unmatchedBank.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const bankDebits = round2(unmatchedBank.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0));
  const adjustedBank = round2(st.closingBalance + depositsInTransit - outstandingPayments);
  const adjustedBook = round2(bookBalance + bankCredits - bankDebits);
  const linesTotal = round2(st.lines.reduce((s, l) => s + l.amount, 0));
  return {
    bookBalance,
    bankBalance: st.closingBalance,
    depositsInTransit,
    outstandingPayments,
    bankCredits,
    bankDebits,
    adjustedBank,
    adjustedBook,
    difference: round2(adjustedBank - adjustedBook),
    /** Opening + lines should equal closing; otherwise the statement is incomplete. */
    statementGap: round2(st.openingBalance + linesTotal - st.closingBalance),
    unmatchedBook,
    unmatchedBank,
    matchedCount: st.lines.filter((l) => l.matched?.length || l.adjustmentTxId).length,
  };
}

/* ---------------- CSV statements ---------------- */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, ".").replace(/٬/g, ",");

export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = toLatin(String(raw)).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  // "1.234,50" → European; "1,234.50" → standard.
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = toLatin(raw).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

function splitCsvLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const COLS: Record<"date" | "description" | "reference" | "debit" | "credit" | "amount" | "balance", RegExp> = {
  date: /^(date|value ?date|posting ?date|transaction ?date|التاريخ|تاريخ|تاريخ الحركة|تاريخ القيد|تاريخ الاستحقاق)$/i,
  description: /^(description|details|narrative|particulars|البيان|الوصف|التفاصيل|بيان العملية|الشرح)$/i,
  reference: /^(reference|ref|ref\.? ?no|cheque|check ?no|المرجع|رقم المرجع|رقم الشيك|رقم العملية)$/i,
  debit: /^(debit|withdrawal|withdrawals|dr|مدين|سحب|مسحوبات|خصم)$/i,
  credit: /^(credit|deposit|deposits|cr|دائن|إيداع|ايداع|إيداعات|ايداعات|إضافة)$/i,
  amount: /^(amount|المبلغ|القيمة)$/i,
  balance: /^(balance|running balance|الرصيد|رصيد)$/i,
};

/** Reads a bank statement exported as CSV (Arabic or English headers). */
export function parseStatementCsv(text: string): { lines: Omit<BankLine, "id">[]; errors: string[] } {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((r) => r.trim());
  if (!rows.length) return { lines: [], errors: ["الملف فارغ."] };
  const sep = [";", "\t", ","].map((s) => ({ s, n: rows[0]!.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s;
  let headerIdx = -1;
  let idx: Partial<Record<keyof typeof COLS, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 15) && headerIdx < 0; i++) {
    const cells = splitCsvLine(rows[i]!, sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const found: typeof idx = {};
    cells.forEach((c, j) => {
      for (const [k, re] of Object.entries(COLS) as [keyof typeof COLS, RegExp][])
        if (found[k] === undefined && re.test(c)) found[k] = j;
    });
    if (found.date !== undefined && (found.amount !== undefined || found.debit !== undefined || found.credit !== undefined)) {
      headerIdx = i;
      idx = found;
    }
  }
  if (headerIdx < 0)
    return { lines: [], errors: ["لم نتعرف على أعمدة الكشف — نحتاج عمود التاريخ وعمود المبلغ (أو مدين/دائن)."] };
  const lines: Omit<BankLine, "id">[] = [];
  const errors: string[] = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const c = splitCsvLine(r, sep);
    const date = parseDate(c[idx.date!]);
    if (!date) {
      if (c.some((x) => x)) errors.push(`السطر ${headerIdx + i + 2}: تاريخ غير مفهوم — تم تجاهله.`);
      return;
    }
    let amount: number | null = null;
    if (idx.amount !== undefined) amount = parseAmount(c[idx.amount]);
    else {
      const dr = Math.abs(parseAmount(c[idx.debit ?? -1]) ?? 0);
      const cr = Math.abs(parseAmount(c[idx.credit ?? -1]) ?? 0);
      amount = cr - dr;
    }
    if (amount === null || Math.abs(amount) < 0.005) return;
    lines.push({
      date,
      description: (idx.description !== undefined ? c[idx.description] : "") || "حركة بنكية",
      reference: idx.reference !== undefined ? c[idx.reference] || undefined : undefined,
      amount: round2(amount),
      balance: idx.balance !== undefined ? (parseAmount(c[idx.balance]) ?? undefined) : undefined,
    });
  });
  return { lines, errors };
}
