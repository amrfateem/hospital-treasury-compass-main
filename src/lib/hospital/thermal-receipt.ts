/**
 * Small-paper receipt for thermal receipt printers (80 mm / 58 mm rolls).
 * Built as a standalone HTML page and printed through a hidden iframe, so the browser
 * shapes Arabic correctly and the cashier only picks the receipt printer once.
 * thermalReceiptHtml() is pure (covered by thermal-receipt.test.ts).
 */
import tajawal400 from "@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2?url";
import tajawal700 from "@fontsource/tajawal/files/tajawal-arabic-700-normal.woff2?url";
import { HOSPITAL } from "./constants";
import { invoiceAmounts } from "./finance";
import { dateLabel, int, money } from "./format";
import { invoiceContext } from "./invoice-export";
import { listLabel, type HospitalDB, type PatientInvoice } from "./model";

export type PaperWidth = 80 | 58;

export interface ThermalOptions {
  width: PaperWidth;
  copies: number;
  /** The receipt was already printed once — marks the slip as a copy. */
  reprint?: boolean;
  /** Printing time (ms) shown at the bottom. */
  printedAt?: number;
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const timeFmt = new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit" });
const timeOf = (ms: number) => timeFmt.format(new Date(ms));

function line(label: string, value: string, cls = "") {
  return `<div class="row ${cls}"><span>${esc(label)}</span><b>${value}</b></div>`;
}

export function thermalReceiptHtml(
  db: Pick<HospitalDB, "settings" | "departments" | "doctors" | "lists">,
  inv: PatientInvoice,
  opts: ThermalOptions,
) {
  const a = invoiceAmounts(inv);
  const c = invoiceContext(db, inv);
  const payer = inv.payer ? listLabel(db.lists.payers, inv.payer.payerId) : "";
  const method = listLabel(db.lists.paymentMethods, inv.paymentMethod);
  const s = db.settings;

  const info: [string, string][] = [["المريض", inv.patientName]];
  const ownRest = a.credit > 0 && !!inv.credit?.accountId.startsWith("pt-");
  if (inv.patientMrn) info.push(["رقم الملف", inv.patientMrn]);
  if (inv.patientPhone) info.push(["التليفون", inv.patientPhone]);
  const surgery = inv.department === "surgery";
  if (c.clinic) info.push(surgery ? ["التخصص", c.clinic] : ["العيادة", `عيادة ${c.clinic}`]);
  if (c.referredBy) info.push(["المحوِّل", c.referredBy]);
  if (c.doctor) info.push([inv.stay ? "الطبيب المشرف" : surgery ? "الجراح" : "الطبيب", `د. ${c.doctor}`]);
  const anesthetist = inv.anesthetistId ? db.doctors.find((d) => d.id === inv.anesthetistId)?.name : "";
  if (anesthetist) info.push(["طبيب التخدير", `د. ${anesthetist}`]);
  const deposit = inv.depositApplied ?? 0;
  if (inv.stay) {
    info.push(["الدخول", dateLabel(inv.stay.admitDate)]);
    info.push(["الخروج", dateLabel(inv.stay.dischargeDate)]);
    if (inv.stay.room) info.push(["السرير", inv.stay.room]);
  }

  const items: [string, number, number][] = [];
  if (inv.stay && a.room > 0) items.push(["إقامة (يوم)", a.days, a.room]);
  if (inv.stay && a.supervision > 0) items.push(["إشراف طبي (يوم)", a.days, a.supervision]);
  for (const it of inv.items) items.push([it.description, it.qty, it.qty * it.unitPrice]);

  const totals = [line("الإجمالي", money(a.subtotal))];
  if (a.discount > 0) totals.push(line("الخصم", `(${money(a.discount)})`));
  if (payer) {
    totals.push(line("صافي الإيصال", money(a.total)));
    totals.push(line(`نصيب ${payer} ${int(a.coverage)}٪`, `(${money(a.insurerShare)})`));
  }

  const slip = `
  <div class="slip">
    <header>
      <h1>${esc(HOSPITAL.name)}</h1>
      <p class="owner">${esc(HOSPITAL.owner)}</p>
      ${s.address ? `<p>${esc(s.address)}</p>` : ""}
      ${s.phones ? `<p>ت: <span dir="ltr">${esc(s.phones)}</span></p>` : ""}
    </header>
    <div class="title">إيصال ${esc(c.section)}${opts.reprint ? ' <span class="copy">نسخة مكررة</span>' : ""}</div>
    <div class="receipt-meta">
    ${line("رقم الإيصال", `<span dir="ltr">${esc(inv.number)}</span>`)}
    ${line("التاريخ", `${esc(dateLabel(inv.date))} — ${esc(timeOf(inv.createdAt))}`)}
    </div>
    <section class="patient">
    ${info.map(([k, v]) => line(k, esc(v))).join("")}
    </section>
    <table>
      <thead><tr><th class="d">البيان</th><th>ك</th><th class="v">القيمة</th></tr></thead>
      <tbody>
        ${items
          .map(
            ([d, q, v]) =>
              `<tr><td class="d">${esc(d)}</td><td>${esc(int(q))}</td><td class="v">${esc(money(v))}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table>
    <section class="totals">${totals.join("")}
    ${a.credit > 0 && !ownRest ? line("آجل على الحساب", `${esc(money(a.credit))} ج.م`) : ""}
    <div class="due"><span>${payer ? "المدفوع من المريض" : "المبلغ المدفوع"}</span><b>${esc(money(a.paidNow))} ج.م</b></div>
    ${deposit > 0 ? line("منها تأمين مقدم", `(${esc(money(deposit))})`) + line("المدفوع عند الخروج", `${esc(money(a.paidNow - deposit))} ج.م`) : ""}
    ${ownRest ? `<div class="due remaining"><span>المتبقي على المريض</span><b>${esc(money(a.credit))} ج.م</b></div>` : ""}
    </section>
    ${line("طريقة الدفع", esc(method))}
    ${inv.createdBy ? line("الكاشير", esc(inv.createdBy)) : ""}
    ${inv.notes ? `<p class="notes">ملاحظات: ${esc(inv.notes)}</p>` : ""}
    <footer>
      <div class="ornament" aria-hidden="true">— ◆ —</div>
      <p>الخدمات الطبية معفاة من ضريبة القيمة المضافة.</p>
      <p>شكرًا لثقتكم — مع تمنياتنا بالشفاء العاجل</p>
      <div class="reference" dir="ltr">— ${esc(inv.number)} —</div>
      ${opts.printedAt ? `<p class="muted">طُبع ${esc(timeOf(opts.printedAt))}</p>` : ""}
    </footer>
  </div>`;

  const copies = Math.min(3, Math.max(1, Math.round(opts.copies || 1)));
  const narrow = opts.width === 58;
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إيصال ${esc(inv.number)}</title>
<style>
@font-face { font-family: Tajawal; font-style: normal; font-weight: 400; src: url(${tajawal400}) format("woff2"); font-display: swap; }
@font-face { font-family: Tajawal; font-style: normal; font-weight: 700; src: url(${tajawal700}) format("woff2"); font-display: swap; }
@page { size: ${opts.width}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${opts.width}mm; font-family: Tajawal, Tahoma, Arial, sans-serif; font-size: ${narrow ? 10.5 : 12}px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slip { padding: 2mm ${narrow ? 2 : 4}mm 4mm; break-after: page; }
.slip:last-child { break-after: auto; }
header { text-align: center; border-top: 3px solid #000; border-bottom: 1px solid #000; padding: 8px 0; margin-bottom: 9px; }
h1 { font-size: ${narrow ? 15 : 20}px; font-weight: 800; margin: 0 0 3px; line-height: 1.5; }
header p { margin: 2px 0; font-size: ${narrow ? 9 : 10.5}px; overflow-wrap: anywhere; }
.owner { font-weight: 700; }
.title { width: fit-content; max-width: 100%; margin: 9px auto; padding: 4px 10px; background: #000; color: #fff; border-radius: 5px; text-align: center; font-weight: 800; font-size: ${narrow ? 11 : 13}px; }
.copy { display: block; font-size: 0.8em; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 2px 0; }
.row > span { flex-shrink: 0; }
.row b { min-width: 0; overflow-wrap: anywhere; font-weight: 700; text-align: left; }
.receipt-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 6px 0 9px; }
.receipt-meta .row { display: block; min-width: 0; }
.receipt-meta .row > span { display: block; font-size: .85em; }
.receipt-meta .row b { display: block; text-align: right; font-size: .95em; }
.patient { border: 1px solid #000; border-radius: 6px; padding: 5px 7px; margin-bottom: 10px; }
.patient .row:first-child { font-size: 1.08em; border-bottom: 1px dotted #000; padding-bottom: 4px; margin-bottom: 3px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; table-layout: fixed; }
th { border-top: 2px solid #000; border-bottom: 1px solid #000; font-weight: 800; padding: 5px 2px; }
td { padding: 6px 2px; vertical-align: top; border-bottom: 1px dotted #000; text-align: center; overflow-wrap: anywhere; }
th:nth-child(2) { width: 12%; } th.v { width: 31%; }
.d { text-align: right; } .v { text-align: left; }
.totals { border-bottom: 1px solid #000; padding: 3px 0 8px; margin-bottom: 5px; }
.due { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #000; color: #fff; border: 2px solid #000; border-radius: 6px; padding: 7px; margin: 7px 0; font-weight: 800; }
.due span { font-size: ${narrow ? 10 : 12}px; } .due b { font-size: ${narrow ? 14 : 19}px; white-space: nowrap; }
.remaining { background: #fff; color: #000; border-style: dashed; }
.notes { margin: 8px 0; padding: 5px 0; border-bottom: 1px dotted #000; overflow-wrap: anywhere; }
footer { text-align: center; margin-top: 8px; font-size: ${narrow ? 9 : 10}px; }
footer p { margin: 4px 0; } .ornament { font-size: 13px; letter-spacing: 4px; }
.reference { font-family: monospace; font-size: ${narrow ? 14 : 18}px; font-weight: 700; margin: 10px 0 3px; overflow-wrap: anywhere; }
.muted { font-size: .85em; }
</style></head><body>${Array.from({ length: copies }, () => slip).join("")}</body></html>`;
}

/** Prints a standalone HTML page through a hidden iframe (opens the browser print window). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    frame.onload = async () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return resolve();
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      try {
        await Promise.race([doc.fonts.load("700 12px Tajawal").then(() => doc.fonts.ready), wait(2500)]);
      } catch {
        /* print with the fallback font */
      }
      win.addEventListener("afterprint", cleanup, { once: true });
      win.focus();
      win.print();
      cleanup();
      resolve();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
