import type { StoreContactForm, StoreFormFieldMode } from '@/lib/store/store-theme';

/** Hidden input name; real shoppers never fill it, form bots usually do. */
export const ENQUIRY_HONEYPOT_FIELD = 'website';

export const ENQUIRY_STATUSES = ['new', 'read', 'replied', 'archived'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface EnquiryInput {
  name: string;
  phone: string | null;
  email: string | null;
  topic: string | null;
  message: string;
  source_path: string | null;
}

export type EnquiryValidation =
  | { ok: true; value: EnquiryInput }
  | { ok: false; error: string; spam?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function checkField(
  mode: StoreFormFieldMode,
  value: string,
  valid: boolean,
  label: string,
): string | null {
  if (mode === 'off') return null;
  if (!value) return mode === 'required' ? `${label} is required` : null;
  return valid ? null : `Enter a valid ${label.toLowerCase()}`;
}

/** Topic of the storefront newsletter signup section (D19). */
export const NEWSLETTER_TOPIC = 'newsletter';

/** True when the page that sent the request was a theme preview or the Studio 2 editor frame. */
export function isPreviewReferer(referer: string | null | undefined): boolean {
  if (!referer) return false;
  try {
    const sp = new URL(referer).searchParams;
    return sp.has('preview_theme') || sp.has('pt') || sp.get('editor') === '1';
  } catch {
    return false;
  }
}

/**
 * Whether the enquiries endpoint takes this request at all (before validation and rate limits).
 * The contact form decides, except that a newsletter signup is also taken while the form is off when the
 * store's live theme has an enabled newsletter section (the merchant opted in by adding it). Newsletter
 * signups sent from a theme preview or the editor are never taken.
 */
export async function enquiryAccepted(opts: {
  formEnabled: boolean;
  isNewsletter: boolean;
  fromPreview: boolean;
  liveNewsletterSection: () => Promise<boolean>;
}): Promise<boolean> {
  if (!opts.isNewsletter) return opts.formEnabled;
  if (opts.fromPreview) return false;
  if (opts.formEnabled) return true;
  return opts.liveNewsletterSection();
}

export function validateEnquiry(body: unknown, form: StoreContactForm): EnquiryValidation {
  const src = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (text(src[ENQUIRY_HONEYPOT_FIELD], 200)) {
    return { ok: false, error: 'Rejected', spam: true };
  }

  // A newsletter signup is just an email: no name, phone, topic list or contact-form field modes.
  if (text(src.topic, 40) === NEWSLETTER_TOPIC) {
    const email = text(src.email, 255).toLowerCase();
    const emailError = checkField('required', email, EMAIL_RE.test(email), 'Email');
    if (emailError) return { ok: false, error: emailError };
    const path = text(src.source_path, 200);
    return {
      ok: true,
      value: {
        name: 'Newsletter subscriber',
        phone: null,
        email,
        topic: NEWSLETTER_TOPIC,
        message: 'Newsletter signup',
        source_path: path.startsWith('/') ? path : null,
      },
    };
  }

  const name = text(src.name, 120);
  if (name.length < 2) return { ok: false, error: 'Name is required' };

  const rawPhone = String(src.phone ?? '').replace(/\D/g, '');
  const phone = rawPhone.length === 12 && rawPhone.startsWith('91') ? rawPhone.slice(2) : rawPhone;
  const phoneError = checkField(form.phone, phone, /^[6-9]\d{9}$/.test(phone), 'Phone number');
  if (phoneError) return { ok: false, error: phoneError };

  const email = text(src.email, 255).toLowerCase();
  const emailError = checkField(form.email, email, EMAIL_RE.test(email), 'Email');
  if (emailError) return { ok: false, error: emailError };

  let topic: string | null = null;
  if (form.topics.length > 0) {
    const chosen = text(src.topic, 40);
    if (!form.topics.includes(chosen)) return { ok: false, error: 'Please choose a topic' };
    topic = chosen;
  }

  const message = String(src.message ?? '').trim().slice(0, 2000);
  if (message.length < 5) return { ok: false, error: 'Please write a short message' };
  if ((message.match(/https?:\/\//gi) ?? []).length > 3) {
    return { ok: false, error: 'Too many links in the message', spam: true };
  }

  const path = text(src.source_path, 200);
  return {
    ok: true,
    value: {
      name,
      phone: form.phone === 'off' || !phone ? null : phone,
      email: form.email === 'off' || !email ? null : email,
      topic,
      message,
      source_path: path.startsWith('/') ? path : null,
    },
  };
}
