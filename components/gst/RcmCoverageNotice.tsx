'use client';

import { useEffect, useState } from 'react';
import { RCM_EXPENSE_INACTIVE_NOTICE, RCM_PURCHASE_INACTIVE_NOTICE } from '@/lib/gst/rcm-rules';

/**
 * Asks the user to verify reverse charge until automated coverage is actually complete.
 * The text comes from the approved-rule count, not a fixed zero.
 */
export function RcmCoverageNotice({ kind }: { kind: 'purchase' | 'expense' }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/gst/rcm-coverage', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('coverage unavailable');
        return response.json();
      })
      .then((data: { purchaseNotice?: string | null; expenseNotice?: string | null } | null) => {
        if (!data) return;
        const notice = kind === 'purchase' ? data.purchaseNotice : data.expenseNotice;
        setMessage(typeof notice === 'string' && notice.trim() ? notice : null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        setMessage(kind === 'purchase' ? RCM_PURCHASE_INACTIVE_NOTICE : RCM_EXPENSE_INACTIVE_NOTICE);
      });
    return () => controller.abort();
  }, [kind]);

  if (!message) return null;

  return (
    <p
      data-rcm-coverage-notice={kind}
      className="text-sm leading-snug text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
    >
      {message}
    </p>
  );
}
