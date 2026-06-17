import Papa from "papaparse";
import ExcelJS from "exceljs";

export const CDR_HEADER_KEYWORDS: Record<string, string[]> = {
  user: ["user name", "agent name", "employee", "staff", "agent", "seat", "login", "extension", "user"],
  direction: ["direction", "call direction", "call type", "type"],
  answered: ["answer indicator", "answered", "answer", "connected", "status", "result", "disposition"],
  answered_ext: ["answered by extension", "answered extension", "answer extension", "answered ext"],
  duration: ["duration (hh:mm:ss)", "duration", "talk time", "length", "handle time", "dur"],
  date: ["start date (mm/dd/yyyy)", "start date", "call date", "date (mm/dd/yyyy)", "date"],
  time: ["start time (hh:mm:ss) central", "start time", "call time", "time"],
  source_file: ["source file", "source", "file name"],
  caller_id_name: ["caller id name", "caller name", "caller"],
  calling_tn: ["calling tn", "calling number", "caller number", "from number", "ani", "calling party", "from"],
  called_tn: ["called tn", "called number", "dialed number", "to number", "dnis", "called party", "destination", "to"],
  local_call_id: ["local call id", "local id"],
  remote_call_id: ["remote call id", "remote id"],
  call_result: ["call result", "call disposition", "disposition", "result"],
};

export const MAPPING_HEADER_KEYWORDS: Record<string, string[]> = {
  branch_id: ["branch #", "branch number", "branch id", "branch no"],
  branch_name: ["branch name", "branch"],
  address: ["address"],
  phone: ["phone"],
  fax: ["fax"],
  opened: ["opened", "open date"],
  dm_name: ["district manager", "manager", "dm"],
  staff_name: ["staff name", "agent name", "employee", "staff", "agent", "name"],
  extension: ["extension", "ext"],
  cdr_name: ["cdr name", "user name", "username", "cdr", "seat"],
};

export const norm = (s: unknown) => String(s ?? "").replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
export const cell = (row: Record<string, unknown>, header?: string | null) => (header ? String(row[header] ?? "").trim() : "");
export const phoneDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function excelCellValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return value;
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value) return value.result ?? "";
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
  return String(value);
}

export async function readRows(buf: Buffer, fileName: string): Promise<Record<string, unknown>[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    throw new Error("Legacy .xls files are not supported by the Nest backend. Convert the file to .xlsx or .csv before upload.");
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = String(excelCellValue(cell.value) ?? "").replace(/^\uFEFF/, "").trim();
    });
    const rows: Record<string, unknown>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const out: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = excelCellValue(row.getCell(index + 1).value);
        if (String(value ?? "").trim()) hasValue = true;
        out[header] = value ?? "";
      });
      if (hasValue) rows.push(out);
    });
    return rows;
  }
  const parsed = Papa.parse<Record<string, unknown>>(buf.toString("utf-8"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });
  return parsed.data;
}

export function detectColumns(headers: string[], spec: Record<string, string[]>): Record<string, string> {
  const normalized = headers.map((h) => ({ raw: h, norm: norm(h) }));
  const found: Record<string, string> = {};
  for (const [field, keywords] of Object.entries(spec)) {
    let match = normalized.find((h) => keywords.some((kw) => h.norm === kw));
    if (!match) {
      match = normalized.find((h) =>
        keywords.some((kw) => {
          const k = norm(kw);
          if (k.length <= 2) return false;
          const boundary = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
          return boundary.test(h.norm);
        }),
      );
    }
    if (match) found[field] = match.raw;
  }
  return found;
}

export function normalizeDateString(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function normalizeDirection(value: string): "Inbound" | "Outbound" | null {
  const v = norm(value);
  if (v.startsWith("in")) return "Inbound";
  if (v.startsWith("out")) return "Outbound";
  return null;
}

export function isSystemUser(value: string): boolean {
  return /hunt group|auto attendant|hg\)|aa\)/i.test(value) || /^main/i.test(value.trim());
}
