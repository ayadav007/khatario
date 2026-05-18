'use client';

import { useCallback, useState } from 'react';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface UseEntityMutationOptions {
  entity: string;
  businessId: string | null;
}

function resolveBasePath(entity: string): string {
  return `/api/${entity}`;
}

async function handleResponse(res: Response, operation: string) {
  if (!res.ok) {
    const data = await safeJsonParse(res);
    const message = getApiErrorMessage(data, `${operation} failed (${res.status})`);
    throw new Error(message);
  }
  return safeJsonParse(res) ?? {};
}

export function useEntityMutation({ entity, businessId }: UseEntityMutationOptions) {
  const [loading, setLoading] = useState(false);

  const create = useCallback(
    async <T extends Record<string, unknown>>(payload: T) => {
      if (!businessId) throw new Error('businessId is required');
      setLoading(true);
      try {
        const res = await fetch(resolveBasePath(entity), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, business_id: (payload as any).business_id ?? businessId }),
        });
        return handleResponse(res, 'Create');
      } finally {
        setLoading(false);
      }
    },
    [businessId, entity]
  );

  const update = useCallback(
    async <T extends Record<string, unknown>>(id: string, payload: T) => {
      setLoading(true);
      try {
        const res = await fetch(`${resolveBasePath(entity)}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return handleResponse(res, 'Update');
      } finally {
        setLoading(false);
      }
    },
    [entity]
  );

  const remove = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const res = await fetch(`${resolveBasePath(entity)}/${id}`, { method: 'DELETE' });
        return handleResponse(res, 'Delete');
      } finally {
        setLoading(false);
      }
    },
    [entity]
  );

  return { create, update, remove, loading };
}
