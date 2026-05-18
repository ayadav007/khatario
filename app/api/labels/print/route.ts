import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { query, queryOne } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import {
  buildLabelDocumentHtml,
  DEFAULT_A4_TEMPLATE,
  DEFAULT_ROLL_TEMPLATE,
  type LabelLine,
  type LabelTemplate,
  type LabelFormat,
  type LabelFieldConfig,
  type LabelFieldKey,
} from '@/lib/label-document-builder';
import type { LabelSymbology } from '@/lib/barcode-renderer';
import type { BarcodeType } from '@/lib/barcode-validator';
import { buildLabelDocumentZpl } from '@/lib/zpl-generator';
import { generateWeightEmbeddedBarcode } from '@/lib/barcode-validator';

/**
 * POST /api/labels/print
 *
 * Generates a printable barcode label sheet.
 *
 * Request body:
 *   {
 *     lines: [{ item_id, variant_id?, batch_id?, copies, weight_g? }, ...],
 *     template_id?: string,        // optional Phase-3 saved template
 *     format?: 'pdf' | 'html',     // default 'pdf'
 *     layout?: 'A4_SHEET' | 'ROLL',// default 'A4_SHEET' (used when no template_id)
 *     symbology?: LabelSymbology,  // overrides template/per-item symbology
 *     purpose?: 'standalone' | 'purchase' | 'item_create',
 *     purchase_id?: string,
 *   }
 *
 * Response:
 *   - format=pdf  -> application/pdf binary
 *   - format=html -> text/html (print-ready window.print() page)
 */

interface PrintRequestLine {
  /**
   * Required unless `preview: true`. We always re-fetch from DB to ensure the
   * caller can't print labels for items they don't own.
   */
  item_id?: string;
  variant_id?: string | null;
  batch_id?: string | null;
  copies?: number;
  /** Override label-shown product name. */
  display_name?: string | null;
  /** Override barcode value (used when caller already computed weighted EAN). */
  barcode_override?: string | null;
  /** Optional explicit price for preview-only flows. */
  price?: number | null;
  /**
   * When set, the server generates a fresh weight-/price-embedded EAN-13 for
   * this line (GS1 in-store prefix 2). Takes precedence over the item's
   * stored barcode so operators can print per-weight labels without changing
   * the base item.
   *
   * Unit of `measure` follows the item's `weight_barcode_mode`:
   *   weight mode -> grams   (integer, 0-99999)
   *   price  mode -> paise   (integer, 0-99999)
   *
   * When present, one label per copy is generated with THIS exact measure
   * (same barcode). To print a range of weights, send multiple lines.
   */
  weight_measure?: number | null;
}

interface PrintRequestBody {
  lines: PrintRequestLine[];
  template_id?: string | null;
  /**
   * Output format:
   *   - pdf  — PDF via Puppeteer (default)
   *   - html — print-ready HTML
   *   - zpl  — raw ZPL for Zebra-family thermal printers
   *   - json — resolved LabelLine[] + template, returned so a client can
   *            render to a Bluetooth ESC/POS printer without re-fetching
   *            item / variant / batch data (same auth + feature gates apply).
   */
  format?: 'pdf' | 'html' | 'zpl' | 'json';
  /** Printer resolution (dots-per-inch) when format=zpl. Default 203. */
  zpl_dpi?: 203 | 300 | 600;
  layout?: LabelFormat;
  symbology?: LabelSymbology;
  purpose?: 'standalone' | 'purchase' | 'item_create';
  purchase_id?: string | null;
  /**
   * When true, skip the DB lookup and trust the caller-supplied
   * display_name + barcode_override + price. Used by the item-edit form to
   * preview a label before the item exists in the database. Still
   * authenticated and feature-gated.
   */
  preview?: boolean;
}

const MAX_LINES = 500;
const MAX_COPIES_PER_LINE = 999;
const MAX_TOTAL_LABELS = 5000;

// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'items', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_printing');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json(err.toResponse(), { status: 403 });
      }
      throw err;
    }

    let body: PrintRequestBody;
    // (parse body below, then gate ZPL separately so the error message is precise)
    try {
      body = (await request.json()) as PrintRequestBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: 'At least one line is required' },
        { status: 400 }
      );
    }
    if (body.lines.length > MAX_LINES) {
      return NextResponse.json(
        { error: `Too many lines (max ${MAX_LINES})` },
        { status: 400 }
      );
    }

    // ZPL and JSON-for-Bluetooth both represent "direct thermal printer"
    // output paths. We gate them behind the same feature.
    if (body.format === 'zpl' || body.format === 'json') {
      try {
        await assertFeatureAccess(businessId, 'barcode_thermal_printer');
      } catch (err) {
        if (err instanceof FeatureAccessDeniedError) {
          return NextResponse.json(err.toResponse(), { status: 403 });
        }
        throw err;
      }
    }

    const totalCopies = body.lines.reduce(
      (sum, l) => sum + Math.max(1, Math.floor(l.copies || 1)),
      0
    );
    if (totalCopies > MAX_TOTAL_LABELS) {
      return NextResponse.json(
        {
          error: `Total label count (${totalCopies}) exceeds limit (${MAX_TOTAL_LABELS})`,
        },
        { status: 400 }
      );
    }

    // Feature gate: GS1-128 / batch encoding lives behind purchase feature
    // when invoked from a purchase context. The standalone bulk page never
    // requests batch_id so this only fires in Phase 2+.
    if (body.purpose === 'purchase') {
      try {
        await assertFeatureAccess(businessId, 'barcode_label_from_purchase');
      } catch (err) {
        if (err instanceof FeatureAccessDeniedError) {
          return NextResponse.json(err.toResponse(), { status: 403 });
        }
        throw err;
      }
    }

    // Resolve business display name once.
    const business = await queryOne<{ name: string }>(
      'SELECT name FROM businesses WHERE id = $1',
      [businessId]
    );

    // Build the lines: hydrate item / variant / batch info from DB so the
    // caller can't spoof another business's data.
    const labelLines: LabelLine[] = [];

    // Preview path: trust caller-supplied display_name + barcode_override.
    if (body.preview) {
      for (const reqLine of body.lines) {
        const code = (reqLine.barcode_override || '').trim();
        if (!code) continue;
        labelLines.push({
          productName: reqLine.display_name || 'Preview',
          barcode: code,
          barcodeType: null,
          price: numericOrNull(reqLine.price),
          mrp: null,
          copies: Math.min(
            MAX_COPIES_PER_LINE,
            Math.max(1, Math.floor(reqLine.copies || 1))
          ),
        });
      }
      // Skip DB hydration loop below.
      // eslint-disable-next-line no-empty
    }

    for (const reqLine of body.preview ? [] : body.lines) {
      const copies = Math.min(
        MAX_COPIES_PER_LINE,
        Math.max(1, Math.floor(reqLine.copies || 1))
      );

      if (!reqLine.item_id) continue;

      const item = await queryOne<{
        id: string;
        name: string;
        barcode: string | null;
        barcode_type: BarcodeType | null;
        selling_price: string | number | null;
        mrp: string | number | null;
        hsn_sac: string | null;
        brand: string | null;
        net_quantity: string | null;
        country_of_origin: string | null;
        fssai_licence_no: string | null;
        is_weighed: boolean | null;
        plu_code: string | null;
        weight_barcode_mode: 'weight' | 'price' | null;
      }>(
        `SELECT id, name, barcode, barcode_type, selling_price, mrp, hsn_sac,
                brand, net_quantity, country_of_origin, fssai_licence_no,
                is_weighed, plu_code, weight_barcode_mode
         FROM items
         WHERE id = $1 AND business_id = $2`,
        [reqLine.item_id, businessId]
      );
      if (!item) continue;

      let variantName: string | undefined;
      let variantBarcode: string | null = null;
      let variantBarcodeType: BarcodeType | null = null;
      let variantPrice: string | number | null = null;
      if (reqLine.variant_id) {
        const v = await queryOne<{
          variant_name: string;
          barcode: string | null;
          barcode_type: BarcodeType | null;
          selling_price: string | number | null;
        }>(
          `SELECT v.variant_name, v.barcode, v.barcode_type, v.selling_price
             FROM item_variants v
             JOIN items i ON i.id = v.item_id
            WHERE v.id = $1 AND i.business_id = $2`,
          [reqLine.variant_id, businessId]
        );
        if (v) {
          variantName = v.variant_name;
          variantBarcode = v.barcode;
          variantBarcodeType = v.barcode_type;
          variantPrice = v.selling_price;
        }
      }

      // Weighed-item path: generate a fresh variable-measure EAN-13 on the fly.
      // This takes precedence over any stored/legacy barcode because the measure
      // portion of the code changes every print.
      let weighedBarcode: string | null = null;
      let weighedBarcodeType: BarcodeType | null = null;
      if (
        reqLine.weight_measure != null &&
        item.is_weighed &&
        item.plu_code
      ) {
        try {
          weighedBarcode = generateWeightEmbeddedBarcode({
            pluCode: item.plu_code,
            mode:
              item.weight_barcode_mode === 'price' ? 'price' : 'weight',
            measure: Math.max(0, Math.floor(reqLine.weight_measure)),
          });
          weighedBarcodeType = 'EAN13';
        } catch (err) {
          console.warn(
            '[POST /api/labels/print] weighed barcode generation failed:',
            err
          );
        }
      }

      const barcodeValue =
        (weighedBarcode ||
          reqLine.barcode_override?.trim() ||
          variantBarcode ||
          item.barcode ||
          '').trim();
      if (!barcodeValue) {
        // Skip lines that have no scannable code rather than failing the batch.
        continue;
      }

      // Optional batch info (Phase 2+).
      let batchNumber: string | null = null;
      let mfgDate: Date | null = null;
      let expiryDate: Date | null = null;
      if (reqLine.batch_id) {
        const b = await queryOne<{
          batch_number: string | null;
          manufacturing_date: string | null;
          expiry_date: string | null;
        }>(
          `SELECT batch_number, manufacturing_date, expiry_date
             FROM item_batches
            WHERE id = $1 AND business_id = $2`,
          [reqLine.batch_id, businessId]
        );
        if (b) {
          batchNumber = b.batch_number;
          mfgDate = b.manufacturing_date ? new Date(b.manufacturing_date) : null;
          expiryDate = b.expiry_date ? new Date(b.expiry_date) : null;
        }
      }

      // Auto-encode batch + expiry as GS1-128 when caller asks for it.
      const encodeGs1 =
        body.symbology === 'GS1_128' && !!(batchNumber || expiryDate);

      labelLines.push({
        productName: reqLine.display_name || item.name,
        variantName,
        barcode: barcodeValue,
        barcodeType: (weighedBarcodeType ??
          variantBarcodeType ??
          item.barcode_type) as BarcodeType | null,
        price: numericOrNull(variantPrice ?? item.selling_price),
        mrp: numericOrNull(item.mrp),
        hsn: item.hsn_sac,
        brand: item.brand,
        netQuantity: item.net_quantity,
        countryOfOrigin: item.country_of_origin,
        fssai: item.fssai_licence_no,
        copies,
        batchNumber,
        mfgDate,
        expiryDate,
        encodeGs1,
      });
    }

    if (labelLines.length === 0) {
      return NextResponse.json(
        { error: 'No printable lines (missing barcodes?)' },
        { status: 400 }
      );
    }

    // Resolve template: explicit template_id > layout default.
    let template: LabelTemplate;
    if (body.template_id) {
      const row = await queryOne<any>(
        `SELECT id, business_id, name, format,
                width_mm, height_mm, columns, rows_count,
                gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
                symbology, fields, is_system, is_active
           FROM label_templates
          WHERE id = $1
            AND (business_id IS NULL OR business_id = $2)
            AND COALESCE(is_active, TRUE) = TRUE`,
        [body.template_id, businessId]
      );
      if (!row) {
        return NextResponse.json(
          { error: 'Label template not found or inactive' },
          { status: 404 }
        );
      }
      template = dbRowToTemplate(row);
      // Caller-supplied symbology still wins over the template default.
      if (body.symbology) template.symbology = body.symbology;
    } else {
      const layout: LabelFormat = body.layout || 'A4_SHEET';
      const base: LabelTemplate =
        layout === 'ROLL'
          ? { ...DEFAULT_ROLL_TEMPLATE }
          : { ...DEFAULT_A4_TEMPLATE };
      template = {
        ...base,
        symbology: body.symbology || base.symbology,
      };
    }

    const format = body.format || 'pdf';

    // Only build HTML for pdf/html output; zpl and json have their own paths.
    const html =
      format === 'zpl' || format === 'json'
        ? ''
        : buildLabelDocumentHtml({
            template,
            lines: labelLines,
            businessName: business?.name || '',
          });

    // Write audit log (best-effort). Failures must not block the print.
    try {
      const totalLabels = labelLines.reduce(
        (s, l) => s + Math.max(1, Math.floor(l.copies || 1)),
        0
      );
      const snapshot = labelLines.map((l) => ({
        product_name: l.productName,
        variant_name: l.variantName || null,
        barcode: l.barcode,
        copies: l.copies,
        price: l.price ?? null,
        mrp: l.mrp ?? null,
        batch_number: l.batchNumber || null,
        expiry_date: l.expiryDate ? l.expiryDate.toISOString() : null,
      }));
      await query(
        `INSERT INTO label_print_log (
           business_id, user_id, purpose, template_id, template_name,
           purchase_id, format, layout, symbology,
           line_count, total_labels, lines_snapshot
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          businessId,
          userId,
          body.purpose || 'standalone',
          body.template_id || null,
          template.name || null,
          body.purchase_id || null,
          format,
          template.format,
          template.symbology,
          labelLines.length,
          totalLabels,
          JSON.stringify(snapshot),
        ]
      );
    } catch (logErr) {
      console.error('[POST /api/labels/print] audit log failed:', logErr);
    }

    if (format === 'zpl') {
      const zpl = buildLabelDocumentZpl({
        template,
        lines: labelLines,
        businessName: business?.name || '',
        dpi: body.zpl_dpi || 203,
      });
      return new NextResponse(zpl, {
        status: 200,
        headers: {
          'Content-Type': 'application/zpl; charset=utf-8',
          'Content-Disposition': `attachment; filename="labels-${Date.now()}.zpl"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'json') {
      // Serialize Date objects so the client sees ISO strings. The client's
      // Bluetooth renderer parses these back to Date as needed.
      const linesJson = labelLines.map((l) => ({
        ...l,
        mfgDate: l.mfgDate ? l.mfgDate.toISOString() : null,
        expiryDate: l.expiryDate ? l.expiryDate.toISOString() : null,
      }));
      return NextResponse.json({
        template,
        lines: linesJson,
        businessName: business?.name || '',
      });
    }

    if (format === 'html') {
      const { maybeAppendKhatarioPrintFooter } = await import(
        '@/lib/print-branding'
      );
      const htmlWithFooter = await maybeAppendKhatarioPrintFooter(
        html,
        businessId
      );
      return new NextResponse(htmlWithFooter, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // format === 'pdf'
    const pdfBuffer = await renderHtmlToPdf(html, template, businessId);
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="labels-${Date.now()}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[POST /api/labels/print] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate labels' },
      { status: 500 }
    );
  }
}

