'use client';

/**
 * LabelPreview — read-only client preview of a single label cell.
 *
 * Renders the same absolute-positioned layout that the server uses in
 * `lib/label-document-builder.ts` (`renderLabelCellAbsolute`) but as React +
 * inline SVG so the designer / bulk page can show a live preview without a
 * round-trip to /api/labels/print.
 *
 * The preview is rendered at `widthMm × heightMm` scaled up by `zoom`
 * (default 4) to make 10-pt text legible on screen.
 */

import React, { useMemo } from 'react';
import {
  renderBarcodeSVG,
  barcodeTypeToSymbology,
  buildGS1Payload,
  type LabelSymbology,
} from '@/lib/barcode-renderer';
import type { BarcodeType } from '@/lib/barcode-validator';

export interface LabelPreviewField {
  key: string;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  font_size?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  visible: boolean;
  prefix?: string | null;
  suffix?: string | null;
}

export interface LabelPreviewTemplate {
  width_mm: number;
  height_mm: number;
  symbology?: string;
  fields: LabelPreviewField[];
}

export interface LabelPreviewData {
  businessName?: string;
  brand?: string | null;
  productName?: string;
  variantName?: string | null;
  barcode?: string;
  barcodeType?: BarcodeType | null;
  price?: number | null;
  mrp?: number | null;
  hsn?: string | null;
  batchNumber?: string | null;
  mfgDate?: Date | null;
  expiryDate?: Date | null;
  netQuantity?: string | null;
  fssai?: string | null;
  countryOfOrigin?: string | null;
  encodeGs1?: boolean;
}

export interface LabelPreviewProps {
  template: LabelPreviewTemplate;
  data: LabelPreviewData;
  /** Pixels per millimetre for on-screen rendering. Default 4. */
  zoom?: number;
  /** Optional outer className. */
  className?: string;
  /** When true, show faint dashed outlines around each field (designer mode). */
  showOutlines?: boolean;
  /** Called when user clicks a field (designer mode). */
  onSelectField?: (key: string) => void;
  /** Currently-selected field key (designer mode). */
  selectedFieldKey?: string | null;
}

// ---------------------------------------------------------------------------

function fmtCurrency(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '';
  return `₹ ${Number(v).toFixed(2)}`;
}

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

function resolveValue(
  key: string,
  d: LabelPreviewData
): string {
  switch (key) {
    case 'business_name':
      return d.businessName || '';
    case 'brand':
      return d.brand || '';
    case 'product_name':
      return d.variantName
        ? `${d.productName || ''} - ${d.variantName}`
        : d.productName || '';
    case 'variant_name':
      return d.variantName || '';
    case 'barcode_text':
      return d.barcode || '';
    case 'price':
      return d.price != null ? fmtCurrency(d.price) : '';
    case 'mrp':
      return d.mrp != null ? fmtCurrency(d.mrp) : '';
    case 'hsn':
      return d.hsn || '';
    case 'batch':
      return d.batchNumber || '';
    case 'mfg':
      return fmtDateShort(d.mfgDate);
    case 'expiry':
      return fmtDateShort(d.expiryDate);
    case 'net_quantity':
      return d.netQuantity || '';
    case 'fssai':
      return d.fssai || '';
    case 'country_of_origin':
      return d.countryOfOrigin || '';
    default:
      return '';
  }
}

function pickBarcodeValueAndSymbology(
  d: LabelPreviewData,
  templateSymbology: string
): { value: string; symbology: LabelSymbology } {
  const raw = (d.barcode || '').trim();
  if (d.encodeGs1 && raw) {
    const gtin = raw.replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    return {
      value: buildGS1Payload({
        gtin,
        batch: d.batchNumber ?? null,
        expiry: d.expiryDate ?? null,
      }),
      symbology: 'GS1_128',
    };
  }
  const sym: LabelSymbology = d.barcodeType
    ? barcodeTypeToSymbology(d.barcodeType)
    : ((templateSymbology || 'AUTO') as LabelSymbology);
  return { value: raw, symbology: sym };
}

// ---------------------------------------------------------------------------

export function LabelPreview(props: LabelPreviewProps) {
  const {
    template,
    data,
    zoom = 4,
    className,
    showOutlines = false,
    onSelectField,
    selectedFieldKey = null,
  } = props;

  const pxW = template.width_mm * zoom;
  const pxH = template.height_mm * zoom;

  const { value: barcodeValue, symbology } = useMemo(
    () =>
      pickBarcodeValueAndSymbology(
        data,
        template.symbology || 'AUTO'
      ),
    [data, template.symbology]
  );

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: pxW,
        height: pxH,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        boxSizing: 'border-box',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      }}
    >
      {template.fields.map((f, idx) => {
        if (!f.visible) return null;
        const left = f.x_mm * zoom;
        const top = f.y_mm * zoom;
        const width = f.w_mm * zoom;
        const height = f.h_mm * zoom;
        const isSelected = selectedFieldKey === f.key;

        const commonStyle: React.CSSProperties = {
          position: 'absolute',
          left,
          top,
          width,
          height,
          boxSizing: 'border-box',
          cursor: onSelectField ? 'pointer' : 'default',
          outline: showOutlines
            ? isSelected
              ? '1.5px solid #2563eb'
              : '1px dashed rgba(148, 163, 184, 0.6)'
            : 'none',
          outlineOffset: showOutlines ? '-1px' : 0,
          background: isSelected ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
        };

        const handleClick = onSelectField
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              onSelectField(f.key);
            }
          : undefined;

        if (f.key === 'barcode') {
          let svgMarkup = '';
          try {
            if (barcodeValue) {
              svgMarkup = renderBarcodeSVG(barcodeValue, symbology, {
                widthMm: f.w_mm,
                heightMm: f.h_mm,
                includeText: false,
                textSize: 0,
                scale: 2,
              });
            }
          } catch {
            svgMarkup = `<div style="color:#b00;font-size:10px;">Invalid barcode</div>`;
          }
          return (
            <div
              key={idx}
              style={{
                ...commonStyle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
              onClick={handleClick}
              data-field-key={f.key}
            >
              <div
                style={{ width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            </div>
          );
        }

        const raw = resolveValue(f.key, data);
        const text = !raw
          ? ''
          : `${f.prefix || ''}${raw}${f.suffix || ''}`;
        const align = f.align || 'left';
        const font = f.font_size ?? 8;
        const monospace =
          f.key === 'barcode_text'
            ? { fontFamily: "'Courier New', monospace", letterSpacing: '1px' }
            : {};

        return (
          <div
            key={idx}
            style={{
              ...commonStyle,
              fontSize: `${font * (zoom / 4) * 0.75 * (4 / zoom)}pt`,
              fontWeight: f.bold ? 600 : 400,
              textAlign: align as any,
              lineHeight: 1.1,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              padding: 0,
              color: text ? '#111' : '#bbb',
              fontStyle: text ? 'normal' : 'italic',
              ...monospace,
            }}
            onClick={handleClick}
            data-field-key={f.key}
            title={f.key}
          >
            {text || (showOutlines ? `[${f.key}]` : '')}
          </div>
        );
      })}
    </div>
  );
}
