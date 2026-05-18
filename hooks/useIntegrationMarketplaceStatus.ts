'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { useCapabilityCheck } from '@/hooks/useCapability';
import {
  INTEGRATION_CATALOG,
  type IntegrationCatalogEntry,
} from '@/lib/integrations/catalog';

export interface IntegrationRowStatus {
  active: boolean;
  /** User/plan allowed to open configure / connect */
  entitled: boolean;
  loading: boolean;
}

function entryEntitled(
  entry: IntegrationCatalogEntry,
  hasFeature: (id: string) => boolean,
  hasCapability: (resource: string, action?: string) => boolean
): boolean {
  if (entry.comingSoon) return false;
  if (entry.id === 'whatsapp') {
    const keysOk =
      entry.featureKeys.length === 0
        ? false
        : entry.featureKeysMatch === 'any'
          ? entry.featureKeys.some((k) => hasFeature(k))
          : entry.featureKeys.every((k) => hasFeature(k));
    const addonOk =
      hasCapability('integration_whatsapp_bot', 'view') ||
      hasCapability('integration_whatsapp_manual', 'view');
    return keysOk || addonOk;
  }
  if (entry.featureKeys.length === 0) return true;
  const match = entry.featureKeysMatch ?? 'all';
  if (match === 'any') {
    return entry.featureKeys.some((k) => hasFeature(k));
  }
  return entry.featureKeys.every((k) => hasFeature(k));
}

/**
 * Connection / module status for marketplace rows. Extensible per integration id.
 */
export function useIntegrationMarketplaceStatus() {
  const { business } = useAuth();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const { hasCapability, loading: capLoading } = useCapabilityCheck();

  const [whatsappStatus, setWhatsappStatus] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [emailReady, setEmailReady] = useState(false);
  const [emailLoading, setEmailLoading] = useState(true);

  const fetchWhatsapp = useCallback(async () => {
    if (!business?.id) {
      setWhatsappStatus(null);
      setWhatsappLoading(false);
      return;
    }
    setWhatsappLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!res.ok || !ct.includes('application/json')) {
        setWhatsappStatus(null);
        return;
      }
      const data = await res.json();
      setWhatsappStatus(typeof data.status === 'string' ? data.status : null);
    } catch {
      setWhatsappStatus(null);
    } finally {
      setWhatsappLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    fetchWhatsapp();
  }, [fetchWhatsapp]);

  const fetchEmail = useCallback(async () => {
    if (!business?.id) {
      setEmailReady(false);
      setEmailLoading(false);
      return;
    }
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/settings/email?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setEmailReady(Boolean(data.config?.enabled && data.config?.has_password));
      } else {
        setEmailReady(false);
      }
    } catch {
      setEmailReady(false);
    } finally {
      setEmailLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    fetchEmail();
  }, [fetchEmail]);

  const statusById = useMemo(() => {
    const map: Record<string, IntegrationRowStatus> = {};
    const baseLoading = featuresLoading || capLoading;

    for (const entry of INTEGRATION_CATALOG) {
      const entitled = entryEntitled(entry, hasFeature, hasCapability);
      let active = false;
      let loading = baseLoading;

      switch (entry.id) {
        case 'whatsapp':
          loading = baseLoading || whatsappLoading;
          active = whatsappStatus === 'connected';
          break;
        case 'email-smtp':
          loading = baseLoading || emailLoading;
          active = emailReady;
          break;
        case 'hr-suite':
          active = hasCapability('employees', 'view');
          break;
        case 'ai-sales-agent':
        case 'ai-assistant':
        case 'sms':
        default:
          active = false;
          break;
      }

      map[entry.id] = { active, entitled, loading };
    }

    return map;
  }, [
    hasFeature,
    hasCapability,
    featuresLoading,
    capLoading,
    whatsappStatus,
    whatsappLoading,
    emailReady,
    emailLoading,
  ]);

  return { statusById, refetchWhatsapp: fetchWhatsapp };
}
