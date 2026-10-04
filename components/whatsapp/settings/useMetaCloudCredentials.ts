'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MetaCloudPublic } from '@/components/whatsapp/MetaCloudCredentialsForm';
import { useToastContext } from '@/contexts/ToastContext';

export type MetaCloudPayload = {
  waba_id: string;
  phone_number_id: string;
  access_token: string;
  app_secret: string;
  verify_token: string;
};

export function useMetaCloudCredentials() {
  const toast = useToastContext();
  const [credentials, setCredentials] = useState<MetaCloudPublic | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/whatsapp-cloud');
      const data = await res.json();
      if (res.ok) {
        setCredentials(data.credentials || null);
        setWebhookUrl(data.webhook_url || '');
      }
    } catch {
      /* treated as not configured */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (payload: MetaCloudPayload) => {
      setSaving(true);
      try {
        const res = await fetch('/api/settings/whatsapp-cloud', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok) {
          setCredentials(data.credentials);
          toast.success('Cloud API credentials saved');
        } else {
          toast.error(data.error || 'Failed to save Cloud API credentials');
        }
      } catch {
        toast.error('Failed to save Cloud API credentials');
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );

  return { credentials, webhookUrl, loaded, saving, save };
}
