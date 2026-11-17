import { forwardRef } from "react";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { invoiceContext } from "@/lib/hospital/invoice-export";
import { listLabel, type HospitalDB, type PatientInvoice } from "@/lib/hospital/store";
import { DocInfoGrid } from "../kit";
import { OfficialDocument, SignatureBlock } from "../OfficialDocument";

export const ReceiptDocument = forwardRef<
  HTMLDivElement,
  { db: HospitalDB; invoice: PatientInvoice; format: "a4" | "a5" }
>(function ReceiptDocument({ db, invoice, format }, ref) {
  const { settings } = db;
  const a = invoiceAmounts(invoice);
  const ownRest = a.credit > 0 && !!invoice.credit?.accountId.startsWith("pt-");
  const c = invoiceContext(db, invoice);
  const payer = invoice.payer ? listLabel(db.lists.payers, invoice.payer.payerId) : "";
  const info: [string, string][] = [
    ["اسم المريض", invoice.patientName],
    ["التليفون", invoice.patientPhone || "—"],
    ...(invoice.patientMrn ? ([["رقم الملف", invoice.patientMrn]] as [string, string][]) : []),
    ["القسم", c.section],
    ["تاريخ الخدمة", dateLabel(invoice.date)],
  ];
  const surgery = invoice.department === "surgery";
  if (c.clinic) info.push(surgery ? ["التخصص", c.clinic] : ["العيادة", `عيادة ${c.clinic}`]);
  if (c.referredBy) info.push(["المحوِّل", c.referredBy]);
  if (c.doctor) info.push([invoice.stay ? "الطبيب المشرف" : surgery ? "الجراح" : "الطبيب", `د. ${c.doctor}`]);
  const anesthetist = invoice.anesthetistId ? db.doctors.find((d) => d.id === invoice.anesthetistId)?.name : "";
  if (anesthetist) info.push(["طبيب التخدير", `د. ${anesthetist}`]);
  const deposit = invoice.depositApplied ?? 0;
  if (invoice.stay) {
    info.push(["الدخول", dateLabel(invoice.stay.admitDate)]);
    info.push(["الخروج", dateLabel(invoice.stay.dischargeDate)]);
    if (invoice.stay.room) info.push(["السرير", invoice.stay.room]);
  }
  if (payer) info.push(["جهة التعاقد", `${payer} (${int(a.coverage)}٪)`]);
  info.push(["طريقة الدفع", listLabel(db.lists.paymentMethods, invoice.paymentMethod)]);
  if (invoice.createdBy) info.push(["حرره", invoice.createdBy]);

  let n = 0;
  return (
    <OfficialDocument
      ref={ref}
      settings={settings}
      format={format}
      title={invoice.admissionId ? `الفاتورة النهائية لإقامة المريض — ${c.section}` : `إيصال ${c.section} — فاتورة خدمات طبية`}
      subtitle={
        <>
          رقم الإيصال: <span dir="ltr">{invoice.number}</span>
        </>
      }
      issuedOn={dateLabel(isoDate(new Date()))}
    >
      <section data-pdf-break style={{ border: "1px solid var(--doc-line)", borderRadius: 14, padding: "16px 18px 4px", marginBottom: 18, background: "var(--doc-head-bg)" }}>
        <DocInfoGrid items={[["رقم الإيصال", invoice.number], ...info]} />
      </section>
      <table className="doc-table" style={{ borderCollapse: "separate", borderSpacing: 0, border: "none", marginBottom: 16 }}> 
        <thead>
          <tr data-pdf-break>
            <th style={{ width: 30, border: "none", borderStartStartRadius: 10, padding: "10px 8px" }}>م</th>
            <th style={{ border: "none", padding: "10px 8px" }}>البيان</th>
            <th style={{ border: "none", padding: "10px 8px" }}>الكمية</th>
            <th style={{ border: "none", padding: "10px 8px" }}>سعر الوحدة</th>
            <th style={{ border: "none", padding: "10px 8px", borderStartEndRadius: 10 }}>القيمة</th>
          </tr>
        </thead>
        <tbody>
          {invoice.stay && a.room > 0 && (
            <tr data-pdf-break>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(++n)}</td>
              <td className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{invoice.department === "icu" ? "إقامة بالعناية (يوم)" : "إقامة (يوم)"}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(a.days)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(invoice.stay.roomRate)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.room)}</td>
            </tr>
          )}
          {invoice.stay && a.supervision > 0 && (
            <tr data-pdf-break>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(++n)}</td>
              <td className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>إشراف طبي (يوم)</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(a.days)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(invoice.stay.supervisionRate)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.supervision)}</td>
            </tr>
          )}
          {invoice.items.map((it, i) => (
            <tr key={i} data-pdf-break>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(++n)}</td>
              <td className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{it.description}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{int(it.qty)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(it.unitPrice)}</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(it.qty * it.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ width: format === "a5" ? "82%" : "68%", marginInlineEnd: "auto" }}>
      <table className="doc-table" style={{ borderCollapse: "separate", borderSpacing: 0, border: "1px solid var(--doc-line)", borderRadius: 14, overflow: "hidden" }}>
        <tbody>
          <tr className="doc-subtotal" data-pdf-break>
            <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>
              الإجمالي
            </td>
            <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.subtotal)}</td>
          </tr>
          {a.discount > 0 && (
            <tr className="doc-subtotal" data-pdf-break>
              <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>
                الخصم
              </td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>({money(a.discount)})</td>
            </tr>
          )}
          {payer && (
            <>
              <tr className="doc-subtotal" data-pdf-break>
                <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>
                  صافي الإيصال
                </td>
                <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.total)}</td>
              </tr>
              <tr className="doc-subtotal" data-pdf-break>
                <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>
                  نصيب {payer} ({int(a.coverage)}٪) — يُطالب به
                </td>
                <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>({money(a.insurerShare)})</td>
              </tr>
            </>
          )}
          {a.credit > 0 && !ownRest && (
            <tr className="doc-subtotal" data-pdf-break>
              <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>آجل على حساب المريض / الجهة</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>({money(a.credit)})</td>
            </tr>
          )}
          <tr className="doc-total" data-pdf-break style={{ color: "var(--doc-teal)", fontSize: 17, fontWeight: 800 }}>
            <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>
              {payer ? "المدفوع من المريض (جنيه مصري)" : "الصافي المدفوع (جنيه مصري)"}
            </td>
            <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.paidNow)}</td>
          </tr>
          {deposit > 0 && (
            <>
              <tr className="doc-subtotal" data-pdf-break>
                <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>منها: تأمين مدفوع مقدمًا عند الدخول</td>
                <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>({money(deposit)})</td>
              </tr>
              <tr className="doc-subtotal" data-pdf-break>
                <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>المدفوع عند الخروج</td>
                <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.paidNow - deposit)}</td>
              </tr>
            </>
          )}
          {ownRest && (
            <tr className="doc-total" data-pdf-break style={{ color: "var(--doc-teal)", fontSize: 17, fontWeight: 800 }}>
              <td colSpan={4} className="text-start" style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>المبلغ المتبقي على المريض (جنيه مصري)</td>
              <td style={{ border: "none", borderBottom: "1px solid var(--doc-line)", padding: "10px 8px" }}>{money(a.credit)}</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {a.credit === 0 && (
        <div data-pdf-break style={{ width: "fit-content", margin: "12px 0", border: "2px solid var(--doc-teal)", borderRadius: 8, padding: "5px 18px", color: "var(--doc-teal)", fontSize: 17, fontWeight: 800, letterSpacing: 1 }}>PAID / مدفوع</div>
      )}
      {invoice.notes && (
        <p data-pdf-break style={{ fontSize: 12, marginTop: 14, borderInlineStart: "3px solid var(--doc-copper)", padding: "8px 12px", background: "var(--doc-group-bg)", borderRadius: 6 }}>
          ملاحظات: {invoice.notes}
        </p>
      )}
      <p data-pdf-break style={{ fontSize: 10.5, marginTop: 8, color: "var(--doc-muted)" }}>
        الخدمات الطبية معفاة من ضريبة القيمة المضافة وفق القانون ٦٧ لسنة ٢٠١٦. هذا الإيصال لا يُعتد
        به إلا بعد ختمه وتوقيعه.
      </p>
      <SignatureBlock roles={["أمين الخزينة", "توقيع المريض / المستلم"]} />
    </OfficialDocument>
  );
});
