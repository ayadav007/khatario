'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { fetchBusinessEmailReady } from '@/lib/business-email-client';

/**
 * Gates "Send Email" behind SMTP readiness.
 * Not ready → configure modal; ready → compose modal.
 */
export function useGatedDocumentEmail() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [checking, setChecking] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [configureForbidden, setConfigureForbidden] = useState(false);

  const requestSendEmail = useCallback(async () => {
    if (!business?.id) {
      toast.error('Business not loaded');
      return;
    }
    setChecking(true);
    setConfigureForbidden(false);
    try {
      const result = await fetchBusinessEmailReady(business.id);
      if (result.ready) {
        setComposeOpen(true);
        return;
      }
      if (result.forbidden) {
        setConfigureForbidden(true);
        setConfigureOpen(true);
        return;
      }
      if (result.error && !result.config) {
        toast.error(result.error);
        return;
      }
      setConfigureOpen(true);
    } finally {
      setChecking(false);
    }
  }, [business?.id, toast]);

  const onEmailConfigured = useCallback(() => {
    setConfigureOpen(false);
    setConfigureForbidden(false);
    setComposeOpen(true);
  }, []);

  const closeConfigure = useCallback(() => {
    setConfigureOpen(false);
    setConfigureForbidden(false);
  }, []);

  const closeCompose = useCallback(() => {
    setComposeOpen(false);
  }, []);

  return {
    checking,
    composeOpen,
    configureOpen,
    configureForbidden,
    requestSendEmail,
    onEmailConfigured,
    closeConfigure,
    closeCompose,
    setComposeOpen,
  };
}
