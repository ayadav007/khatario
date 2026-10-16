/**
 * A4 / A5 bills in Khatario for Windows: when an "A4 printer" is chosen on this computer, Print sends
 * the bill straight to it (no dialog) through the desktop app; otherwise the PDF opens as before.
 */

import { DesktopPrintError, isDesktopPrintingAvailable } from './printing';
import { tauriInvoke } from './platform';

export type A4PrinterSetting = { printer: string; copies: number };

const KEY = 'khatario.a4-printer.';

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getA4Printer(businessId: string): A4PrinterSetting | null {
  if (!businessId || !isDesktopPrintingAvailable()) return null;
  try {
    const raw = JSON.parse(store()?.getItem(KEY + businessId) || 'null');
    if (!raw || typeof raw.printer !== 'string' || !raw.printer) return null;
    return { printer: raw.printer, copies: Math.min(5, Math.max(1, Number(raw.copies) || 1)) };
  } catch {
    return null;
  }
}

export function setA4Printer(businessId: string, value: A4PrinterSetting | null): void {
  try {
    if (value) store()?.setItem(KEY + businessId, JSON.stringify(value));
    else store()?.removeItem(KEY + businessId);
  } catch {
    /* ignore */
  }
}

/** The print page the desktop app loads in a hidden window (app/print/document). */
export function printDocumentPath(src: string): string {
  return `/print/document?src=${encodeURIComponent(src)}`;
}

/** Prints an HTML preview endpoint (returns `{ html }`) to a Windows printer without a dialog. */
export async function printDocumentSilently(src: string, setting: A4PrinterSetting): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new DesktopPrintError('Direct A4 printing needs Khatario for Windows.');
  try {
    await invoke('desktop_print_page', { path: printDocumentPath(src), printer: setting.printer, copies: setting.copies });
  } catch (err) {
    const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
    if (/not allowed|not found|unknown command/i.test(message)) {
      throw new DesktopPrintError('Update Khatario for Windows to print A4 bills directly.');
    }
    throw new DesktopPrintError(message || 'Could not print the bill.');
  }
}

/**
 * Print an invoice on A4/A5: straight to the chosen printer in the Windows app, else open the PDF.
 * Returns how it went so the page can show the right message.
 */
export async function printInvoiceA4(
  invoiceId: string,
  userId: string | undefined,
  businessId: string | undefined
): Promise<{ mode: 'printed'; printer: string } | { mode: 'opened'; error?: string }> {
  const pdfUrl = `/api/invoices/${invoiceId}/pdf?user_id=${userId ?? ''}`;
  const setting = getA4Printer(businessId || '');
  if (setting) {
    try {
      await printDocumentSilently(`/api/invoices/${invoiceId}/preview`, setting);
      return { mode: 'printed', printer: setting.printer };
    } catch (err) {
      window.open(pdfUrl, '_blank');
      return { mode: 'opened', error: err instanceof Error ? err.message : String(err) };
    }
  }
  window.open(pdfUrl, '_blank');
  return { mode: 'opened' };
}
