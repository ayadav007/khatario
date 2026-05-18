'use client';

/**
 * LabelTemplateEditor
 *
 * Drag-and-drop designer used by /settings/label-templates/new and
 * /settings/label-templates/[id]. Field positions, sizes, alignment, bold and
 * prefixes are all edited in-place and persisted to /api/label-templates.
 *
 * Layout:
 *   [field palette]  [canvas]            [properties]
 *     - sidebar        - LabelPreview     - current field
 *     - adds fields    - clickable        - dimensions /
 *     - hides fields   - drag to move       style controls
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  ZoomIn,
  ZoomOut,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { LabelPreview } from '@/components/labels/LabelPreview';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// ---------------------------------------------------------------------------

type FieldKey =
  | 'business_name'
  | 'brand'
  | 'product_name'
  | 'variant_name'
  | 'net_quantity'
  | 'barcode'
  | 'barcode_text'
  | 'price'
  | 'mrp'
  | 'hsn'
  | 'batch'
  | 'mfg'
  | 'expiry'
  | 'country_of_origin'
  | 'fssai';

interface Field {
  key: FieldKey;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  font_size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  visible: boolean;
  prefix?: string | null;
  suffix?: string | null;
}

interface TemplateState {
  id?: string;
  name: string;
  description: string;
  format: 'A4_SHEET' | 'ROLL';
  width_mm: number;
  height_mm: number;
  columns: number | null;
  rows_count: number | null;
  gap_x_mm: number;
  gap_y_mm: number;
  margin_top_mm: number;
  margin_left_mm: number;
  symbology: string;
  fields: Field[];
  is_active: boolean;
}

const FIELD_LABELS: Record<FieldKey, string> = {
  business_name: 'Business name',
  brand: 'Brand / Manufacturer',
  product_name: 'Product name',
  variant_name: 'Variant name',
  net_quantity: 'Net quantity',
  barcode: 'Barcode (image)',
  barcode_text: 'Barcode text',
  price: 'Selling price',
  mrp: 'MRP',
  hsn: 'HSN / SAC',
  batch: 'Batch number',
  mfg: 'Manufacture date',
  expiry: 'Expiry date',
  country_of_origin: 'Country of origin',
  fssai: 'FSSAI licence',
};

const ALL_FIELD_KEYS: FieldKey[] = Object.keys(FIELD_LABELS) as FieldKey[];

const SYMBOLOGIES = [
  'AUTO',
  'EAN13',
  'EAN8',
  'UPCA',
  'CODE128',
  'GS1_128',
  'QR',
  'CODE39',
];

const SAMPLE_DATA = {
  businessName: 'Your Store',
  brand: 'Parle',
  productName: 'Parle-G Biscuit',
  variantName: null,
  barcode: '8901234567894',
  barcodeType: 'EAN13' as const,
  price: 10,
  mrp: 12,
  batchNumber: 'B2601',
  mfgDate: new Date('2026-04-01'),
  expiryDate: new Date('2027-04-01'),
  netQuantity: '100 g',
  fssai: '12345678901234',
  countryOfOrigin: 'IN',
  hsn: '1905',
};

function defaultFieldFor(key: FieldKey): Field {
  return {
    key,
    x_mm: 2,
    y_mm: 2,
    w_mm: 30,
    h_mm: key === 'barcode' ? 10 : 4,
    font_size: 8,
    bold: false,
    align: 'left',
    visible: true,
    prefix: null,
    suffix: null,
  };
}

function emptyTemplate(): TemplateState {
  return {
    name: '',
    description: '',
    format: 'ROLL',
    width_mm: 50,
    height_mm: 25,
    columns: null,
    rows_count: null,
    gap_x_mm: 0,
    gap_y_mm: 0,
    margin_top_mm: 0,
    margin_left_mm: 0,
    symbology: 'AUTO',
    fields: [
      { ...defaultFieldFor('product_name'), x_mm: 2, y_mm: 2, w_mm: 46, h_mm: 4, font_size: 9, bold: true },
      { ...defaultFieldFor('barcode'), x_mm: 4, y_mm: 7, w_mm: 42, h_mm: 10 },
      { ...defaultFieldFor('barcode_text'), x_mm: 2, y_mm: 17.5, w_mm: 46, h_mm: 3, align: 'center', bold: true, font_size: 7 },
      { ...defaultFieldFor('price'), x_mm: 2, y_mm: 20.5, w_mm: 46, h_mm: 3.5, font_size: 9, bold: true, align: 'left' },
    ],
    is_active: true,
  };
}

// ---------------------------------------------------------------------------

export interface LabelTemplateEditorProps {
  initialTemplate?: TemplateState;
  mode: 'new' | 'edit';
}

export function LabelTemplateEditor({
  initialTemplate,
  mode,
}: LabelTemplateEditorProps) {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();

  const [tpl, setTpl] = useState<TemplateState>(
    initialTemplate || emptyTemplate()
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    tpl.fields.length > 0 ? 0 : null
  );
  const [zoom, setZoom] = useState<number>(5);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    idx: number;
    mode: 'move' | 'resize';
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const selected = selectedIdx != null ? tpl.fields[selectedIdx] : null;

  // Auto-adjust zoom when label size changes so canvas stays reasonable.
  useEffect(() => {
    const maxW = 720;
    const maxH = 520;
    const z = Math.max(
      2,
      Math.min(12, Math.floor(Math.min(maxW / tpl.width_mm, maxH / tpl.height_mm)))
    );
    setZoom(z);
  }, [tpl.width_mm, tpl.height_mm]);

  // ------------------------------ drag / resize

  function startDrag(
    e: React.MouseEvent,
    idx: number,
    mode: 'move' | 'resize'
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    const f = tpl.fields[idx];
    dragState.current = {
      idx,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: f.x_mm,
      startY: f.y_mm,
      startW: f.w_mm,
      startH: f.h_mm,
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    const s = dragState.current;
    if (!s) return;
    const dx = (e.clientX - s.startClientX) / zoom;
    const dy = (e.clientY - s.startClientY) / zoom;
    setTpl((prev) => {
      const fields = [...prev.fields];
      const f = { ...fields[s.idx] };
      if (s.mode === 'move') {
        f.x_mm = clamp(s.startX + dx, 0, prev.width_mm - f.w_mm);
        f.y_mm = clamp(s.startY + dy, 0, prev.height_mm - f.h_mm);
      } else {
        f.w_mm = clamp(s.startW + dx, 2, prev.width_mm - f.x_mm);
        f.h_mm = clamp(s.startH + dy, 2, prev.height_mm - f.y_mm);
      }
      fields[s.idx] = f;
      return { ...prev, fields };
    });
  }

  function onMouseUp() {
    dragState.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------ field CRUD

  function addField(key: FieldKey) {
    if (tpl.fields.some((f) => f.key === key)) {
      // Toggle existing one to visible and select it.
      const idx = tpl.fields.findIndex((f) => f.key === key);
      setTpl((prev) => {
        const fields = [...prev.fields];
        fields[idx] = { ...fields[idx], visible: true };
        return { ...prev, fields };
      });
      setSelectedIdx(idx);
      return;
    }
    setTpl((prev) => {
      const fields = [...prev.fields, defaultFieldFor(key)];
      return { ...prev, fields };
    });
    setSelectedIdx(tpl.fields.length);
  }

  function removeField(idx: number) {
    setTpl((prev) => {
      const fields = prev.fields.filter((_, i) => i !== idx);
      return { ...prev, fields };
    });
    setSelectedIdx(null);
  }

  function updateField(idx: number, patch: Partial<Field>) {
    setTpl((prev) => {
      const fields = [...prev.fields];
      fields[idx] = { ...fields[idx], ...patch };
      return { ...prev, fields };
    });
  }

  // ------------------------------ save

  async function handleSave() {
    if (!business?.id || !user?.id) {
      toast.error('Session expired.');
      return;
    }
    if (!tpl.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        business_id: business.id,
        user_id: user.id,
        name: tpl.name.trim(),
        description: tpl.description || null,
        format: tpl.format,
        width_mm: Number(tpl.width_mm),
        height_mm: Number(tpl.height_mm),
        columns: tpl.format === 'A4_SHEET' ? Number(tpl.columns) || null : null,
        rows_count:
          tpl.format === 'A4_SHEET' ? Number(tpl.rows_count) || null : null,
        gap_x_mm: Number(tpl.gap_x_mm) || 0,
        gap_y_mm: Number(tpl.gap_y_mm) || 0,
        margin_top_mm: Number(tpl.margin_top_mm) || 0,
        margin_left_mm: Number(tpl.margin_left_mm) || 0,
        symbology: tpl.symbology,
        fields: tpl.fields.map((f) => ({
          key: f.key,
          x_mm: Number(f.x_mm),
          y_mm: Number(f.y_mm),
          w_mm: Number(f.w_mm),
          h_mm: Number(f.h_mm),
          font_size: Number(f.font_size) || 8,
          bold: !!f.bold,
          align: f.align,
          visible: f.visible !== false,
          prefix: f.prefix || null,
          suffix: f.suffix || null,
        })),
        is_active: tpl.is_active !== false,
      };
      const url =
        mode === 'edit'
          ? `/api/label-templates/${tpl.id}`
          : `/api/label-templates`;
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(
        `${url}?business_id=${business.id}&user_id=${user.id}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await safeJsonParse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Save failed'));
      toast.success(
        mode === 'edit' ? 'Template updated' : 'Template created'
      );
      router.push('/settings/label-templates');
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------ layout

  const availableFields = useMemo(
    () =>
      ALL_FIELD_KEYS.filter(
        (k) => !tpl.fields.some((f) => f.key === k && f.visible)
      ),
    [tpl.fields]
  );

  return (
    <div className="max-w-[1400px] mx-auto py-6 px-4">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <Link href="/settings/label-templates">
            <button className="p-2 hover:bg-gray-100 rounded" title="Back">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {mode === 'edit' ? 'Edit Template' : 'New Template'}
            </h1>
            <p className="text-xs text-text-secondary">
              Drag fields on the canvas, resize from the corner, configure in
              the panel on the right.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Top bar: general config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 bg-white border rounded-lg p-4">
        <Input
          label="Name"
          value={tpl.name}
          onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
          placeholder="e.g. Thermal 40x25"
          required
        />
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Format
          </label>
          <select
            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={tpl.format}
            onChange={(e) =>
              setTpl({ ...tpl, format: e.target.value as any })
            }
          >
            <option value="ROLL">Continuous Roll / Thermal</option>
            <option value="A4_SHEET">A4 Sticker Sheet</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Default Symbology
          </label>
          <select
            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={tpl.symbology}
            onChange={(e) => setTpl({ ...tpl, symbology: e.target.value })}
          >
            {SYMBOLOGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Width (mm)"
          type="number"
          value={String(tpl.width_mm)}
          onChange={(e) =>
            setTpl({ ...tpl, width_mm: Number(e.target.value) || 0 })
          }
        />
        <Input
          label="Height (mm)"
          type="number"
          value={String(tpl.height_mm)}
          onChange={(e) =>
            setTpl({ ...tpl, height_mm: Number(e.target.value) || 0 })
          }
        />
        <Input
          label="Description"
          value={tpl.description}
          onChange={(e) => setTpl({ ...tpl, description: e.target.value })}
          placeholder="Optional"
        />
        {tpl.format === 'A4_SHEET' && (
          <>
            <Input
              label="Columns"
              type="number"
              value={String(tpl.columns ?? '')}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  columns: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <Input
              label="Rows per page"
              type="number"
              value={String(tpl.rows_count ?? '')}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  rows_count: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <Input
              label="Margin top (mm)"
              type="number"
              value={String(tpl.margin_top_mm)}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  margin_top_mm: Number(e.target.value) || 0,
                })
              }
            />
            <Input
              label="Margin left (mm)"
              type="number"
              value={String(tpl.margin_left_mm)}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  margin_left_mm: Number(e.target.value) || 0,
                })
              }
            />
            <Input
              label="Gap X (mm)"
              type="number"
              value={String(tpl.gap_x_mm)}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  gap_x_mm: Number(e.target.value) || 0,
                })
              }
            />
            <Input
              label="Gap Y (mm)"
              type="number"
              value={String(tpl.gap_y_mm)}
              onChange={(e) =>
                setTpl({
                  ...tpl,
                  gap_y_mm: Number(e.target.value) || 0,
                })
              }
            />
          </>
        )}
      </div>

      {/* Designer grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_300px] gap-4">
        {/* Palette */}
        <div className="bg-white border rounded-lg p-3 h-fit sticky top-4">
          <h3 className="font-semibold text-sm text-text-primary mb-2">
            Add Field
          </h3>
          {availableFields.length === 0 ? (
            <p className="text-xs text-text-secondary italic">
              All fields added.
            </p>
          ) : (
            <div className="space-y-1">
              {availableFields.map((k) => (
                <button
                  key={k}
                  onClick={() => addField(k)}
                  className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between"
                >
                  <span>{FIELD_LABELS[k]}</span>
                  <Plus className="w-3.5 h-3.5 text-text-secondary" />
                </button>
              ))}
            </div>
          )}
          <hr className="my-3" />
          <h3 className="font-semibold text-sm text-text-primary mb-2">
            Fields in Layout
          </h3>
          {tpl.fields.length === 0 ? (
            <p className="text-xs text-text-secondary italic">No fields yet.</p>
          ) : (
            <div className="space-y-1">
              {tpl.fields.map((f, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-xs ${
                    selectedIdx === idx
                      ? 'bg-slate-100 text-primary-800'
                      : 'hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedIdx(idx)}
                >
                  <span className="truncate">{FIELD_LABELS[f.key]}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeField(idx);
                    }}
                    className="text-red-500 hover:text-red-700"
                    title="Remove"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="bg-white border rounded-lg p-4 overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-text-secondary">
              Label: {tpl.width_mm}×{tpl.height_mm} mm · Zoom: {zoom}×
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setZoom((z) => Math.max(1, z - 1))}
                className="p-1.5 border rounded hover:bg-gray-50"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(15, z + 1))}
                className="p-1.5 border rounded hover:bg-gray-50"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={canvasRef}
            className="relative inline-block"
            style={{
              background: '#f3f4f6',
              padding: 24,
              borderRadius: 8,
            }}
            onClick={() => setSelectedIdx(null)}
          >
            <div style={{ position: 'relative' }}>
              <LabelPreview
                template={{
                  width_mm: tpl.width_mm,
                  height_mm: tpl.height_mm,
                  symbology: tpl.symbology,
                  fields: tpl.fields,
                }}
                data={SAMPLE_DATA}
                zoom={zoom}
                showOutlines
                onSelectField={(key) => {
                  const idx = tpl.fields.findIndex((f) => f.key === key);
                  if (idx >= 0) setSelectedIdx(idx);
                }}
                selectedFieldKey={selected?.key ?? null}
              />

              {/* Drag overlays on top of each visible field */}
              {tpl.fields.map((f, idx) => {
                if (!f.visible) return null;
                const left = f.x_mm * zoom;
                const top = f.y_mm * zoom;
                const width = f.w_mm * zoom;
                const height = f.h_mm * zoom;
                return (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width,
                      height,
                      cursor: 'move',
                    }}
                    onMouseDown={(e) => startDrag(e, idx, 'move')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIdx(idx);
                    }}
                  >
                    {selectedIdx === idx && (
                      <div
                        onMouseDown={(e) => startDrag(e, idx, 'resize')}
                        style={{
                          position: 'absolute',
                          right: -6,
                          bottom: -6,
                          width: 12,
                          height: 12,
                          background: '#2563eb',
                          border: '2px solid white',
                          borderRadius: 2,
                          cursor: 'se-resize',
                        }}
                        title="Resize"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-text-secondary mt-3">
            Click a field to select. Drag to move. Drag the blue corner handle
            to resize.
          </p>
        </div>

        {/* Properties */}
        <div className="bg-white border rounded-lg p-4 h-fit sticky top-4">
          <h3 className="font-semibold text-sm text-text-primary mb-3">
            Field Properties
          </h3>
          {!selected || selectedIdx == null ? (
            <p className="text-xs text-text-secondary italic">
              Select a field on the canvas or in the list to edit.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-text-secondary">
                {FIELD_LABELS[selected.key]}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="X (mm)"
                  type="number"
                  value={String(selected.x_mm)}
                  onChange={(e) =>
                    updateField(selectedIdx, {
                      x_mm: Number(e.target.value) || 0,
                    })
                  }
                />
                <Input
                  label="Y (mm)"
                  type="number"
                  value={String(selected.y_mm)}
                  onChange={(e) =>
                    updateField(selectedIdx, {
                      y_mm: Number(e.target.value) || 0,
                    })
                  }
                />
                <Input
                  label="W (mm)"
                  type="number"
                  value={String(selected.w_mm)}
                  onChange={(e) =>
                    updateField(selectedIdx, {
                      w_mm: Number(e.target.value) || 0,
                    })
                  }
                />
                <Input
                  label="H (mm)"
                  type="number"
                  value={String(selected.h_mm)}
                  onChange={(e) =>
                    updateField(selectedIdx, {
                      h_mm: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              {selected.key !== 'barcode' && (
                <>
                  <Input
                    label="Font size (pt)"
                    type="number"
                    value={String(selected.font_size)}
                    onChange={(e) =>
                      updateField(selectedIdx, {
                        font_size: Number(e.target.value) || 8,
                      })
                    }
                  />
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Alignment
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['left', 'center', 'right'] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() =>
                            updateField(selectedIdx, { align: a })
                          }
                          className={`py-1.5 text-xs rounded border ${
                            selected.align === a
                              ? 'bg-slate-100 border-primary-400 text-primary-800'
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.bold}
                      onChange={(e) =>
                        updateField(selectedIdx, { bold: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Bold</span>
                  </label>
                  <Input
                    label="Prefix"
                    value={selected.prefix || ''}
                    onChange={(e) =>
                      updateField(selectedIdx, { prefix: e.target.value || null })
                    }
                    placeholder='e.g. "MRP "'
                  />
                  <Input
                    label="Suffix"
                    value={selected.suffix || ''}
                    onChange={(e) =>
                      updateField(selectedIdx, { suffix: e.target.value || null })
                    }
                  />
                </>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.visible}
                  onChange={(e) =>
                    updateField(selectedIdx, { visible: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm">Visible on label</span>
              </label>

              <button
                onClick={() => removeField(selectedIdx)}
                className="w-full text-red-600 border border-red-200 hover:bg-red-50 py-1.5 rounded text-sm flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove field
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Public helper used by the loader page to convert a server row into the
// editor's in-memory shape (numbers come back as strings from pg for NUMERIC).
export function serverTemplateToState(row: any): TemplateState {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    format: row.format || 'ROLL',
    width_mm: Number(row.width_mm) || 50,
    height_mm: Number(row.height_mm) || 25,
    columns: row.columns != null ? Number(row.columns) : null,
    rows_count: row.rows_count != null ? Number(row.rows_count) : null,
    gap_x_mm: Number(row.gap_x_mm) || 0,
    gap_y_mm: Number(row.gap_y_mm) || 0,
    margin_top_mm: Number(row.margin_top_mm) || 0,
    margin_left_mm: Number(row.margin_left_mm) || 0,
    symbology: row.symbology || 'AUTO',
    is_active: row.is_active !== false,
    fields: Array.isArray(row.fields)
      ? row.fields.map((f: any) => ({
          key: f.key,
          x_mm: Number(f.x_mm) || 0,
          y_mm: Number(f.y_mm) || 0,
          w_mm: Number(f.w_mm) || 10,
          h_mm: Number(f.h_mm) || 4,
          font_size: Number(f.font_size) || 8,
          bold: !!f.bold,
          align:
            f.align === 'center' || f.align === 'right' ? f.align : 'left',
          visible: f.visible !== false,
          prefix: f.prefix ?? null,
          suffix: f.suffix ?? null,
        }))
      : [],
  };
}
