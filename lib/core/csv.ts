/**
 * CSV, written out rather than pulled in.
 *
 * The format is four rules and the whole risk is in the fourth one, which most
 * libraries do not implement because it is not part of the format at all.
 */

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => unknown;
}

/**
 * A field that begins with one of these is executed as a formula by Excel, Google
 * Sheets and LibreOffice when the file is opened.
 *
 * That matters here because this export carries free text the trader typed. A
 * note beginning "=1+1" is harmless; one beginning with a formula that calls out
 * to a URL is a way of exfiltrating the rest of the sheet the moment somebody
 * opens it, and a journal exported to be shared with a coach or a friend is
 * exactly the file that gets opened. Prefixing an apostrophe makes the cell
 * literal text; the apostrophe itself is not shown by any of them.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeField(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const wasText = typeof raw === "string";
  let s = wasText ? (raw as string) : String(raw);
  /*
   * Only text is guarded.
   *
   * Applied to everything, this would prefix every negative number with an
   * apostrophe — and a column of P&L stored as text is a column that will not
   * add up, which is the first thing anyone does with an exported journal. A
   * number, a boolean or a date cannot carry a formula, because the code put
   * them there rather than the trader.
   */
  if (wasText && FORMULA_START.test(s)) s = `'${s}`;
  // Quoting is required for the separator, the quote itself and any newline;
  // leading or trailing spaces are quoted too, because some readers trim.
  if (/[",\n\r]/.test(s) || s !== s.trim()) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface CsvOptions {
  /**
   * A byte-order mark, which is what makes Excel read the file as UTF-8 rather
   * than as the machine's local code page. Without it a note containing a dash
   * or an accent arrives as mojibake, and spreadsheets are what this export is
   * for. Off when something else is going to parse the file.
   */
  bom?: boolean;
  /** CRLF is what the specification says and what spreadsheets expect. */
  newline?: "\r\n" | "\n";
}

export function toCsv<T>(rows: T[], columns: Column<T>[], opts: CsvOptions = {}): string {
  const nl = opts.newline ?? "\r\n";
  const lines = [
    columns.map((c) => escapeField(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => escapeField(c.value(r))).join(",")),
  ];
  return (opts.bom === false ? "" : "﻿") + lines.join(nl) + nl;
}

/** An ISO instant with no sub-second noise, which is what a spreadsheet wants. */
export const isoSecond = (d: Date | null | undefined) =>
  d ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
