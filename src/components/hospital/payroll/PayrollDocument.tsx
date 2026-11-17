import { forwardRef } from "react";
import { sortDepartments, type Department } from "@/lib/hospital/constants";
import { money, int } from "@/lib/hospital/format";
import { sumPayroll, type PayrollLine } from "@/lib/hospital/payroll-tax";
import type { Employee, HospitalSettings } from "@/lib/hospital/store";
import { OfficialDocument, SignatureBlock } from "../OfficialDocument";

export interface PayrollRow {
  employee: Employee;
  line: PayrollLine;
  months: number;
  duration: string;
}

export const PayrollDocument = forwardRef<
  HTMLDivElement,
  {
    settings: HospitalSettings;
    departments: Department[];
    rows: PayrollRow[];
    annual: boolean;
    title: string;
    subtitle: string;
    issuedOn: string;
  }
>(function PayrollDocument(
  { settings, departments, rows, annual, title, subtitle, issuedOn },
  ref,
) {
  const total = sumPayroll(rows.map((r) => r.line));
  const cols = annual ? 12 : 11;
  let serial = 0;
  return (
    <OfficialDocument
      ref={ref}
      settings={settings}
      title={title}
      subtitle={subtitle}
      issuedOn={issuedOn}
      orientation="landscape"
    >
      <table className="doc-table">
        <thead>
          <tr data-pdf-break>
            <th style={{ width: 30 }}>م</th>
            <th>اسم الموظف</th>
            <th>الوظيفة</th>
            <th>مدة العمل</th>
            {annual && <th>عدد الأشهر</th>}
            <th>الأجر الأساسي الثابت</th>
            <th>الأجر المتغير / البدلات</th>
            <th>إجمالي الأجر</th>
            <th>التأمينات الاجتماعية ({int(settings.siEmployeeRate * 100)}٪)</th>
            <th>ضريبة كسب العمل</th>
            <th>إجمالي الاستقطاعات</th>
            <th>صافي الأجر</th>
          </tr>
        </thead>
        <tbody>
          {sortDepartments(departments).map((dep) => {
            const deptRows = rows.filter((r) => r.employee.department === dep.id);
            if (!deptRows.length) return null;
            const sub = sumPayroll(deptRows.map((r) => r.line));
            return [
              <tr key={`${dep.id}-h`} className="doc-group" data-pdf-break>
                <td colSpan={cols + 1}>مركز التكلفة: قسم {dep.name}</td>
              </tr>,
              ...deptRows.map((r) => {
                serial += 1;
                return (
                  <tr key={r.employee.id} data-pdf-break>
                    <td>{int(serial)}</td>
                    <td className="text-start">{r.employee.name}</td>
                    <td className="text-start">{r.employee.jobTitle}</td>
                    <td>{r.duration}</td>
                    {annual && <td>{int(r.months)}</td>}
                    <td>{money(r.line.fixed)}</td>
                    <td>{money(r.line.variable)}</td>
                    <td>{money(r.line.gross)}</td>
                    <td>{money(r.line.socialInsurance)}</td>
                    <td>{money(r.line.incomeTax)}</td>
                    <td>{money(r.line.totalDeductions)}</td>
                    <td style={{ fontWeight: 700 }}>{money(r.line.net)}</td>
                  </tr>
                );
              }),
              <tr key={`${dep.id}-s`} className="doc-subtotal" data-pdf-break>
                <td colSpan={annual ? 5 : 4} className="text-start">
                  إجمالي قسم {dep.name}
                </td>
                <td>{money(sub.fixed)}</td>
                <td>{money(sub.variable)}</td>
                <td>{money(sub.gross)}</td>
                <td>{money(sub.socialInsurance)}</td>
                <td>{money(sub.incomeTax)}</td>
                <td>{money(sub.totalDeductions)}</td>
                <td>{money(sub.net)}</td>
              </tr>,
            ];
          })}
          <tr className="doc-total" data-pdf-break>
            <td colSpan={annual ? 5 : 4} className="text-start">
              الإجمالي العام ({int(rows.length)} موظف)
            </td>
            <td>{money(total.fixed)}</td>
            <td>{money(total.variable)}</td>
            <td>{money(total.gross)}</td>
            <td>{money(total.socialInsurance)}</td>
            <td>{money(total.incomeTax)}</td>
            <td>{money(total.totalDeductions)}</td>
            <td>{money(total.net)}</td>
          </tr>
        </tbody>
      </table>

      <div data-pdf-break style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 12 }}>
        <div style={{ flex: 1, border: "1px solid var(--doc-line)", padding: "8px 12px" }}>
          <div style={{ fontWeight: 700, color: "var(--doc-teal)" }}>
            ملخص الالتزامات الضريبية والتأمينية
          </div>
          <div>ضريبة كسب العمل المستحقة للتوريد لمصلحة الضرائب: {money(total.incomeTax)} ج.م</div>
          <div>حصة العاملين في التأمينات الاجتماعية: {money(total.socialInsurance)} ج.م</div>
          <div>
            حصة صاحب العمل في التأمينات ({money(settings.siEmployerRate * 100)}٪):{" "}
            {money(total.employerInsurance)} ج.م
          </div>
          <div style={{ fontWeight: 700 }}>
            إجمالي المستحق لهيئة التأمينات: {money(total.socialInsurance + total.employerInsurance)}{" "}
            ج.م
          </div>
        </div>
        <div
          style={{
            flex: 1,
            border: "1px solid var(--doc-line)",
            padding: "8px 12px",
            color: "var(--doc-muted)",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--doc-teal)" }}>أساس الاحتساب</div>
          <div>
            الضريبة وفق القانون ٩١ لسنة ٢٠٠٥ وتعديلاته بالقانون ٧ لسنة ٢٠٢٤ — إعفاء شخصي{" "}
            {money(settings.personalExemption)} ج.م سنويًا.
          </div>
          <div>
            التأمينات وفق القانون ١٤٨ لسنة ٢٠١٩ — أجر الاشتراك بين {money(settings.siMinWage)} و
            {money(settings.siMaxWage)} ج.م شهريًا.
          </div>
          <div>
            إجمالي الأجر = الأجر الأساسي الثابت + الأجر المتغير. صافي الأجر = الإجمالي − (التأمينات
            + الضريبة).
          </div>
        </div>
      </div>

      <SignatureBlock roles={["المحاسب المختص", "المدير المالي", "مدير المستشفى"]} />
    </OfficialDocument>
  );
});
