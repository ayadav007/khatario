export type InvoiceViewSource = 'public_link' | 'portal' | 'email';

export interface CustomerSurfacePromo {
  enabled: boolean;
  title?: string;
  body?: string;
  image_url?: string;
  cta_label?: string;
  cta_url?: string;
  cta_phone?: string;
  cta_whatsapp?: string;
}

export interface CustomerSurfaceSettings {
  promo?: CustomerSurfacePromo;
  /** When false, hide Khatario platform promo even on free plan */
  show_platform_ads?: boolean;
  /** Notify staff on first customer view of a bill */
  notify_on_first_view?: boolean;
}

export const DEFAULT_CUSTOMER_SURFACE_SETTINGS: CustomerSurfaceSettings = {
  promo: { enabled: false },
  show_platform_ads: true,
  notify_on_first_view: true,
};

export interface PublicInvoiceSummary {
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  customer_name: string;
  document_type: string | null;
  status: string;
  payment_status: 'paid' | 'partial' | 'unpaid';
}

export interface PublicBusinessSurface {
  id: string;
  name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  portal_slug: string | null;
  portal_theme: Record<string, unknown> | null;
  surface_settings: CustomerSurfaceSettings;
  show_platform_ad: boolean;
}
