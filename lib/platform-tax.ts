/**
 * Optional GST on Khatario's own subscription charges, and the numbers on receipts (SUB-13).
 *
 * Three modes, set by a platform admin (platform_settings, migration 480):
 *   none       (default) no tax line. Every amount is exactly what it was before this existed.
 *   inclusive  the listed price already includes GST: the customer pays the same, the tax part is shown.
 *   exclusive  GST is added on top of the price after coupon and upgrade credit.
 *
 * All money maths here is integer paise. ROUNDING RULE (the only one): a rate applied to an amount is
 * rounded half up to the nearest paisa; the other part is always the difference, so taxable + tax
 * equals the amount charged exactly. CGST/SGST: CGST is half the tax rounded down, SGST is the rest
 * (an odd paisa goes to SGST), so the halves always sum to the tax.
 */

import type { PoolClient } from 'pg';
import { getPool, query, queryOne } from '@/lib/db';
import { checkGstin, GST_STATE_NAMES } from '@/lib/tax/gstin';
import { getStateCode } from '@/lib/gst-utils';

export type GstMode = 'none' | 'inclusive' | 'exclusive';
export const GST_MODES: readonly GstMode[] = ['none', 'inclusive', 'exclusive'];

export type TaxSettings = {
  mode: GstMode;
  ratePercent: number;
  sellerGstin: string | null;
  sellerLegalName: string | null;
  sellerAddress: string | null;
  /** Two-digit GST state code of the seller (from the GSTIN unless saved separately). */
  sellerStateCode: string | null;
  /** Service accounting code printed on tax invoices. */
  sacCode: string;
  invoicePrefix: string;
  /** Platform admin who last saved the setting, and when (null until someone does). */
  updatedBy?: string | null;
  updatedAt?: string | null;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  mode: 'none',
  ratePercent: 18,
  sellerGstin: null,
  sellerLegalName: null,
  sellerAddress: null,
  sellerStateCode: null,
  sacCode: '998314',
  invoicePrefix: 'KH',
};

// ---------------------------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------------------------

/** Divide two positive integers, rounding half up. */
const divRound = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

export function rateToBasisPoints(ratePercent: number): number {
  return Math.round(Number(ratePercent) * 100);
}

export type TaxPaise = { taxablePaise: number; taxPaise: number; payablePaise: number };

/** `netPaise` is the amount after coupon and credit (and the ₹1 floor). */
export function computeTaxPaise(netPaise: number, s: Pick<TaxSettings, 'mode' | 'ratePercent'>): TaxPaise {
  const net = Math.max(0, Math.round(netPaise));
  const bp = rateToBasisPoints(s.ratePercent);
  if (s.mode === 'none' || net === 0 || bp <= 0) {
    return { taxablePaise: net, taxPaise: 0, payablePaise: net };
  }
  if (s.mode === 'inclusive') {
    const taxable = divRound(net * 10000, 10000 + bp);
    return { taxablePaise: taxable, taxPaise: net - taxable, payablePaise: net };
  }
  const tax = divRound(net * bp, 10000);
  return { taxablePaise: net, taxPaise: tax, payablePaise: net + tax };
}

/** Rupee version of `computeTaxPaise` (amounts in, amounts out, rounded to paise). */
export function computeTax(
  netOfDiscountAndCredit: number,
  s: Pick<TaxSettings, 'mode' | 'ratePercent'>,
): { taxable: number; tax: number; payable: number } {
  const r = computeTaxPaise(Math.round(netOfDiscountAndCredit * 100), s);
  return { taxable: r.taxablePaise / 100, tax: r.taxPaise / 100, payable: r.payablePaise / 100 };
}

export type GstSplit = { cgstPaise: number; sgstPaise: number; igstPaise: number };

