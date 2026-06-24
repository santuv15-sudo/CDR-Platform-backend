/** Build an Excel-readable .xls payload (Office HTML-table workbook) from row objects.
 *  Opens directly in Excel/Sheets as a worksheet — no spreadsheet library required. */
export function toXls(rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const head = `<tr>${headers.map((h) => `<th style="background:#eee;font-weight:bold">${esc(h)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`).join("");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table border="1">${head}${body}</table></body></html>`;
}
