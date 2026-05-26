import type { FormDraftRecord, TenantScope } from '@/lib/offline/types';
import { entityId, getOfflineDb } from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';

export class DraftRepository {
  draftId(scope: TenantScope, formKey: string): string {
    return entityId('form_draft', scope.businessId, scope.userId, formKey);
  }

  async save(
    scope: TenantScope,
    formKey: string,
    payload: Record<string, unknown>
  ): Promise<FormDraftRecord> {
    const db = await getOfflineDb();
    const record: FormDraftRecord = {
      id: this.draftId(scope, formKey),
      businessId: scope.businessId,
      userId: scope.userId,
      formKey,
      payload,
      updatedAt: Date.now(),
    };
    await db.put(OFFLINE_STORES.drafts, record);
    return record;
  }

  async load(
    scope: TenantScope,
    formKey: string
  ): Promise<FormDraftRecord | null> {
    const db = await getOfflineDb();
    const row = await db.get(
      OFFLINE_STORES.drafts,
      this.draftId(scope, formKey)
    );
    return row ?? null;
  }

  async remove(scope: TenantScope, formKey: string): Promise<void> {
    const db = await getOfflineDb();
    await db.delete(OFFLINE_STORES.drafts, this.draftId(scope, formKey));
  }

  async list(scope: TenantScope): Promise<FormDraftRecord[]> {
    const db = await getOfflineDb();
    const idx = db.transaction(OFFLINE_STORES.drafts).store.index('by-tenant');
    const range = IDBKeyRange.only([scope.businessId, scope.userId]);
    const rows: FormDraftRecord[] = [];
    let cursor = await idx.openCursor(range);
    while (cursor) {
      rows.push(cursor.value);
      cursor = await cursor.continue();
    }
    return rows;
  }
}

export const draftRepository = new DraftRepository();

/** Canonical form keys for offline-safe drafts. */
export const OFFLINE_FORM_KEYS = {
  purchaseNew: 'purchases/new',
  invoiceNew: 'invoices/new',
  paymentRecord: 'payments/record',
} as const;