// ============================================================================

function numericOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a label_templates row (snake_case, NUMERICs as strings) into the
 * camelCase LabelTemplate shape the renderer consumes.
 */
function dbRowToTemplate(row: any): LabelTemplate {
  const rawFields = Array.isArray(row.fields) ? row.fields : [];
  const fields: LabelFieldConfig[] = rawFields.map((f: any) => ({
    key: f.key as LabelFieldKey,
    visible: f.visible !== false,
    fontSize: Number(f.font_size) || undefined,
    bold: !!f.bold,
    x_mm: numericOrNull(f.x_mm) ?? undefined,
    y_mm: numericOrNull(f.y_mm) ?? undefined,
    w_mm: numericOrNull(f.w_mm) ?? undefined,
    h_mm: numericOrNull(f.h_mm) ?? undefined,
    align:
      f.align === 'center' || f.align === 'right' ? f.align : 'left',
    prefix: f.prefix ?? null,
    suffix: f.suffix ?? null,
  }));

  return {
    id: row.id,
    name: row.name,
    format: row.format,
    widthMm: Number(row.width_mm),
    heightMm: Number(row.height_mm),
    columns: row.columns != null ? Number(row.columns) : undefined,
    rows: row.rows_count != null ? Number(row.rows_count) : undefined,
    gapXmm: numericOrNull(row.gap_x_mm) ?? 0,
    gapYmm: numericOrNull(row.gap_y_mm) ?? 0,
    marginTopMm: numericOrNull(row.margin_top_mm) ?? 0,
    marginLeftMm: numericOrNull(row.margin_left_mm) ?? 0,
    fields,
    symbology: (row.symbology || 'AUTO') as any,
  };
}

async function renderHtmlToPdf(
  html: string,
  template: LabelTemplate,
  businessId: string
): Promise<Buffer> {
  const { maybeAppendKhatarioPrintFooter } = await import(
    '@/lib/print-branding'
  );
  const htmlOut = await maybeAppendKhatarioPrintFooter(html, businessId);
  const browser = await puppeteer.launch(
    getPuppeteerLaunchOptions({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
  );
  try {
    const page = await browser.newPage();
    await page.setContent(htmlOut, { waitUntil: 'domcontentloaded' });
    const pdfOptions: any = { printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } };
    if (template.format === 'A4_SHEET') {
      pdfOptions.format = 'A4';
    } else {
      pdfOptions.width = `${template.widthMm}mm`;
      pdfOptions.height = `${template.heightMm}mm`;
    }
    const buf = await page.pdf(pdfOptions);
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
