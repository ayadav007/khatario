/**
 * POST /api/print/render — ready-to-send printer bytes for apps that only move bytes
 * (the Flutter phone app over Classic Bluetooth / BLE / USB / Wi‑Fi).
 *
 * Bills, labels and test pages are built by the same engine as the website (lib/print/*,
 * lib/bluetooth/*), with Hindi / Gujarati / ₹ drawn on the server (lib/print/text-raster-server.ts).
 *
 * Body:
 *   printer: { language: 'ESCPOS'|'TSPL'|'ZPL', paper_width_mm?: 58|80, dpi?, copies?, auto_cut?,
 *              open_drawer?, density?, speed?, gap_mm?, name? }
 *   kind 'receipt': invoice_id (loaded for the session's business)
 *   kind 'labels':  template, lines, business_name (the JSON from POST /api/labels/print format=json)
 *   kind 'test':    test page / test label for the printer
 *   kind 'drawer':  open the cash drawer
 *
 * Response: application/octet-stream.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { shouldShowKhatarioPrintFooter } from '@/lib/print-branding';
import { invoicePayloadToReceipt } from '@/lib/bluetooth/invoice-payload-to-receipt';
import { buildInvoiceReceiptEscPos } from '@/lib/bluetooth/invoice-to-escpos';
import { buildLabelEscPos } from '@/lib/bluetooth/label-to-escpos';
import { EscPosBuilder } from '@/lib/bluetooth/escpos';
import { buildLabelTspl } from '@/lib/print/tspl';
import { buildLabelDocumentZpl } from '@/lib/zpl-generator';
import { DEFAULT_ROLL_TEMPLATE, type LabelLine, type LabelTemplate } from '@/lib/label-document-builder';
import { withServerTextRaster } from '@/lib/print/text-raster-server';
import type { TextRasterizer } from '@/lib/print/bitmap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PrinterSpec = {
  language: 'ESCPOS' | 'TSPL' | 'ZPL';
  paper: 58 | 80;
  dpi: 203 | 300;
  copies: number;
  autoCut: boolean;
  openDrawer: boolean;
  density?: number;
  speed?: number;
  gapMm?: number;
  name: string;
};

const MAX_LABELS = 2000;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function readPrinter(raw: unknown): PrinterSpec | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const language = p.language === 'TSPL' || p.language === 'ZPL' ? p.language : p.language === 'ESCPOS' || p.language == null ? 'ESCPOS' : null;
  if (!language) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    language,
    paper: num(p.paper_width_mm) === 80 ? 80 : 58,
    dpi: num(p.dpi) === 300 ? 300 : 203,
    copies: Math.min(3, Math.max(1, Math.floor(num(p.copies) ?? 1))),
    autoCut: p.auto_cut !== false,
    openDrawer: p.open_drawer === true,
    density: num(p.density),
    speed: num(p.speed),
    gapMm: num(p.gap_mm),
    name: typeof p.name === 'string' ? p.name.slice(0, 60) : 'Printer',
  };
}

function bytesResponse(bytes: Uint8Array, language: string) {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Printer-Language': language,
    },
  });
}

function labelBytes(
  printer: PrinterSpec,
  args: { template: LabelTemplate; lines: LabelLine[]; businessName: string },
  rasterize: TextRasterizer
): Uint8Array {
  if (printer.language === 'TSPL') {
    return buildLabelTspl({ ...args, dpi: printer.dpi, density: printer.density, speed: printer.speed, gapMm: printer.gapMm, rasterize });
  }
  if (printer.language === 'ZPL') {
    return new TextEncoder().encode(buildLabelDocumentZpl({ ...args, dpi: printer.dpi, rasterize }));
  }
  return buildLabelEscPos({ ...args, paperWidthMm: printer.paper, rasterize });
}

async function loadReceiptPayload(invoiceId: string, businessId: string) {
  const pool = getPool();
  const inv = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
    [invoiceId, businessId]
  );
  const invoice = inv.rows[0];
  if (!invoice) return null;
  const [items, payments, business] = await Promise.all([
    pool.query(
      `SELECT ii.*, COALESCE(ii.item_name, it.name) AS item_name, iv.variant_name
         FROM invoice_items ii
         LEFT JOIN items it ON it.id = ii.item_id AND it.business_id = $2
         LEFT JOIN item_variants iv ON iv.id = ii.variant_id
        WHERE ii.invoice_id = $1
        ORDER BY ii.sort_order, ii.id`,
      [invoiceId, businessId]
    ),
    pool.query(
      `SELECT payment_mode, amount FROM payments
        WHERE reference_type = 'invoice' AND reference_id = $1 AND business_id = $2 AND deleted_at IS NULL
        ORDER BY payment_date DESC`,
      [invoiceId, businessId]
    ),
    pool.query(
      `SELECT name, phone, gstin,
              concat_ws(', ', NULLIF(address_line1, ''), NULLIF(address_line2, ''), NULLIF(city, ''), NULLIF(state, ''), NULLIF(pincode, '')) AS address
         FROM businesses WHERE id = $1`,
      [businessId]
    ),
  ]);
  return { invoice: { ...invoice, items: items.rows, payments: payments.rows }, business: business.rows[0] ?? {} };
}

export async function POST(req: NextRequest) {
  try {
    const userId = getAuthenticatedUserId(req);
    const businessId = getSessionScopedBusinessId(req);
    if (!userId || !businessId) return bad('Sign in again to print.', 401);

    try {
      await assertFeatureAccess(businessId, 'barcode_thermal_printer');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) return NextResponse.json(err.toResponse(), { status: 403 });
      throw err;
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return bad('Send a JSON body.');
    const printer = readPrinter(body.printer);
    if (!printer) return bad('Unknown printer language.');

    switch (body.kind) {
      case 'receipt': {
        const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : '';
        if (!invoiceId) return bad('invoice_id is required.');
        if (printer.language !== 'ESCPOS') return bad('Bills print on receipt (ESC/POS) printers.');
        const loaded = await loadReceiptPayload(invoiceId, businessId);
        if (!loaded) return bad('Invoice not found', 404);
        try {
          await authorize(userId, 'invoices', 'read', {
            branchId: loaded.invoice.branch_id,
            businessId,
            resourceId: invoiceId,
          });
        } catch (error) {
          if (error instanceof AuthorizationError) return error.toNextResponse();
          throw error;
        }
        const receipt = invoicePayloadToReceipt(loaded.invoice, loaded.business);
        const showKhatarioFooter = await shouldShowKhatarioPrintFooter(businessId);
        const paidInCash = /cash/i.test(receipt.paymentMode || '');
        const bytes = await withServerTextRaster((rasterize) =>
          buildInvoiceReceiptEscPos(receipt, {
            paperWidthMm: printer.paper,
            rasterize,
            copies: printer.copies,
            skipCut: !printer.autoCut,
            openDrawer: printer.openDrawer && paidInCash,
            showKhatarioFooter,
          })
        );
        return bytesResponse(bytes, 'ESCPOS');
      }

      case 'labels': {
        try {
          await authorize(userId, 'items', 'read');
        } catch (error) {
          if (error instanceof AuthorizationError) return error.toNextResponse();
          throw error;
        }
        const template = body.template as LabelTemplate | undefined;
        const lines = Array.isArray(body.lines) ? (body.lines as LabelLine[]) : [];
        if (!template || typeof template.widthMm !== 'number' || typeof template.heightMm !== 'number') {
          return bad('template is required (use POST /api/labels/print with format=json).');
        }
        const total = lines.reduce((s, l) => s + Math.max(1, Math.floor(Number(l.copies) || 1)), 0);
        if (lines.length === 0) return bad('No labels to print.');
        if (total > MAX_LABELS) return bad(`Print at most ${MAX_LABELS} labels at a time.`);
        const hydrated = lines.map((l) => ({
          ...l,
          mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
          expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
        }));
        const businessName = typeof body.business_name === 'string' ? body.business_name : '';
        const bytes = await withServerTextRaster((rasterize) =>
          labelBytes(printer, { template, lines: hydrated, businessName }, rasterize)
        );
        return bytesResponse(bytes, printer.language);
      }

      case 'test': {
        const bytes = await withServerTextRaster((rasterize) => {
          if (printer.language !== 'ESCPOS') {
            return labelBytes(
              printer,
              {
                template: { ...DEFAULT_ROLL_TEMPLATE, widthMm: 50, heightMm: 25 },
                lines: [{ productName: `Test ${printer.name}`.slice(0, 40), barcode: '8901234567890', copies: 1, price: 99, mrp: 120 }],
                businessName: 'Khatario test label',
              },
              rasterize
            );
          }
          const b = new EscPosBuilder({ paperWidthMm: printer.paper, rasterize });
          b.init()
            .align('center')
            .bold(true)
            .sizeBig()
            .line('PRINTER OK')
            .sizeNormal()
            .bold(false)
            .line(printer.name)
            .line(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))
            .separator()
            .align('left')
            .line(`Paper width: ${printer.paper}mm`)
            .separator('.')
            .line('हिंदी / ગુજરાતી / ₹ 1,234.50')
            .separator('.')
            .line('1234567890'.repeat(5).slice(0, b.colsFontA))
            .feed(1)
            .align('center')
            .qrcode('https://khatario.com', { size: 5 })
            .feed(1)
            .line('Khatario test page');
          if (printer.autoCut) b.cut();
          else b.feed(4);
          return b.build();
        });
        return bytesResponse(bytes, printer.language);
      }

      case 'drawer':
        return bytesResponse(new EscPosBuilder({ paperWidthMm: printer.paper }).init().openDrawer().build(), 'ESCPOS');

      default:
        return bad('kind must be receipt, labels, test or drawer.');
    }
  } catch (error) {
    console.error('[print/render]', error);
    return bad('Could not prepare the print. Try again.', 500);
  }
}
