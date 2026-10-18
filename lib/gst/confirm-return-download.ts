import type { AckIssue } from '@/lib/gst/acknowledgements';
import { confirmReturnReview } from '@/lib/gst/return-review-prompt';

export interface DownloadGate {
  ok: boolean;
  message: string | null;
}

/**
 * Ask the readiness API before a portal file is generated.
 * A block stops the file. Anything else is acknowledged per issue, then the file can be built.
 * The file is still not a filed return.
 */
export async function confirmReturnDownload(
  kind: 'gstr1' | 'gstr3b' | 'gstr9',
  period: string,
  depth = 0
): Promise<DownloadGate> {
  const res = await fetch(`/api/gst/return-readiness?kind=${encodeURIComponent(kind)}&period=${encodeURIComponent(period)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, message: data?.error || 'Could not check return readiness' };
  }
  if (data.blocked) {
    return {
      ok: false,
      message: 'Download is stopped because a GSTIN or a required portal field is invalid. The on-screen report is still available. This is not a filing mark.',
    };
  }
  const needs = (data.needsAcknowledgement || []) as AckIssue[];
  if (needs.length > 0) {
    if (depth > 0) {
      return { ok: false, message: 'Those items changed again. Review the return and try the download once more.' };
    }
    const accepted = await confirmReturnReview(needs);
    if (!accepted) return { ok: false, message: null };
    const saved = await fetch('/api/gst/return-readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        period,
        snapshotId: data.snapshotId,
        issues: needs,
      }),
    });
    if (!saved.ok) return { ok: false, message: 'Could not store the acknowledgement' };
    return confirmReturnDownload(kind, period, depth + 1);
  }
  if (data.annualCurrent === false) {
    return { ok: false, message: 'GSTR-9 is not current. The financial-year figures changed after the last reconciliation.' };
  }
  return { ok: true, message: null };
}
