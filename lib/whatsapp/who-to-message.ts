/**
 * "Who to message" lists for Connect campaigns.
 * Business identity is always the session business passed in by the route.
 */

export const WHO_TO_MESSAGE_DRAFT_KEY = 'khatario.whoToMessageDraft';
export const WHO_TO_MESSAGE_RESULT_CAP = 200;

export const WHO_CONDITIONS = ['quiet', 'top', 'once', 'enquiry', 'whatsapp'] as const;
export type WhoCondition = (typeof WHO_CONDITIONS)[number];

export type WhoToMessageDraft = {
  recipients: { phone: string; name?: string }[];
  messageText: string;
  campaignName: string;
};

export type WhoToMessageParams = {
  condition: WhoCondition;
  /** Quiet / enquiry / WhatsApp: how many days of silence. */
  days: number;
  /** Top buyers: look-back window. */
  periodDays: number;
  /** Top buyers: how many people. */
  limit: number;
};

export type WhoToMessageRow = {
  phone: string;
  name: string;
  lastOn: string | null;
  amount: number | null;
  billCount: number | null;
  reason: string;
};

const POSTED = `
  i.deleted_at IS NULL
  AND i.status = 'final'
  AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'estimate', 'quotation', 'delivery_challan')
`;

/** Last 10 digits, matching the inbox phone match. Null when the number is too short. */
export function sqlPhoneKey(expr: string): string {
  const digits = `regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g')`;
  return `CASE WHEN length(${digits}) >= 10 THEN right(${digits}, 10) ELSE NULL END`;
}

