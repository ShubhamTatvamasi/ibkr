export type Cell = string | number | undefined | null;

function quote(v: Cell): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line endings (what Excel and most CA tools expect). */
export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}
