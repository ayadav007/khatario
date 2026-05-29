import type { TenantScope } from '@/lib/offline/types';
import {
  entityCacheRepository,
} from '@/lib/offline/repositories/entity-cache-repository';

/** Max invoice list rows stored locally for offline browsing. */
export const INVOICE_LIST_CACHE_MAX = 100;

export const INVOICE_LIST_CACHE_KEY = 'list:recent';

export interface CachedInvoiceListRow {
  id: string;
  invoice_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  invoice_date: string;
  due_date?: string | null;
  grand_total?: number;
  paid_amount?: number;
  balance_amount?: number;
  status?: string;
  payment_status?: string;
  document_type?: string | null;
  branch_id?: string | null;
  days_overdue?: number;
  updated_at?: string;
  [key: string]: unknown;
}

export interface InvoiceListCachePayload {
  invoices: CachedInvoiceListRow[];
  syncedAt: number;
  branchId?: string | null;
}

export async function saveInvoiceListCache(
  scope: TenantScope,
  invoices: CachedInvoiceListRow[],
  branchId?: string | null
): Promise<void> {
  const trimmed = invoices.slice(0, INVOICE_LIST_CACHE_MAX);
  const payload: InvoiceListCachePayload = {
    invoices: trimmed,
    syncedAt: Date.now(),
    branchId: branchId ?? null,
  };
  await entityCacheRepository.upsert(
    scope,
    'invoice',
    INVOICE_LIST_CACHE_KEY,
    payload
  );
}

export async function loadInvoiceListCache(
  scope: TenantScope
): Promise<CachedInvoiceListRow[] | null> {
  const row = await entityCacheRepository.getByKey<InvoiceListCachePayload>(
    scope,
    'invoice',
    INVOICE_LIST_CACHE_KEY
  );
  if (!row?.data) return null;
  return row.data.invoices ?? [];
}

export async function getInvoiceListCacheStatus(
  scope: TenantScope
): Promise<{ count: number; syncedAt: number | null }> {
  const row = await entityCacheRepository.getByKey<InvoiceListCachePayload>(
    scope,
    'invoice',
    INVOICE_LIST_CACHE_KEY
  );
  if (!row?.data?.invoices) {
    return { count: 0, syncedAt: null };
  }
  return {
    count: row.data.invoices.length,
    syncedAt: row.data.syncedAt ?? row.syncedAt ?? null,
  };
}
