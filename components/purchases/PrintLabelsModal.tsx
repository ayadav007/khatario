'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, X, Minus, Plus, Bluetooth } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';

interface PurchaseLabelLine {
  row_id: string;
  item_id: string | null;
  variant_id: string | null;
  batch_id: string | null;
  name: string;
  barcode: string | null;
  barcode_type: string | null;
  quantity: number;
  copies: number;
  selling_price: number | null;
  mrp: number | null;
  batch_number: string | null;
  mfg_date: string | null;
  expiry_date: string | null;
  track_batch: boolean;
}

interface PrintLabelsModalProps {
  open: boolean;
  onClose: () => void;
  purchaseId: string;
  businessId: string;
}

type Layout = 'A4_SHEET' | 'ROLL';
type Format = 'pdf' | 'html' | 'zpl' | 'bluetooth';

export function PrintLabelsModal({
  open,
  onClose,
  purchaseId,
  businessId,
}: PrintLabelsModalProps) {
  const toast = useToastContext();
  const bt = useBluetoothPrinter();
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [lines, setLines] = useState<PurchaseLabelLine[]>([]);
  const [layout, setLayout] = useState<Layout>('A4_SHEET');
  const [format, setFormat] = useState<Format>('pdf');
  const [encodeGs1, setEncodeGs1] = useState(false);
  const [templates, setTemplates] = useState<
    { id: string; name: string; is_system: boolean }[]
  >([]);
  const [templateId, setTemplateId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/label-templates?business_id=${businessId}`
        );
        if (res.ok) {
          const data = await res.json();
          setTemplates(
            (data.templates || []).map((t: any) => ({
              id: t.id,
              name: t.name,
              is_system: !!t.is_system,
            }))
          );
        }
      } catch {
        // Feature may be disabled; silent fallback to default layouts.
      }
    })();
  }, [open, businessId]);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/purchases/${purchaseId}/labels?business_id=${businessId}`
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error || 'Failed to load purchase items');
          onClose();
          return;
        }
        const data = await res.json();
        setLines((data.lines || []) as PurchaseLabelLine[]);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load purchase items');
        onClose();
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purchaseId, businessId]);

  const totalCopies = useMemo(
    () => lines.reduce((s, l) => s + Math.max(0, l.copies || 0), 0),
    [lines]
  );

  const updateCopies = (rowId: string, copies: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.row_id === rowId
          ? { ...l, copies: Math.max(0, Math.min(999, Math.floor(copies))) }
          : l
      )
    );
  };

  const printable = useMemo(
    () => lines.filter((l) => l.copies > 0 && l.barcode && l.item_id),
    [lines]
  );

  const handlePrint = async () => {
    if (printable.length === 0) {
      toast.warning('No printable lines (set copies > 0 and ensure each item has a barcode)');
      return;
    }

    const payloadLines = printable.map((l) => ({
      item_id: l.item_id!,
      variant_id: l.variant_id,
      batch_id: l.batch_id,
      copies: l.copies,
    }));

    setPrinting(true);
    try {
      if (format === 'bluetooth') {
        if (!bt.supported) {
          toast.error(
            'Bluetooth is not available in this browser. Use Chrome on Android or desktop Chrome/Edge.'
          );
          return;
        }
        if (bt.savedPrinters.length === 0) {
          toast.error(
            'No Bluetooth printer paired. Go to Settings → Bluetooth Printer to pair one first.'
          );
          return;
        }
        const res = await fetch(
          `/api/labels/print?business_id=${businessId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lines: payloadLines,
              layout: templateId ? undefined : layout,
              template_id: templateId || undefined,
              format: 'json',
              purpose: 'purchase',
              purchase_id: purchaseId,
              symbology: encodeGs1 ? 'GS1_128' : undefined,
            }),
          }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error || `Print failed (${res.status})`);
          return;
        }
        const payload = await res.json();
        const hydratedLines = (payload.lines || []).map((l: any) => ({
          ...l,
          mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
          expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
        }));
        await bt.printLabels({
          template: payload.template,
          lines: hydratedLines,
          businessName: payload.businessName || '',
        });
        toast.success('Labels sent to Bluetooth printer');
        onClose();
        return;
      }

      const res = await fetch(
        `/api/labels/print?business_id=${businessId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lines: payloadLines,
            layout: templateId ? undefined : layout,
            template_id: templateId || undefined,
            format,
            purpose: 'purchase',
            purchase_id: purchaseId,
            symbology: encodeGs1 ? 'GS1_128' : undefined,
          }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error || `Print failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === 'zpl') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `labels-${Date.now()}.zpl`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const win = window.open(url, '_blank');
        if (!win) {
          const a = document.createElement('a');
          a.href = url;
          a.download = format === 'pdf' ? 'labels.pdf' : 'labels.html';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast.error(err?.message || 'Print failed');
    } finally {
      setPrinting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Print Labels from Purchase
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Copies are pre-filled from received quantities. Adjust as needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : lines.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <p className="text-base font-medium">No items on this purchase</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-2 pr-3">Item / Variant</th>
                  <th className="py-2 pr-3">Barcode</th>
                  <th className="py-2 pr-3">Batch</th>
                  <th className="py-2 pr-3">EXP</th>
                  <th className="py-2 pr-3 text-right">Qty Recv'd</th>
                  <th className="py-2 pr-3 text-right">MRP</th>
                  <th className="py-2 pr-3 text-right w-40">Copies</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const noBarcode = !l.barcode;
                  return (
                    <tr
                      key={l.row_id}
                      className={`border-b border-gray-100 ${
                        noBarcode ? 'bg-amber-50' : ''
                      }`}
                    >
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">
                          {l.name}
                        </div>
                        {noBarcode && (
                          <div className="text-xs text-amber-700 mt-0.5">
                            No barcode on file — generate one in Items first
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {l.barcode || '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {l.batch_number || (l.track_batch ? '—' : '')}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {l.expiry_date
                          ? new Date(l.expiry_date).toLocaleDateString()
                          : ''}
                      </td>
                      <td className="py-2 pr-3 text-right">{l.quantity}</td>
                      <td className="py-2 pr-3 text-right">
                        {l.mrp != null ? `₹${l.mrp.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={noBarcode || l.copies <= 0}
                            onClick={() =>
                              updateCopies(l.row_id, l.copies - 1)
                            }
                            className="p-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            disabled={noBarcode}
                            value={l.copies}
                            onChange={(e) =>
                              updateCopies(
                                l.row_id,
                                parseInt(e.target.value || '0', 10)
                              )
                            }
                            className="w-16 text-right border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                          <button
                            type="button"
                            disabled={noBarcode}
                            onClick={() =>
                              updateCopies(l.row_id, (l.copies || 0) + 1)
                            }
                            className="p-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {templates.length > 0 && (
              <>
                <label className="text-gray-500">Template</label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 max-w-[180px]"
                >
                  <option value="">Default layout</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_system ? ' (system)' : ''}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="text-gray-500">Layout</label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as Layout)}
              disabled={!!templateId}
              className="border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500"
              title={templateId ? 'Template controls layout' : ''}
            >
              <option value="A4_SHEET">A4 sheet (21-up)</option>
              <option value="ROLL">Roll 50×25mm</option>
            </select>
            <label className="text-gray-500 ml-2">Output</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              className="border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="pdf">PDF</option>
              <option value="html">HTML (browser print)</option>
              <option value="zpl">ZPL (thermal printer file)</option>
              <option value="bluetooth" disabled={!bt.supported}>
                Bluetooth printer{bt.supported ? '' : ' (unsupported)'}
              </option>
            </select>
            <label className="ml-2 inline-flex items-center gap-1 text-gray-700">
              <input
                type="checkbox"
                checked={encodeGs1}
                onChange={(e) => setEncodeGs1(e.target.checked)}
              />
              Encode batch/expiry as GS1-128
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handlePrint}
              disabled={printing || totalCopies === 0}
              className="bg-primary-600 hover:bg-primary-700"
            >
              {printing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : format === 'bluetooth' ? (
                <Bluetooth className="w-4 h-4 mr-2" />
              ) : (
                <Printer className="w-4 h-4 mr-2" />
              )}
              Print {totalCopies} label{totalCopies === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
