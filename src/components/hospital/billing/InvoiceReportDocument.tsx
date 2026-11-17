import { forwardRef, Fragment } from "react";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { deskTotals, invoiceContext } from "@/lib/hospital/invoice-export";
import { deskOf } from "@/lib/hospital/catalog";
import { listLabel, type HospitalDB, type PatientInvoice } from "@/lib/hospital/store";
import { DocInfoGrid } from "../kit";
import { OfficialDocument, SignatureBlock } from "../OfficialDocument";

/** Landscape report of an invoice batch: totals per section, then every invoice by section. */
export const InvoiceReportDocument = forwardRef<
  HTMLDivElement,
  { db: HospitalDB; invoices: PatientInvoice[]; period: string; filters: string; batchNo?: string | undefined }
>(function InvoiceReportDocument({ db, invoices, period, filters, batchNo }, ref) {
  const { rows, grand } = deskTotals(invoices);
  return (
    <OfficialDocument
      ref={ref}
      settings={db.settings}
      orientation="landscape"
      title="تقرير الفواتير المصدَّرة"
      subtitle={batchNo ? <>رقم دفعة التصدير: <span dir="ltr">{batchNo}</span></> : period}
      issuedOn={dateLabel(isoDate(new Date()))}
    >
      <DocInfoGrid
        items={[
          ["الفترة", period],
          ["عدد الفواتير", int(grand.count)],
          ["صافي الإيرادات", `${money(grand.total)} ج.م`],
          ["المحصَّل من المرضى", `${money(grand.patientShare)} ج.م`],
          ["على جهات التعاقد", `${money(grand.insurerShare)} ج.م`],
          ["الفلاتر", filters || "الكل"],
        ]}
      />
      <table className="doc-table">
        <thead>
          <tr data-pdf-break>
            <th>القسم</th>
            <th>عدد الفواتير</th>
            <th>الإجمالي</th>
            <th>الخصم</th>
            <th>الصافي</th>
            <th>نصيب جهات التعاقد</th>
            <th>المحصَّل من المرضى</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-pdf-break>
              <td className="text-start">{r.label}</td>
              <td>{int(r.count)}</td>
              <td>{money(r.subtotal)}</td>
              <td>{money(r.discount)}</td>
              <td>{money(r.total)}</td>
              <td>{money(r.insurerShare)}</td>
              <td>{money(r.patientShare)}</td>
            </tr>
          ))}
          <tr className="doc-total" data-pdf-break>
            <td className="text-start">الإجمالي</td>
            <td>{int(grand.count)}</td>
            <td>{money(grand.subtotal)}</td>
            <td>{money(grand.discount)}</td>
            <td>{money(grand.total)}</td>
            <td>{money(grand.insurerShare)}</td>
            <td>{money(grand.patientShare)}</td>
          </tr>
        </tbody>
      </table>

      <table className="doc-table" style={{ marginTop: 14 }}>
        <thead>
          <tr data-pdf-break>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>المريض</th>
            <th>العيادة / المحوِّل / الطبيب</th>
            <th>الخدمات</th>
            <th>الدفع</th>
            <th>الصافي</th>
            <th>المدفوع</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.key}>
              <tr className="doc-group" data-pdf-break>
                <td colSpan={8} className="text-start">
                  {r.label} — {int(r.count)} فاتورة
                </td>
              </tr>
              {invoices
                .filter((i) => deskOf(i.department).key === r.key)
                .map((inv) => {
                  const a = invoiceAmounts(inv);
                  const c = invoiceContext(db, inv);
                  return (
                    <tr key={inv.id} data-pdf-break>
                      <td dir="ltr">{inv.number}</td>
                      <td>{dateLabel(inv.date)}</td>
                      <td className="text-start">{inv.patientName}</td>
                      <td className="text-start">
                        {[c.desk.key === "other" ? c.section : "", c.clinic && `عيادة ${c.clinic}`, c.referredBy, c.doctor && `د. ${c.doctor}`]
                          .filter(Boolean)
                          .join(" — ") || "—"}
                      </td>
                      <td className="text-start" style={{ fontSize: 10.5 }}>
                        {[...(a.days ? [`إقامة ${int(a.days)} يوم`] : []), ...inv.items.map((x) => x.description)].join("، ")}
                      </td>
                      <td>
                        {listLabel(db.lists.paymentMethods, inv.paymentMethod)}
                        {inv.payer ? ` + ${listLabel(db.lists.payers, inv.payer.payerId)}` : ""}
                      </td>
                      <td>{money(a.total)}</td>
                      <td>{money(a.patientShare)}</td>
                    </tr>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
      <SignatureBlock roles={["المحاسب", "المراجع", "المدير المالي"]} />
    </OfficialDocument>
  );
});
