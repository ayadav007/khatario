'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CreditCard, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { DEFAULT_POST_PAYMENT_MESSAGE, MESSAGE_MAX, type AgentSettings } from '@/lib/ai-agent/types';
import { FieldLabel, SectionCard } from './SectionCard';

export function PaymentsSection({
  settings,
  onChange,
  paymentsConfigured,
}: {
  settings: AgentSettings;
  onChange: (patch: Partial<AgentSettings>) => void;
  paymentsConfigured: boolean;
}) {
  const ordersOn = settings.skills.takeOrders;
  return (
    <SectionCard id="payments" icon={CreditCard} title="Payments" description="Collect payment in the chat after an order.">
      <div className="space-y-5">
        <Switch
          checked={ordersOn && settings.skills.paymentLinks}
          disabled={!ordersOn}
          onChange={(paymentLinks) => onChange({ skills: { ...settings.skills, paymentLinks } })}
          label="Send a UPI payment link at checkout"
          description={
            ordersOn
              ? 'After the customer confirms, the agent shares a link for the order total.'
              : 'Turn on "Take orders" in Skills to use payment links.'
          }
        />

        {ordersOn && settings.skills.paymentLinks && !paymentsConfigured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No UPI ID or payment gateway is set up yet, so the agent can&apos;t send a link.{' '}
              <Link href="/settings/payments" className="font-medium underline">Set up payments</Link>
            </span>
          </div>
        )}

        <div>
          <FieldLabel hint="Added after the order summary once a payment is confirmed.">Message after payment</FieldLabel>
          <Textarea
            rows={2}
            value={settings.postPaymentMessage}
            maxLength={MESSAGE_MAX}
            placeholder={DEFAULT_POST_PAYMENT_MESSAGE}
            onChange={(e) => onChange({ postPaymentMessage: e.target.value })}
          />
        </div>

        <Link href="/settings/payments" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline">
          Payment provider settings <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionCard>
  );
}
