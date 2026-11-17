import { forwardRef, type ReactNode } from "react";
import { HOSPITAL } from "@/lib/hospital/constants";
import type { HospitalSettings } from "@/lib/hospital/store";

const placeholder = "................................";

/**
 * Printable document with the mandatory hospital letterhead. Rendered off-screen and
 * captured by exportOfficialPdf(); the header part is repeated on every PDF page.
 */
export const OfficialDocument = forwardRef<
  HTMLDivElement,
  {
    settings: HospitalSettings;
    title: string;
    subtitle?: ReactNode;
    issuedOn: string;
    orientation?: "portrait" | "landscape";
    format?: "a4" | "a5";
    children: ReactNode;
  }
>(function OfficialDocument(
  { settings, title, subtitle, issuedOn, orientation = "portrait", format = "a4", children },
  ref,
) {
  const compact = format === "a5";
  const width = compact ? 620 : orientation === "landscape" ? 1123 : 794;
  return (
    <div
      ref={ref}
      data-pdf-root
      data-orientation={orientation}
      data-format={format}
      aria-hidden
      className="pointer-events-none fixed top-0"
      style={{ left: -20000, width }}
    >
      <div data-pdf-header className="official-doc" style={{ paddingBottom: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'El Messiri', 'Cairo', serif",
                fontSize: compact ? 23 : 30,
                fontWeight: 700,
                color: "var(--doc-teal)",
                lineHeight: 1.3,
              }}
            >
              {HOSPITAL.name}
            </div>
            <div
              style={{ fontSize: compact ? 12.5 : 15, fontWeight: 600, color: "var(--doc-copper)" }}
            >
              {HOSPITAL.owner}
            </div>
          </div>
          <div
            style={{
              width: compact ? 46 : 64,
              height: compact ? 46 : 64,
              borderRadius: 999,
              border: "3px solid var(--doc-teal)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width={compact ? 22 : 30}
              height={compact ? 22 : 30}
              viewBox="0 0 24 24"
              fill="var(--doc-copper)"
            >
              <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" />
            </svg>
          </div>
          <div
            style={{
              fontSize: compact ? 10 : 11.5,
              color: "var(--doc-muted)",
              lineHeight: 1.8,
              minWidth: compact ? 190 : 260,
            }}
          >
            <div>العنوان: {settings.address || placeholder}</div>
            <div>التليفون: {settings.phones || placeholder}</div>
            <div>رقم التسجيل الضريبي: {settings.taxId || placeholder}</div>
            <div>السجل التجاري: {settings.commercialRegister || placeholder}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, height: 3, background: "var(--doc-teal)" }} />
        <div style={{ marginTop: 2, height: 1, background: "var(--doc-copper)" }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: 12,
          }}
        >
          <div>
            <div style={{ fontSize: compact ? 16 : 19, fontWeight: 800 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 12.5, color: "var(--doc-muted)" }}>{subtitle}</div>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--doc-muted)" }}>تاريخ الإصدار: {issuedOn}</div>
        </div>
      </div>
      <div data-pdf-body className="official-doc" style={{ paddingTop: 4 }}>
        {children}
      </div>
    </div>
  );
});

export function SignatureBlock({ roles }: { roles: string[] }) {
  return (
    <div
      data-pdf-break
      style={{ display: "flex", justifyContent: "space-around", marginTop: 36, fontSize: 12.5 }}
    >
      {roles.map((r) => (
        <div key={r} style={{ textAlign: "center", minWidth: 160 }}>
          <div style={{ fontWeight: 700 }}>{r}</div>
          <div
            style={{
              marginTop: 36,
              borderTop: "1px dashed var(--doc-line)",
              paddingTop: 4,
              color: "var(--doc-muted)",
            }}
          >
            الاسم والتوقيع
          </div>
        </div>
      ))}
    </div>
  );
}
