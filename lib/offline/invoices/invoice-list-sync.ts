import type { TenantScope } from '@/lib/offline/types';
import { isAppOffline } from '@/lib/network/offline-state';
import {
  saveInvoiceListCache,
  type CachedInvoiceListRow,
} from '@/lib/offline/invoices/invoice-list-cache';

export interface InvoiceListSyncOptions {
  scope: TenantScope;
  userId: string;
  branchId?: string | null;
  signal?: AbortSignal;
}

/** Refresh the local invoice list window (latest 100) from the server. */
export async function runInvoiceListSync(
  options: InvoiceListSyncOptions
): Promise<number> {
  if (isAppOffline()) {
    throw new Error('Invoice list sync requires network');
  }

  const { scope, userId, branchId, signal } = options;
  const params = new URLSearchParams({
    business_id: scope.businessId,
    user_id: userId,
    limit: '100',
  });
  if (branchId && branchId !== 'ALL') {
    params.set('branch_id', branchId);
  }

  const res = await fetch(`/api/offline-sync/invoices?${params.toString()}`, {
    credentials: 'include',
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Invoice list sync failed (${res.status})`
    );
  }

  const data = (await res.json()) as { invoices?: CachedInvoiceListRow[] };
  const invoices = data.invoices ?? [];
  await saveInvoiceListCache(scope, invoices, branchId ?? null);
  return invoices.length;
}
