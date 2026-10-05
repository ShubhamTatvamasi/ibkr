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

/** For the e-filing portal's bulk upload: no quoting, so strip commas, quotes and non-ASCII. */
export function portalText(s: string | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[,"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toPortalCsv(header: string[], rows: Cell[][]): string {
  return [header.join(','), ...rows.map((r) => r.map((c) => portalText(c === undefined || c === null ? '' : String(c))).join(','))].join('\r\n') + '\r\n';
}