/** Same state: CGST + SGST halves (odd paisa to SGST). Different or unknown state: IGST. */
export function splitGst(taxPaise: number, intraState: boolean): GstSplit {
  if (taxPaise <= 0) return { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  const cgst = Math.floor(taxPaise / 2);
  return { cgstPaise: cgst, sgstPaise: taxPaise - cgst, igstPaise: 0 };
}

const stateCodeOfGstin = (g: string | null | undefined): string | null => {
  const code = (g ?? '').trim().slice(0, 2);
  return GST_STATE_NAMES[code] ? code : null;
};

/**
 * The buyer's state, from what is stored for the business: the GSTIN's state first (place of supply
 * for a registered buyer follows it), then the saved state code, then the state name. Null when unknown.
 */
export function buyerStateCodeOf(b: { gstin?: string | null; state_code?: string | null; state?: string | null }): string | null {
  const fromGstin = stateCodeOfGstin(b.gstin);
  if (fromGstin) return fromGstin;
  const saved = (b.state_code ?? '').trim();
  if (GST_STATE_NAMES[saved]) return saved;
  const fromName = b.state ? getStateCode(b.state) : '';
  return GST_STATE_NAMES[fromName] ? fromName : null;
}

export type TaxBreakdown = TaxPaise &
  GstSplit & {
    mode: GstMode;
    ratePercent: number;
    /** True when buyer and seller are in the same state. False for another state AND for an unknown buyer state. */
    intraState: boolean;
    buyerStateCode: string | null;
    sellerStateCode: string | null;
  };

export function buildTaxBreakdown(
  netPaise: number,
  s: Pick<TaxSettings, 'mode' | 'ratePercent' | 'sellerStateCode'>,
  buyerStateCode: string | null,
): TaxBreakdown {
  const t = computeTaxPaise(netPaise, s);
  const intraState = Boolean(s.sellerStateCode && buyerStateCode && s.sellerStateCode === buyerStateCode);
  return {
    ...t,
    ...splitGst(t.taxPaise, intraState),
    mode: s.mode,
    ratePercent: s.mode === 'none' ? 0 : s.ratePercent,
    intraState,
    buyerStateCode,
    sellerStateCode: s.sellerStateCode,
  };
}

/** What a payment row keeps in metadata.tax: figures in rupees plus who sold to whom, as they were at checkout. */
export type StoredTax = {
  mode: GstMode;
  rate: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  intra_state: boolean;
  place_of_supply_code: string | null;
  sac_code: string;
  invoice_prefix: string;
  seller: { legal_name: string | null; gstin: string | null; address: string | null; state_code: string | null };
  buyer: { name: string | null; gstin: string | null; state_code: string | null; address: string | null } | null;
};

export type CheckoutTax = { breakdown: TaxBreakdown; stored: StoredTax };

export type BuyerRow = {
  name: string | null;
  gstin: string | null;
  state_code: string | null;
  state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
};

export function formatBuyerAddress(b: Partial<BuyerRow>): string | null {
  const parts = [b.address_line1, b.address_line2, b.city, b.state, b.pincode].map((x) => (x ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function loadBuyer(businessId: string): Promise<BuyerRow | null> {
  return queryOne<BuyerRow>(
    `SELECT name, gstin, state_code, state, address_line1, address_line2, city, pincode FROM businesses WHERE id = $1`,
    [businessId],
  );
}

const rupees = (paise: number) => paise / 100;

/**
 * The tax for one checkout of `netPaise` (the amount after coupon and credit). The business is the
 * session's; the buyer's state is read from the business row, never from a request.
 */
export async function resolveCheckoutTax(businessId: string, netPaise: number, settings?: TaxSettings): Promise<CheckoutTax> {
  const s = settings ?? (await loadTaxSettings());
  // With tax off nothing about the buyer matters: skip the lookup.
  const buyer = s.mode === 'none' ? null : await loadBuyer(businessId);
  const breakdown = buildTaxBreakdown(netPaise, s, buyer ? buyerStateCodeOf(buyer) : null);
  const stored: StoredTax = {
    mode: s.mode,
    rate: breakdown.ratePercent,
    taxable: rupees(breakdown.taxablePaise),
    tax: rupees(breakdown.taxPaise),
    cgst: rupees(breakdown.cgstPaise),
    sgst: rupees(breakdown.sgstPaise),
    igst: rupees(breakdown.igstPaise),
    intra_state: breakdown.intraState,
    place_of_supply_code: breakdown.buyerStateCode,
    sac_code: s.sacCode,
    invoice_prefix: s.invoicePrefix,
    seller: {
      legal_name: s.sellerLegalName,
      // A GSTIN is printed only on a tax invoice, never on a plain receipt.
      gstin: s.mode === 'none' ? null : s.sellerGstin,
      address: s.sellerAddress,
      state_code: s.sellerStateCode,
    },
    buyer: buyer
      ? { name: buyer.name, gstin: buyer.gstin, state_code: breakdown.buyerStateCode, address: formatBuyerAddress(buyer) }
      : null,
  };
  return { breakdown, stored };
}

// ---------------------------------------------------------------------------------------------
// Settings (platform_settings, id = 'default')
// ---------------------------------------------------------------------------------------------

type SettingsRow = {
  subscription_gst_mode: string | null;
  subscription_gst_rate: string | number | null;
  subscription_seller_gstin: string | null;
  subscription_seller_legal_name: string | null;
  subscription_seller_address: string | null;
  subscription_seller_state_code: string | null;
  subscription_sac_code: string | null;
  subscription_invoice_prefix: string | null;
  subscription_tax_updated_by: string | null;
  subscription_tax_updated_at: string | null;
};

const SETTINGS_COLUMNS = `subscription_gst_mode, subscription_gst_rate, subscription_seller_gstin, subscription_seller_legal_name,
  subscription_seller_address, subscription_seller_state_code, subscription_sac_code, subscription_invoice_prefix,
  subscription_tax_updated_by, subscription_tax_updated_at::text AS subscription_tax_updated_at`;

function fromRow(row: SettingsRow | null): TaxSettings {
  if (!row) return { ...DEFAULT_TAX_SETTINGS };
  const gstin = row.subscription_seller_gstin?.trim() || null;
  const mode = (GST_MODES as readonly string[]).includes(row.subscription_gst_mode ?? '')
    ? (row.subscription_gst_mode as GstMode)
    : 'none';
  return {
    mode,
    ratePercent: row.subscription_gst_rate === null ? 18 : Number(row.subscription_gst_rate),
    sellerGstin: gstin,
    sellerLegalName: row.subscription_seller_legal_name?.trim() || null,
    sellerAddress: row.subscription_seller_address?.trim() || null,
    sellerStateCode: row.subscription_seller_state_code?.trim() || stateCodeOfGstin(gstin),
    sacCode: row.subscription_sac_code?.trim() || DEFAULT_TAX_SETTINGS.sacCode,
    invoicePrefix: row.subscription_invoice_prefix?.trim() || DEFAULT_TAX_SETTINGS.invoicePrefix,
    updatedBy: row.subscription_tax_updated_by,
    updatedAt: row.subscription_tax_updated_at,
  };
}

/** Current settings. No row, or the columns missing before migration 480, means mode `none`. */
export async function loadTaxSettings(client?: Pick<PoolClient, 'query'>, lock = false): Promise<TaxSettings> {
  const sql = `SELECT ${SETTINGS_COLUMNS} FROM platform_settings WHERE id = 'default'${lock ? ' FOR UPDATE' : ''}`;
  try {
    return fromRow(client ? (await client.query<SettingsRow>(sql)).rows[0] ?? null : await queryOne<SettingsRow>(sql));
  } catch (err) {
    if ((err as { code?: string })?.code === '42703') return { ...DEFAULT_TAX_SETTINGS };
    throw err;
  }
}

export class TaxSettingsError extends Error {}

export type SaveTaxSettingsInput = {
  mode?: unknown;
  rate_percent?: unknown;
  seller_gstin?: unknown;
  seller_legal_name?: unknown;
  seller_address?: unknown;
  seller_state_code?: unknown;
  sac_code?: unknown;
  invoice_prefix?: unknown;
};

const has = (v: unknown) => v !== undefined;
const textOrNull = (v: unknown, max: number, label: string): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string') throw new TaxSettingsError(`${label} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new TaxSettingsError(`${label} is too long (at most ${max} characters).`);
  return t || null;
};

/**
 * Validates and saves. Fields left out keep their saved value. Switching tax on (inclusive or
 * exclusive) needs the seller's GSTIN and legal name, so checkout never meets a half-set-up tax mode.
 */
export async function saveTaxSettings(input: SaveTaxSettingsInput, changedBy: string | null = null): Promise<TaxSettings> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // The row is locked while we read, check and write, so two admins saving at once cannot overwrite each other's fields.
    await client.query(`INSERT INTO platform_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`).catch((e) => {
      if ((e as { code?: string }).code !== '42P01') throw e;
    });
    const saved = await saveLocked(client, input, changedBy);
    await client.query('COMMIT');
    return saved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((err as { code?: string })?.code === '42703') {
      throw new TaxSettingsError('Run migration 481_subscription_tax.sql first.');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function saveLocked(client: PoolClient, input: SaveTaxSettingsInput, changedBy: string | null): Promise<TaxSettings> {
  const cur = await loadTaxSettings(client, true);
  const next: TaxSettings = { ...cur };

  if (has(input.mode)) {
    if (typeof input.mode !== 'string' || !(GST_MODES as readonly string[]).includes(input.mode)) {
      throw new TaxSettingsError('Mode must be none, inclusive or exclusive.');
    }
    next.mode = input.mode as GstMode;
  }
  if (has(input.rate_percent)) {
    // An empty box is not 0 %: refuse it (Number('') would save a zero rate).
    const r = typeof input.rate_percent === 'string' ? (input.rate_percent.trim() === '' ? Number.NaN : Number(input.rate_percent)) : input.rate_percent;
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 28) {
      throw new TaxSettingsError('The GST rate must be a number from 0 to 28.');
    }
    if (Math.abs(r * 100 - Math.round(r * 100)) > 1e-9) {
      throw new TaxSettingsError('The GST rate can have at most two decimal places.');
    }
    next.ratePercent = r;
  }
  if (has(input.seller_gstin)) {
    const raw = textOrNull(input.seller_gstin, 40, 'GSTIN');
    if (raw === null) {
      next.sellerGstin = null;
    } else {
      const c = checkGstin(raw);
      if (!c.valid) throw new TaxSettingsError(`Seller GSTIN: ${c.error}`);
      next.sellerGstin = c.gstin;
      next.sellerStateCode = c.stateCode;
    }
  }
  if (has(input.seller_legal_name)) next.sellerLegalName = textOrNull(input.seller_legal_name, 200, 'Legal name');
  if (has(input.seller_address)) next.sellerAddress = textOrNull(input.seller_address, 500, 'Address');
  if (has(input.seller_state_code)) {
    const code = textOrNull(input.seller_state_code, 2, 'State code');
    if (code !== null && !GST_STATE_NAMES[code]) throw new TaxSettingsError('Seller state code is not a GST state code.');
    if (code !== null && next.sellerGstin && stateCodeOfGstin(next.sellerGstin) !== code) {
      throw new TaxSettingsError("Seller state code does not match the state in the seller's GSTIN.");
    }
    next.sellerStateCode = code ?? stateCodeOfGstin(next.sellerGstin);
  }
  if (has(input.sac_code)) {
    const sac = textOrNull(input.sac_code, 8, 'SAC code');
    if (!sac || !/^[0-9]{4,8}$/.test(sac)) throw new TaxSettingsError('SAC code must be 4 to 8 digits.');
    next.sacCode = sac;
  }
  if (has(input.invoice_prefix)) {
    const p = typeof input.invoice_prefix === 'string' ? input.invoice_prefix.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{1,10}$/.test(p)) throw new TaxSettingsError('The invoice prefix must be 1 to 10 letters or digits.');
    next.invoicePrefix = p;
  }
  if (next.sellerGstin && !next.sellerStateCode) next.sellerStateCode = stateCodeOfGstin(next.sellerGstin);

  if (next.mode !== 'none') {
    if (!next.sellerGstin) {
      throw new TaxSettingsError("Add the seller's GSTIN before switching GST on. Prices are not changed until you do.");
    }
    if (!next.sellerLegalName) {
      throw new TaxSettingsError("Add the seller's legal name before switching GST on. Prices are not changed until you do.");
    }
    if (!next.sellerStateCode) {
      throw new TaxSettingsError("Add the seller's state before switching GST on. Prices are not changed until you do.");
    }
  }

  {
    await client.query(
      `INSERT INTO platform_settings (id, subscription_gst_mode, subscription_gst_rate, subscription_seller_gstin,
         subscription_seller_legal_name, subscription_seller_address, subscription_seller_state_code,
         subscription_sac_code, subscription_invoice_prefix, subscription_tax_updated_by, subscription_tax_updated_at, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         subscription_gst_mode = EXCLUDED.subscription_gst_mode,
         subscription_gst_rate = EXCLUDED.subscription_gst_rate,
         subscription_seller_gstin = EXCLUDED.subscription_seller_gstin,
         subscription_seller_legal_name = EXCLUDED.subscription_seller_legal_name,
         subscription_seller_address = EXCLUDED.subscription_seller_address,
         subscription_seller_state_code = EXCLUDED.subscription_seller_state_code,
         subscription_sac_code = EXCLUDED.subscription_sac_code,
         subscription_invoice_prefix = EXCLUDED.subscription_invoice_prefix,
         subscription_tax_updated_by = EXCLUDED.subscription_tax_updated_by,
         subscription_tax_updated_at = NOW(),
         updated_at = NOW()`,
      [
        next.mode,
        next.ratePercent,
        next.sellerGstin,
        next.sellerLegalName,
        next.sellerAddress,
        next.sellerStateCode,
        next.sacCode,
        next.invoicePrefix,
        changedBy,
      ],
    );
  }
  next.updatedBy = changedBy;
  next.updatedAt = (await client.query<{ t: string }>(`SELECT NOW()::text AS t`)).rows[0].t;
  return next;
}

export function toPublicTaxSettings(s: TaxSettings) {
  return {
    mode: s.mode,
    rate_percent: s.ratePercent,
    seller_gstin: s.sellerGstin,
    seller_legal_name: s.sellerLegalName,
    seller_address: s.sellerAddress,
    seller_state_code: s.sellerStateCode,
    sac_code: s.sacCode,
    invoice_prefix: s.invoicePrefix,
    updated_by: s.updatedBy ?? null,
    updated_at: s.updatedAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export type NumberSeries = 'invoice' | 'credit_note';

/**
 * Indian financial year label (April to March, e.g. "2026-27") of the moment `at` (default: now),
 * by the date in India. Computed by the database.
 */
export async function financialYearLabel(client: Pick<PoolClient, 'query'>, at: string | null = null): Promise<string> {
  const r = await client.query<{ fy: string }>(
    `SELECT y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0') AS fy
     FROM (
       SELECT CASE WHEN extract(month FROM ist) >= 4 THEN extract(year FROM ist)::int ELSE extract(year FROM ist)::int - 1 END AS y
       FROM (SELECT (COALESCE($1::timestamptz, now()) AT TIME ZONE 'Asia/Kolkata') AS ist) t
     ) s`,
    [at],
  );
  return r.rows[0].fy;
}

/**
 * The next number in its series for the current financial year: `{prefix}/{2026-27}/{000001}`; credit
 * notes `{prefix}/CN/{2026-27}/{000001}`. Call it inside the completing transaction: the counter row is
 * locked until that transaction ends, so concurrent completions queue up, numbers have no gaps (a
 * rolled-back completion gives its number back) and are never repeated. `at` is for tests.
 */
export async function nextInvoiceNumber(
  client: Pick<PoolClient, 'query'>,
  settings: Pick<TaxSettings, 'invoicePrefix'>,
  opts: { series?: NumberSeries; at?: string | null } = {},
): Promise<string> {
  const series = opts.series ?? 'invoice';
  const fy = await financialYearLabel(client, opts.at ?? null);
  const r = await client.query<{ last_number: number }>(
    `INSERT INTO subscription_invoice_counters (series, financial_year, last_number) VALUES ($1, $2, 1)
     ON CONFLICT (series, financial_year) DO UPDATE SET last_number = subscription_invoice_counters.last_number + 1
     RETURNING last_number`,
    [series, fy],
  );
  const seq = String(r.rows[0].last_number).padStart(6, '0');
  return series === 'credit_note' ? `${settings.invoicePrefix}/CN/${fy}/${seq}` : `${settings.invoicePrefix}/${fy}/${seq}`;
}

/** The prefix a row was priced with (metadata.tax.invoice_prefix), else the saved one, else KH. */
export async function invoicePrefixFor(client: Pick<PoolClient, 'query'>, storedPrefix: string | null | undefined): Promise<string> {
  if (storedPrefix && /^[A-Z0-9]{1,10}$/.test(storedPrefix)) return storedPrefix;
  try {
    const r = await client.query<{ p: string | null }>(`SELECT subscription_invoice_prefix AS p FROM platform_settings WHERE id = 'default'`);
    return r.rows[0]?.p || DEFAULT_TAX_SETTINGS.invoicePrefix;
  } catch {
    return DEFAULT_TAX_SETTINGS.invoicePrefix;
  }
}

/**
 * Gives a completed payment its number, once. Inside the completion transaction, after the row is
 * locked: a row that already has a number keeps it.
 */
export async function issueInvoiceNumber(
  client: Pick<PoolClient, 'query'>,
  billingTransactionId: string,
  storedPrefix: string | null | undefined,
  series: NumberSeries = 'invoice',
): Promise<string | null> {
  const has = await client.query<{ invoice_number: string | null }>(
    `SELECT invoice_number FROM billing_transactions WHERE id = $1`,
    [billingTransactionId],
  );
  if (has.rows[0]?.invoice_number) return has.rows[0].invoice_number;
  const number = await nextInvoiceNumber(client, { invoicePrefix: await invoicePrefixFor(client, storedPrefix) }, { series });
  await client.query(`UPDATE billing_transactions SET invoice_number = $2 WHERE id = $1 AND invoice_number IS NULL`, [
    billingTransactionId,
    number,
  ]);
  return number;
}

export const isTaxedMode = (m: string | null | undefined): m is 'inclusive' | 'exclusive' => m === 'inclusive' || m === 'exclusive';

/** Document title by mode and kind. "Tax invoice" and any GST wording appear only when GST was charged or included. */
export type DocumentKind = 'receipt' | 'tax_invoice' | 'refund_receipt' | 'credit_note';
export function documentKind(type: string, mode: GstMode | null | undefined): DocumentKind {
  const taxed = mode === 'inclusive' || mode === 'exclusive';
  if (type === 'refund') return taxed ? 'credit_note' : 'refund_receipt';
  return taxed ? 'tax_invoice' : 'receipt';
}
export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  receipt: 'Receipt',
  tax_invoice: 'Tax invoice',
  refund_receipt: 'Refund receipt',
  credit_note: 'Credit note',
};
