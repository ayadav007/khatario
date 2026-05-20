import { isCapacitorNative } from '@/lib/capacitor/platform';
import { shareFileBlobNative, shareFileBlobWeb } from '@/lib/share-native-pdf';

export type ShareInvoiceResult = 'shared' | 'cancelled' | 'modal' | 'error';
export type InvoiceShareFormat = 'pdf' | 'image' | 'link';

function safeFileName(invoiceNumber: string, ext: string): string {
  const base = invoiceNumber.replace(/[^\w.-]+/g, '_') || 'invoice';
  return `invoice-${base}.${ext}`;
}

export async function fetchInvoiceShareUrl(invoiceId: string): Promise<string> {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/public-link`, { credentials: 'include' });
    const data = await res.json();
    if (res.ok && data.public_url) {
      return data.public_url as string;
    }
  } catch {
    /* fall through */
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/invoices/${invoiceId}/view`;
  }
  return `/invoices/${invoiceId}/view`;
}

async function fetchInvoiceFileBlob(
  invoiceId: string,
  format: 'pdf' | 'image',
  userId: string,
  businessId?: string
): Promise<Blob> {
  const path = format === 'pdf' ? 'pdf' : 'image';
  const sp = new URLSearchParams({ user_id: userId });
  if (businessId) sp.set('business_id', businessId);

  const res = await fetch(`/api/invoices/${invoiceId}/${path}?${sp.toString()}`, {
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') ?? '';
  const expected = format === 'pdf' ? 'application/pdf' : 'image/png';

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Failed to load invoice ${format}`);
  }

  if (!contentType.includes(expected.split('/')[1])) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error || `Server did not return ${format.toUpperCase()}`);
    } catch (e) {
      if (e instanceof Error && e.message !== `Server did not return ${format.toUpperCase()}`) {
        throw e;
      }
      throw new Error(`Server did not return ${format.toUpperCase()}`);
    }
  }

  const blob = await res.blob();
  if (blob.size < 32) {
    throw new Error(`Invoice ${format.toUpperCase()} file is empty`);
  }
  return blob;
}

function isUserCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  if (e.name === 'AbortError') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('cancel') || msg.includes('dismiss') || msg.includes('abort');
}

async function shareLinkOnly(title: string, text: string, shareUrl: string): Promise<ShareInvoiceResult> {
  if (isCapacitorNative()) {
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({
        title,
        text,
        url: shareUrl,
        dialogTitle: 'Share invoice',
      });
      return 'shared';
    } catch (error) {
      if (isUserCancelled(error)) return 'cancelled';
      throw error;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({ title, text, url: shareUrl });
    return 'shared';
  }

  return 'modal';
}

/**
 * Native Android/iOS share with optional PDF or PNG attachment.
 */
export async function shareInvoiceNative(options: {
  invoiceId: string;
  invoiceNumber: string;
  businessName?: string;
  format: InvoiceShareFormat;
  userId?: string;
  businessId?: string;
}): Promise<ShareInvoiceResult> {
  const shareUrl = await fetchInvoiceShareUrl(options.invoiceId);
  const title = `Invoice ${options.invoiceNumber}`;
  const text = options.businessName
    ? `Invoice ${options.invoiceNumber} from ${options.businessName}`
    : `Invoice ${options.invoiceNumber}`;

  try {
    if (options.format === 'link') {
      const linkText = `${text}\n${shareUrl}`;
      return await shareLinkOnly(title, linkText, shareUrl);
    }

    if (!options.userId) {
      throw new Error('User session not loaded. Please try again.');
    }

    const blob = await fetchInvoiceFileBlob(
      options.invoiceId,
      options.format === 'pdf' ? 'pdf' : 'image',
      options.userId,
      options.businessId
    );
    const filename = safeFileName(
      options.invoiceNumber,
      options.format === 'pdf' ? 'pdf' : 'png'
    );

    if (isCapacitorNative()) {
      await shareFileBlobNative({
        blob,
        filename,
        title,
        text,
        dialogTitle: 'Share invoice',
      });
      return 'shared';
    }

    const shared = await shareFileBlobWeb({
      blob,
      filename,
      title,
      text,
      mime: options.format === 'pdf' ? 'application/pdf' : 'image/png',
    });
    return shared ? 'shared' : 'modal';
  } catch (error) {
    if (isUserCancelled(error)) return 'cancelled';
    if (isCapacitorNative()) {
      throw error;
    }
    return 'modal';
  }
}

/** True only inside the Capacitor shell — not mobile browser. */
export function canUseNativeInvoiceShare(): boolean {
  return isCapacitorNative();
}
