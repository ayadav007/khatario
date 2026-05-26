'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TenantScope } from '@/lib/offline/types';
import { draftRepository } from '@/lib/offline/repositories/draft-repository';

/**
 * Auto-persist form drafts locally; survives refresh and offline periods.
 */
export function useOfflineDraft(
  scope: TenantScope | null,
  formKey: string,
  debounceMs = 800
) {
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [initialPayload, setInitialPayload] = useState<Record<
    string,
    unknown
  > | null>(null);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void draftRepository.load(scope, formKey).then((row) => {
      if (cancelled) return;
      setInitialPayload(row?.payload ?? null);
      setDraftLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [scope?.businessId, scope?.userId, formKey]);

  const saveDraft = useCallback(
    (payload: Record<string, unknown>) => {
      if (!scope) return;
      void draftRepository.save(scope, formKey, payload);
    },
    [scope, formKey]
  );

  const clearDraft = useCallback(() => {
    if (!scope) return;
    void draftRepository.remove(scope, formKey);
    setInitialPayload(null);
  }, [scope, formKey]);

  return { draftLoaded, initialPayload, saveDraft, clearDraft, debounceMs };
}
