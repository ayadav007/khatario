import { isCapacitorNative } from '@/lib/capacitor/platform';

export type ShareInvoiceResult = 'shared' | 'cancelled' | 'modal';
export type InvoiceShareFormat = 'pdf' | 'image' | 'link';

function safeFileName(invoiceNumber: string, ext: string): string {
  const base = invoiceNumber.replace(/[^\w.-]+/g, '_') || 'invoice';
  return `invoice-${base}.${ext}`;
}

export async function fetchInvoiceShareUrl(invoiceId: string): Promise<string> {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/public-link`);
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
  userId: string
): Promise<Blob> {
  const path = format === 'pdf' ? 'pdf' : 'image';
  const res = await fetch(
    `/api/invoices/${invoiceId}/${path}?user_id=${encodeURIComponent(userId)}`,
    { credentials: 'include' }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Failed to load invoice ${format}`);
  }
  return res.blob();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function isUserCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  if (e.name === 'AbortError') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('cancel') || msg.includes('dismiss') || msg.includes('abort');
}

async function shareWithFile(
  blob: Blob,
  filename: string,
  title: string,
  text: string
): Promise<ShareInvoiceResult> {
  if (isCapacitorNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    const result = await Filesystem.getUri({
      path: filename,
      directory: Directory.Cache,
    });
    await Share.share({
      title,
      text,
      files: [result.uri],
      dialogTitle: 'Share invoice',
    });
    return 'shared';
  }

  const mime = filename.endsWith('.pdf') ? 'application/pdf' : 'image/png';
  const file = new File([blob], filename, { type: mime });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, text, files: [file] });
    return 'shared';
  }

  return 'modal';
}

async function shareLinkOnly(title: string, text: string, shareUrl: string): Promise<ShareInvoiceResult> {
  if (isCapacitorNative()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({
      title,
      text,
      url: shareUrl,
      dialogTitle: 'Share invoice',
    });
    return 'shared';
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
      return 'modal';
    }

    const blob = await fetchInvoiceFileBlob(
      options.invoiceId,
      options.format === 'pdf' ? 'pdf' : 'image',
      options.userId
    );
    const filename = safeFileName(
      options.invoiceNumber,
      options.format === 'pdf' ? 'pdf' : 'png'
    );
    return await shareWithFile(blob, filename, title, text);
  } catch (error) {
    if (isUserCancelled(error)) return 'cancelled';
    return 'modal';
  }
}

export function canUseNativeInvoiceShare(): boolean {
  if (isCapacitorNative()) return true;
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    return true;
  }
  return false;
}
