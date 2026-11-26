/**
 * Reader for the old clinic system's backup (.sql made of `INSERT INTO t VALUES("..","..");` lines,
 * no column names). Pure so it is test-covered; the column meaning lives in `legacy-import.server.ts`.
 */

// Windows-1252 characters in 0x80–0x9F, used to undo text that was saved as UTF-8 read as Latin-1.
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** "Ø§Ø­Ù…Ø¯" → "احمد"; text that is already correct is returned unchanged. */
export function fixMojibake(s: string): string {
  if (!/[ØÙÚÛ]/.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 256) bytes.push(c);
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
    else return s;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

/** Splits one `VALUES(...)` body into its fields. Unquoted NULL becomes "". */
export function parseValues(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    while (body[i] === " " || body[i] === ",") i++;
    if (i >= body.length) break;
    const q = body[i];
    if (q === '"' || q === "'") {
      let s = "";
      i++;
      while (i < body.length && body[i] !== q) {
        if (body[i] === "\\" && i + 1 < body.length) {
          const n = body[i + 1]!;
          s += n === "n" ? "\n" : n === "r" ? "\r" : n === "t" ? "\t" : n;
          i += 2;
        } else s += body[i++];
      }
      i++;
      out.push(fixMojibake(s));
    } else {
      let j = i;
      while (j < body.length && body[j] !== ",") j++;
      const raw = body.slice(i, j).trim();
      out.push(raw.toUpperCase() === "NULL" ? "" : raw);
      i = j;
    }
  }
  return out;
}

/** Groups every row by table name. Lines that are not single-row INSERTs are ignored. */
export function parseDumpLines(lines: string[]): Map<string, string[][]> {
  const tables = new Map<string, string[][]>();
  const re = /^INSERT\s+INTO\s+`?(\w+)`?\s+VALUES\s*\((.*)\);\s*$/i;
  for (const raw of lines) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!/^INSERT\s+INTO\b/i.test(line)) continue;
    const m = re.exec(line);
    if (!m) continue;
    const list = tables.get(m[1]!) ?? [];
    list.push(parseValues(m[2]!));
    tables.set(m[1]!, list);
  }
  return tables;
}

export function parseDump(text: string): Map<string, string[][]> {
  return parseDumpLines(text.split(/\r?\n/));
}

export const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
