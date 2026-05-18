import { queryOne } from '@/lib/db';
import { mergePortalTheme } from '@/lib/portal-theme';
import { mergeCustomerSurfaceSettings } from './settings';
import type { PublicBusinessSurface, PublicInvoiceSummary } from './types';
import { getBusinessSubscription } from '@/lib/subscription';
import { getEffectivePlanId } from '@/lib/subscription/effective-plan';

export type ResolvedPublicInvoice = {
  invoice_id: string;
  business_id: string;
  customer_id: string | null;
  customer_name: string;
  public_token: string;
  summary: PublicInvoiceSummary;
  business: PublicBusinessSurface;
};

type InvoiceRow = {
  id: string;
  business_id: string;
  customer_id: string | null;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  grand_total: string | number;
  paid_amount: string | number;
  balance_amount: string | number | null;
  document_type: string | null;
  status: string;
  public_token: string;
  customer_name: string | null;
  business_name: string;
  business_logo: string | null;
  business_phone: string | null;
  business_email: string | null;
  portal_slug: string | null;
  portal_theme: unknown;
  customer_surface_settings: unknown;
};

function paymentStatus(
  grand: number,
  paid: number,
  balance: number
): 'paid' | 'partial' | 'unpaid' {
  if (balance <= 0.01 && paid > 0) return 'paid';
  if (paid > 0.01 && balance > 0.01) return 'partial';
  return 'unpaid';
}

/** Whether this invoice may be shown on a public customer page. */
export function isInvoicePubliclyViewable(status: string): boolean {
  if (status === 'cancelled' || status === 'draft') return false;
  return status === 'final';
}

export async function resolveInvoiceByPublicToken(
  token: string
): Promise<ResolvedPublicInvoice | null> {
  const trimmed = token?.trim();
  if (!trimmed || trimmed.length > 64) return null;

  const row = await queryOne<InvoiceRow>(
    `SELECT
       i.id,
       i.business_id,
       i.customer_id,
       i.invoice_number,
       i.invoice_date,
       i.due_date,
       i.grand_total,
       i.paid_amount,
       i.balance_amount,
       i.document_type,
       i.status,
       i.public_token,
       c.name AS customer_name,
       b.name AS business_name,
       b.logo_url AS business_logo,
       b.phone AS business_phone,
       b.email AS business_email,
       bs.portal_slug,
       bs.portal_theme,
       bs.customer_surface_settings
     FROM invoices i
     INNER JOIN businesses b ON b.id = i.business_id
     LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
     LEFT JOIN business_settings bs ON bs.business_id = i.business_id
     WHERE i.public_token = $1
       AND i.deleted_at IS NULL`,
    [trimmed]
  );

  if (!row || !isInvoicePubliclyViewable(row.status)) return null;

  const grand = Number(row.grand_total ?? 0);
  const paid = Number(row.paid_amount ?? 0);
  const balance =
    row.balance_amount != null
      ? Number(row.balance_amount)
      : grand - paid;

  const surfaceSettings = mergeCustomerSurfaceSettings(row.customer_surface_settings);
  const sub = await getBusinessSubscription(row.business_id);
  const effectivePlan = sub ? getEffectivePlanId(sub) : 'free';
  const showPlatformAd =
    surfaceSettings.show_platform_ads !== false &&
    (effectivePlan === 'free' || effectivePlan === 'trial');

  return {
    invoice_id: row.id,
    business_id: row.business_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name || 'Customer',
    public_token: row.public_token,
    summary: {
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      grand_total: grand,
      paid_amount: paid,
      balance_amount: balance,
      customer_name: row.customer_name || 'Customer',
      document_type: row.document_type,
      status: row.status,
      payment_status: paymentStatus(grand, paid, balance),
    },
    business: {
      id: row.business_id,
      name: row.business_name,
      logo_url: row.business_logo,
      phone: row.business_phone,
      email: row.business_email,
      portal_slug: row.portal_slug,
      portal_theme: mergePortalTheme(row.portal_theme) as unknown as Record<string, unknown>,
      surface_settings: surfaceSettings,
      show_platform_ad: showPlatformAd,
    },
  };
}