function exclusions(phoneKeyExpr: string): string {
  return `
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_unsubscribes u
      WHERE u.business_id = $1
        AND ${sqlPhoneKey('u.phone')} = ${phoneKeyExpr}
    )
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_campaign_recipients r
      JOIN whatsapp_campaigns camp ON camp.id = r.campaign_id
      WHERE camp.business_id = $1
        AND camp.created_at >= NOW() - INTERVAL '7 days'
        AND ${sqlPhoneKey('r.phone')} = ${phoneKeyExpr}
    )`;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function parseWhoToMessageParams(
  searchParams: URLSearchParams,
): { ok: true; value: WhoToMessageParams } | { ok: false; error: string } {
  const condition = searchParams.get('condition') || 'quiet';
  if (!WHO_CONDITIONS.includes(condition as WhoCondition)) {
    return { ok: false, error: 'Unknown list' };
  }
  const days = clampInt(searchParams.get('days'), condition === 'quiet' ? 30 : 7, 1, 365);
  const periodDays = clampInt(searchParams.get('period_days'), 30, 1, 365);
  const limit = clampInt(searchParams.get('limit'), 10, 1, 50);
  if (days == null || periodDays == null || limit == null) {
    return { ok: false, error: 'Days and list size must be whole numbers in range' };
  }
  return {
    ok: true,
    value: { condition: condition as WhoCondition, days, periodDays, limit },
  };
}

export function buildWhoToMessageQuery(
  params: WhoToMessageParams,
): { text: string; values: [number] | [number, number] } {
  const customerKey = sqlPhoneKey('c.phone');
  const salesCte = (extraInvoiceFilter = '') => `
    WITH sales AS (
      SELECT
        c.name,
        c.phone,
        ${customerKey} AS phone_key,
        i.invoice_date::date AS invoice_date,
        COALESCE(i.grand_total, 0)::numeric AS grand_total
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE i.business_id = $1
        AND c.business_id = $1
        AND ${POSTED}
        ${extraInvoiceFilter}
        AND ${customerKey} IS NOT NULL
    ),
    grouped AS (
      SELECT
        phone_key,
        (array_agg(name ORDER BY invoice_date DESC NULLS LAST))[1] AS name,
        (array_agg(phone ORDER BY length(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) DESC))[1] AS phone,
        MAX(invoice_date) AS last_on,
        COUNT(*)::int AS bill_count,
        SUM(grand_total) AS amount
      FROM sales
      GROUP BY phone_key
    )`;

  if (params.condition === 'quiet') {
    return {
      values: [params.days],
      text: `
        ${salesCte()}
        SELECT phone_key, name, phone, last_on::text AS last_on, bill_count, amount
        FROM grouped g
        WHERE g.bill_count >= 1
          AND g.last_on <= (CURRENT_DATE - $2::int)
          ${exclusions('g.phone_key')}
        ORDER BY g.last_on ASC
        LIMIT ${WHO_TO_MESSAGE_RESULT_CAP}`,
    };
  }

  if (params.condition === 'top') {
    return {
      values: [params.periodDays, params.limit],
      text: `
        ${salesCte('AND i.invoice_date >= (CURRENT_DATE - $2::int)')}
        SELECT phone_key, name, phone, last_on::text AS last_on, bill_count, amount
        FROM grouped g
        WHERE TRUE
          ${exclusions('g.phone_key')}
        ORDER BY g.amount DESC NULLS LAST
        LIMIT $3`,
    };
  }

  if (params.condition === 'once') {
    return {
      values: [WHO_TO_MESSAGE_RESULT_CAP],
      text: `
        ${salesCte()}
        SELECT phone_key, name, phone, last_on::text AS last_on, bill_count, amount
        FROM grouped g
        WHERE g.bill_count = 1
          ${exclusions('g.phone_key')}
        ORDER BY g.last_on DESC
        LIMIT $2`,
    };
  }

  if (params.condition === 'enquiry') {
    const enquiryKey = sqlPhoneKey('e.phone');
    const orderKey = sqlPhoneKey('o.customer_phone');
    return {
      values: [params.days],
      text: `
        WITH latest AS (
          SELECT DISTINCT ON (${enquiryKey})
            ${enquiryKey} AS phone_key,
            e.name,
            e.phone,
            e.created_at
          FROM store_enquiries e
          WHERE e.business_id = $1
            AND ${enquiryKey} IS NOT NULL
          ORDER BY ${enquiryKey}, e.created_at DESC
        )
        SELECT
          l.phone_key,
          l.name,
          l.phone,
          l.created_at::date::text AS last_on,
          NULL::int AS bill_count,
          NULL::numeric AS amount
        FROM latest l
        WHERE l.created_at <= NOW() - make_interval(days => $2::int)
          AND NOT EXISTS (
            SELECT 1 FROM store_orders o
            WHERE o.business_id = $1
              AND o.status <> 'cancelled'
              AND ${orderKey} = l.phone_key
              AND o.created_at >= l.created_at
          )
          ${exclusions('l.phone_key')}
        ORDER BY l.created_at ASC
        LIMIT ${WHO_TO_MESSAGE_RESULT_CAP}`,
    };
  }

  const messageKey = sqlPhoneKey('m.from_number');
  const customerPhoneKey = sqlPhoneKey('cu.phone');
  const conversationKey = sqlPhoneKey('wc.from_number');
  const storeKey = sqlPhoneKey('o.customer_phone');
  return {
    values: [params.days],
    text: `
      WITH latest AS (
        SELECT DISTINCT ON (${messageKey})
          ${messageKey} AS phone_key,
          m.from_number AS phone,
          m.created_at
        FROM whatsapp_conversation_messages m
        WHERE m.business_id = $1
          AND m.direction = 'incoming'
          AND ${messageKey} IS NOT NULL
        ORDER BY ${messageKey}, m.created_at DESC
      )
      SELECT
        l.phone_key,
        COALESCE(
          (
            SELECT c.name FROM customers c
            WHERE c.business_id = $1
              AND ${sqlPhoneKey('c.phone')} = l.phone_key
            ORDER BY c.updated_at DESC NULLS LAST
            LIMIT 1
          ),
          'WhatsApp contact'
        ) AS name,
        l.phone,
        l.created_at::date::text AS last_on,
        NULL::int AS bill_count,
        NULL::numeric AS amount
      FROM latest l
      WHERE l.created_at <= NOW() - make_interval(days => $2::int)
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          JOIN customers cu ON cu.id = i.customer_id AND cu.business_id = i.business_id
          WHERE i.business_id = $1
            AND cu.business_id = $1
            AND ${POSTED}
            AND ${customerPhoneKey} = l.phone_key
            AND i.invoice_date >= l.created_at::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM sales_orders so
          JOIN whatsapp_conversations wc ON wc.id = so.whatsapp_conversation_id AND wc.business_id = so.business_id
          WHERE so.business_id = $1
            AND so.status <> 'cancelled'
            AND so.whatsapp_conversation_id IS NOT NULL
            AND ${conversationKey} = l.phone_key
            AND so.created_at >= l.created_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM store_orders o
          WHERE o.business_id = $1
            AND o.status <> 'cancelled'
            AND ${storeKey} = l.phone_key
            AND o.created_at >= l.created_at
        )
        ${exclusions('l.phone_key')}
      ORDER BY l.created_at ASC
      LIMIT ${WHO_TO_MESSAGE_RESULT_CAP}`,
  };
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso.slice(0, 10);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function reasonForRow(condition: WhoCondition, row: {
  lastOn: string | null;
  amount: number | null;
  billCount: number | null;
}, periodDays: number): string {
  const day = formatDay(row.lastOn);
  if (condition === 'quiet') return day ? `Last bill ${day}` : 'Has bought before';
  if (condition === 'top') {
    const money = row.amount != null ? formatInr(row.amount) : '';
    const bills = row.billCount != null ? `${row.billCount} bill${row.billCount === 1 ? '' : 's'}` : 'bills';
    return `${money} across ${bills} in the last ${periodDays} days`.trim();
  }
  if (condition === 'once') return day ? `One bill on ${day}` : 'Bought only once';
  if (condition === 'enquiry') return day ? `Enquired on ${day}, no store order since` : 'Enquiry with no store order';
  return day ? `Messaged on ${day}, no bill or order since` : 'WhatsApp message with no bill or order';
}

export const WHO_CONDITION_LABELS: Record<WhoCondition, string> = {
  quiet: 'Has not bought in a while',
  top: 'Top buyers',
  once: 'Bought only once',
  enquiry: 'Store enquiry, no order',
  whatsapp: 'WhatsApp message, no order',
};
