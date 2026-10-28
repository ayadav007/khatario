/**
 * Spreadsheet formula guard for CSV exports. A cell that starts with = + - @ (or a tab / CR)
 * is run as a formula by Excel and Sheets, so text such as a customer name `=HYPERLINK(...)`
 * is prefixed with an apostrophe. Plain numbers, including negatives, are left alone.
 */
export function csvSafeText(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value}`;
}
