'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { listWindowsPrinters, type WindowsPrinterInfo } from '@/lib/desktop/printing';
import { getA4Printer, setA4Printer } from '@/lib/desktop/a4-print';

/**
 * Khatario for Windows: choose the A4 / A5 printer so Print sends GST bills straight to it, with no
 * print dialog. "Ask every time" keeps the PDF + print dialog.
 */
export function A4PrinterCard({ businessId, onSaved }: { businessId: string; onSaved?: (message: string) => void }) {
  const [printers, setPrinters] = useState<WindowsPrinterInfo[] | null>(null);
  const [choice, setChoice] = useState('');
  const [copies, setCopies] = useState(1);

  useEffect(() => {
    const saved = getA4Printer(businessId);
    setChoice(saved?.printer ?? '');
    setCopies(saved?.copies ?? 1);
    listWindowsPrinters()
      .then((list) => setPrinters(list.filter((p) => p.attachment !== 'virtual' || /pdf/i.test(p.name))))
      .catch(() => setPrinters([]));
  }, [businessId]);

  const save = (printer: string, n: number) => {
    setChoice(printer);
    setCopies(n);
    setA4Printer(businessId, printer ? { printer, copies: n } : null);
    onSaved?.(printer ? `A4 bills now print straight to ${printer}` : 'A4 bills will open the print dialog');
  };

  return (
    <Card padding="md" className="mt-4">
      <div className="mb-3 flex items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold">A4 / A5 bills</h2>
          <p className="text-sm text-text-secondary">
            Choose a printer and Print sends the bill straight to it, without the print dialog. Layout comes from your
            invoice template.
          </p>
        </div>
      </div>
      {printers === null ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for printers…
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <select
            aria-label="A4 printer"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            value={choice}
            onChange={(e) => save(e.target.value, copies)}
          >
            <option value="">Ask every time (print dialog)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' (Windows default)' : ''}
              </option>
            ))}
          </select>
          <select
            aria-label="Copies"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            value={copies}
            disabled={!choice}
            onChange={(e) => save(choice, Number(e.target.value))}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'copy' : 'copies'}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}
