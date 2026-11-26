/** Excel-friendly CSV download (UTF-8 BOM for Arabic, formula-safe cells). Browser only. */
export function csvCell(v: unknown) {
  let text = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
