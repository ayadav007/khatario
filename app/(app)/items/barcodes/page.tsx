'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  Search,
  Printer,
  CheckSquare,
  Square,
  Loader2,
  Minus,
  Plus,
  Bluetooth,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useToastContext } from '@/contexts/ToastContext';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';

interface LabelableEntry {
  row_id: string;
  item_id: string;
  variant_id: string | null;
  name: string;
  code: string | null;
  barcode: string;
  barcode_type: string | null;
  selling_price: number | null;
  mrp: number | null;
  current_stock: number | null;
  unit: string | null;
  item_type: string | null;
  is_weighed?: boolean;
  plu_code?: string | null;
  weight_barcode_mode?: 'weight' | 'price';
}

type Layout = 'A4_SHEET' | 'ROLL';
type Format = 'pdf' | 'html' | 'zpl' | 'bluetooth';

interface TemplateOption {
  id: string;
  name: string;
  format: 'A4_SHEET' | 'ROLL';
  is_system: boolean;
}

export default function BulkBarcodePrintPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const bt = useBluetoothPrinter();
  const [entries, setEntries] = useState<LabelableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  // Per-row weight/price measure for variable-measure items. Stored as the
  // raw integer (grams or paise depending on item.weight_barcode_mode). Only
  // applies to entries where is_weighed === true.
  const [weightInputs, setWeightInputs] = useState<Map<string, string>>(
    new Map()
  );
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<Layout>('A4_SHEET');
  const [format, setFormat] = useState<Format>('pdf');
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = useState<string>('');

  useEffect(() => {
    const fetchEntries = async () => {
      if (!business?.id) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/items/labelable?business_id=${business.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries || []);
        } else {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error || 'Failed to load printable items');
        }
      } catch (error: any) {
        console.error('Failed to fetch items', error);
        toast.error(error?.message || 'Failed to fetch items');
      } finally {
        setLoading(false);
      }
    };

    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  useEffect(() => {
    const fetchTemplates = async () => {
      if (!business?.id) return;
      try {
        const res = await fetch(
          `/api/label-templates?business_id=${business.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setTemplates(
            (data.templates || []).map((t: any) => ({
              id: t.id,
              name: t.name,
              format: t.format,
              is_system: !!t.is_system,
            }))
          );
        }
      } catch {
        // Feature may be disabled; silently ignore — user still has default layouts.
      }
    };
    fetchTemplates();
  }, [business?.id]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.code?.toLowerCase().includes(q) ||
        e.barcode?.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const totalCopies = useMemo(
    () => Array.from(selected.values()).reduce((s, n) => s + n, 0),
    [selected]
  );

  const setCopies = (rowId: string, copies: number) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const clamped = Math.max(0, Math.min(999, Math.floor(copies)));
      if (clamped <= 0) {
        next.delete(rowId);
      } else {
        next.set(rowId, clamped);
      }
      return next;
    });
  };

  const toggleRow = (rowId: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.set(rowId, 1);
      }
      return next;
    });
  };

  const allShownSelected =
    filtered.length > 0 && filtered.every((e) => selected.has(e.row_id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allShownSelected) {
        for (const e of filtered) next.delete(e.row_id);
      } else {
        for (const e of filtered) {
          if (!next.has(e.row_id)) next.set(e.row_id, 1);
        }
      }
      return next;
    });
  };

  const handlePrint = async () => {
    if (selected.size === 0) {
      toast.warning('Select at least one item to print');
      return;
    }
    if (!business?.id) return;

    const lines = filtered
      .filter((e) => selected.has(e.row_id))
      .map((e) => {
        const base: any = {
          item_id: e.item_id,
          variant_id: e.variant_id,
          copies: selected.get(e.row_id) || 1,
        };
        if (e.is_weighed && e.plu_code) {
          const raw = weightInputs.get(e.row_id);
          const parsed = raw != null && raw !== '' ? Number(raw) : NaN;
          if (Number.isFinite(parsed) && parsed >= 0) {
            // For weight mode the user enters grams; for price mode, paise.
            base.weight_measure = Math.floor(parsed);
          }
        }
        return base;
      });

    // Soft validation: weighed rows with no measure should warn the user.
    const missingWeight = filtered.filter(
      (e) =>
        selected.has(e.row_id) &&
        e.is_weighed &&
        e.plu_code &&
        !(
          weightInputs.get(e.row_id) &&
          Number(weightInputs.get(e.row_id)) > 0
        )
    );
    if (missingWeight.length > 0) {
      const names = missingWeight
        .slice(0, 3)
        .map((e) => e.name)
        .join(', ');
      toast.warning(
        `Enter weight/price for ${missingWeight.length} weighed item(s): ${names}${
          missingWeight.length > 3 ? '…' : ''
        }. The label will use 00000 as the measure.`
      );
    }

    if (lines.length === 0) {
      toast.warning('Nothing to print');
      return;
    }

    setPrinting(true);
    try {
      // Bluetooth path: ask the API for JSON (resolved lines + template) and
      // stream the bytes to the paired BLE printer client-side. This reuses
      // the server's auth + feature gates + DB hydration so no item data
      // leaks and the same label renders everywhere.
      if (format === 'bluetooth') {
        if (!bt.supported) {
          toast.error(
            'Bluetooth is not available in this browser. Use Chrome on Android or desktop Chrome/Edge.'
          );
          return;
        }
        if (bt.savedPrinters.length === 0) {
          toast.error(
            'No Bluetooth printer paired. Go to Settings → Print & devices to pair one first.'
          );
          return;
        }

        const res = await fetch(
          `/api/labels/print?business_id=${business.id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lines,
              layout: templateId ? undefined : layout,
              template_id: templateId || undefined,
              format: 'json',
              purpose: 'standalone',
            }),
          }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error || `Print failed (${res.status})`);
          return;
        }
        const payload = await res.json();
        // Rehydrate date strings into Date objects so the ESC/POS renderer
        // can format batch / MFG / EXP rows.
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
        toast.success(`Sent ${totalCopies} label(s) to Bluetooth printer`);
        return;
      }

      const res = await fetch(
        `/api/labels/print?business_id=${business.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lines,
            layout: templateId ? undefined : layout,
            template_id: templateId || undefined,
            format,
            purpose: 'standalone',
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

  return (
    <div className="space-y-6">
      <MobileDuplicatePageChrome
        title="Print labels"
        description="Generate scannable barcode labels for items and variants. Set copies, layout, and print."
      />

      <Card padding="md">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, code, or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <>
                <label className="text-sm text-text-secondary">Template</label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 max-w-[200px]"
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

            <label className="text-sm text-text-secondary">Layout</label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as Layout)}
              disabled={!!templateId}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500"
              title={templateId ? 'Template controls layout' : ''}
            >
              <option value="A4_SHEET">A4 sheet (21-up)</option>
              <option value="ROLL">Roll 50×25mm</option>
            </select>

            <label className="text-sm text-text-secondary ml-2">Output</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="pdf">PDF</option>
              <option value="html">HTML (browser print)</option>
              <option value="zpl">ZPL (thermal printer file)</option>
              <option value="bluetooth" disabled={!bt.supported}>
                Bluetooth printer{bt.supported ? '' : ' (unsupported)'}
              </option>
            </select>

            <Button
              variant="secondary"
              onClick={toggleSelectAll}
              disabled={filtered.length === 0}
            >
              {allShownSelected ? (
                <>
                  <Square className="w-4 h-4 mr-2" />
                  Deselect All
                </>
              ) : (
                <>
                  <CheckSquare className="w-4 h-4 mr-2" />
                  Select All ({filtered.length})
                </>
              )}
            </Button>
            <Button
              onClick={handlePrint}
              disabled={selected.size === 0 || printing}
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
      </Card>

      <Card padding="md">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-text-secondary">
            {search ? (
              <>
                <p className="text-lg font-medium mb-2">No items found</p>
                <p className="text-sm">Try adjusting your search</p>
              </>
            ) : (
              <>
                <p className="text-lg font-medium mb-2">
                  No items with barcodes
                </p>
                <p className="text-sm">
                  Add or generate barcodes on items / variants to print labels
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-secondary border-b border-gray-200">
                <tr>
                  <th className="py-2 pr-3 w-10"> </th>
                  <th className="py-2 pr-3">Item / Variant</th>
                  <th className="py-2 pr-3">Barcode</th>
                  <th className="py-2 pr-3">Symbology</th>
                  <th className="py-2 pr-3 text-right">Price</th>
                  <th className="py-2 pr-3 text-right">Stock</th>
                  <th className="py-2 pr-3 w-36">Weight / Price</th>
                  <th className="py-2 pr-3 text-right w-40">Copies</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const checked = selected.has(entry.row_id);
                  const copies = selected.get(entry.row_id) ?? 0;
                  return (
                    <tr
                      key={entry.row_id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => toggleRow(entry.row_id)}
                          className="text-primary-600"
                          aria-label={
                            checked ? 'Deselect row' : 'Select row'
                          }
                        >
                          {checked ? (
                            <CheckSquare className="w-5 h-5" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-text-primary">
                          {entry.name}
                          {entry.variant_id && (
                            <span className="ml-2 px-2 py-0.5 bg-slate-50 text-primary-700 rounded text-xs">
                              variant
                            </span>
                          )}
                        </div>
                        {entry.code && (
                          <div className="text-xs text-text-secondary">
                            Code: {entry.code}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {entry.is_weighed && entry.plu_code ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded text-[10px] font-sans">
                              PLU
                            </span>
                            {entry.plu_code}
                          </span>
                        ) : (
                          entry.barcode
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                          {entry.is_weighed
                            ? entry.weight_barcode_mode === 'price'
                              ? 'EAN13 price'
                              : 'EAN13 weight'
                            : entry.barcode_type || 'AUTO'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {entry.selling_price != null
                          ? `₹ ${entry.selling_price.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right text-text-secondary">
                        {entry.item_type === 'goods'
                          ? `${entry.current_stock ?? 0} ${entry.unit ?? ''}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {entry.is_weighed && entry.plu_code ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={weightInputs.get(entry.row_id) || ''}
                              onChange={(e) =>
                                setWeightInputs((prev) => {
                                  const next = new Map(prev);
                                  next.set(entry.row_id, e.target.value);
                                  return next;
                                })
                              }
                              placeholder={
                                entry.weight_barcode_mode === 'price'
                                  ? 'paise'
                                  : 'grams'
                              }
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                              disabled={!checked}
                            />
                            <span className="text-[10px] text-gray-500">
                              {entry.weight_barcode_mode === 'price'
                                ? 'paise'
                                : 'g'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={!checked}
                            onClick={() =>
                              setCopies(entry.row_id, Math.max(1, copies - 1))
                            }
                            className="p-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            value={copies}
                            onChange={(e) =>
                              setCopies(
                                entry.row_id,
                                parseInt(e.target.value || '0', 10)
                              )
                            }
                            className="w-16 text-right border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setCopies(entry.row_id, (copies || 0) + 1)
                            }
                            className="p-1 rounded border border-gray-300 hover:bg-gray-100"
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
          </div>
        )}
      </Card>
    </div>
  );
}
