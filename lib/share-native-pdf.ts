import { isCapacitorNative } from '@/lib/capacitor/platform';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
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

/** Opens the OS share sheet with a PDF (or other file) attached. */
export async function shareFileBlobNative(options: {
  blob: Blob;
  filename: string;
  title: string;
  text?: string;
  dialogTitle?: string;
}): Promise<void> {
  if (!isCapacitorNative()) {
    throw new Error('Native share is only available in the mobile app');
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  const base64 = await blobToBase64(options.blob);
  await Filesystem.writeFile({
    path: options.filename,
    data: base64,
    directory: Directory.Cache,
  });

  const result = await Filesystem.getUri({
    path: options.filename,
    directory: Directory.Cache,
  });

  try {
    await Share.share({
      title: options.title,
      text: options.text,
      files: [result.uri],
      dialogTitle: options.dialogTitle ?? 'Share',
    });
  } catch (error) {
    if (isUserCancelled(error)) return;
    throw error;
  }
}

/** Web Share API with file attachment (mobile browser). */
export async function shareFileBlobWeb(options: {
  blob: Blob;
  filename: string;
  title: string;
  text?: string;
  mime?: string;
}): Promise<boolean> {
  const mime =
    options.mime ??
    (options.filename.endsWith('.pdf')
      ? 'application/pdf'
      : options.filename.endsWith('.png')
        ? 'image/png'
        : 'application/octet-stream');

  const file = new File([options.blob], options.filename, { type: mime });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: options.title, text: options.text, files: [file] });
    return true;
  }
  return false;
}
