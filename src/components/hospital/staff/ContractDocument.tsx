import { forwardRef } from "react";
import { OfficialDocument } from "@/components/hospital/OfficialDocument";
import { findDepartment, HOSPITAL } from "@/lib/hospital/constants";
import { dateLabel } from "@/lib/hospital/format";
import { CONTRACT_TYPES, contractClauses } from "@/lib/hospital/hr";
import { parseNationalId } from "@/lib/hospital/national-id";
import type { Employee, EmploymentContract, HospitalDB } from "@/lib/hospital/store";

const line = "....................................";

/** The printable employment contract (two parties, clauses, signatures). */
export const ContractDocument = forwardRef<
  HTMLDivElement,
  { db: HospitalDB; contract: EmploymentContract; employee: Employee; signature?: string | null }
>(function ContractDocument({ db, contract: c, employee: e, signature }, ref) {
  const dept = findDepartment(db.departments, c.department).name;
  const clauses = contractClauses(c, dept, HOSPITAL.name);
  const nid = e.nationalId ? parseNationalId(e.nationalId) : null;
  const birth = e.personal?.birthDate || (nid && !("error" in nid) ? nid.birthDate : "");
  const cell = { padding: "6px 10px", border: "1px solid var(--doc-line)" } as const;
  return (
    <OfficialDocument
      ref={ref}
      settings={db.settings}
      title={`عقد عمل — ${CONTRACT_TYPES[c.type]}`}
      subtitle={<span dir="ltr">{c.number}</span>}
      issuedOn={dateLabel(c.date)}
    >
      <p data-pdf-break style={{ fontSize: 13.5, marginBottom: 10 }}>
        إنه في يوم {dateLabel(c.date)} تحرر هذا العقد بين كل من:
      </p>
      <table data-pdf-break style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 14 }}>
        <tbody>
          <tr>
            <td style={{ ...cell, width: "18%", fontWeight: 700 }}>الطرف الأول</td>
            <td style={cell} colSpan={3}>
              {HOSPITAL.name} — {HOSPITAL.owner}
              {db.settings.address ? ` — العنوان: ${db.settings.address}` : ""}
              {db.settings.commercialRegister ? ` — سجل تجاري ${db.settings.commercialRegister}` : ""} (صاحب العمل)
            </td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>الطرف الثاني</td>
            <td style={cell}>{e.name}</td>
            <td style={{ ...cell, fontWeight: 700, width: "16%" }}>الرقم القومي</td>
            <td style={cell} dir="ltr">{e.nationalId || line}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>تاريخ الميلاد</td>
            <td style={cell}>{birth ? dateLabel(birth) : line}</td>
            <td style={{ ...cell, fontWeight: 700 }}>التليفون</td>
            <td style={cell} dir="ltr">{e.personal?.phone || line}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>العنوان</td>
            <td style={cell}>{e.personal?.address || line}</td>
            <td style={{ ...cell, fontWeight: 700 }}>المؤهل</td>
            <td style={cell}>{e.personal?.qualification || line}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>الرقم التأميني</td>
            <td style={cell} colSpan={3} dir="ltr">{e.personal?.insuranceNo || line}</td>
          </tr>
        </tbody>
      </table>
      <p data-pdf-break style={{ fontSize: 13, marginBottom: 8 }}>
        وبعد أن أقر الطرفان بأهليتهما للتعاقد، اتفقا على ما يلي:
      </p>
      <ol style={{ fontSize: 13, paddingInlineStart: 22, margin: 0 }}>
        {clauses.map((t, i) => (
          <li key={i} data-pdf-break style={{ marginBottom: 6 }}>
            <b>البند {i + 1}: </b>
            {t}
          </li>
        ))}
      </ol>
      <div data-pdf-break style={{ display: "flex", justifyContent: "space-around", marginTop: 34, fontSize: 13 }}>
        <div style={{ textAlign: "center", minWidth: 220 }}>
          <div style={{ fontWeight: 700 }}>الطرف الأول (صاحب العمل)</div>
          <div style={{ marginTop: 8 }}>{HOSPITAL.name}</div>
          <div style={{ height: 70 }} />
          <div style={{ borderTop: "1px dashed var(--doc-line)", paddingTop: 4, color: "var(--doc-muted)" }}>التوقيع والختم</div>
        </div>
        <div style={{ textAlign: "center", minWidth: 220 }}>
          <div style={{ fontWeight: 700 }}>الطرف الثاني (العامل)</div>
          <div style={{ marginTop: 8 }}>{e.name}</div>
          <div style={{ height: 70, display: "grid", placeItems: "center" }}>
            {signature ? <img src={signature} alt="" style={{ maxHeight: 66, maxWidth: 200 }} /> : null}
          </div>
          <div style={{ borderTop: "1px dashed var(--doc-line)", paddingTop: 4, color: "var(--doc-muted)" }}>
            {c.status !== "draft" && c.signedAt ? `وُقِّع بتاريخ ${dateLabel(c.signedAt)}` : "التوقيع"}
          </div>
        </div>
      </div>
    </OfficialDocument>
  );
});
