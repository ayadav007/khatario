'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { WhatsAppTab } from '@/components/settings/WhatsAppTab';
import { useAuth } from '@/contexts/AuthContext';

export default function ConnectWhatsAppPage() {
  const { platformSession } = useAuth();
  const hasConnectProduct = platformSession?.enabledModules.includes('connect') ?? false;

  return (
    <div className="max-w-4xl mx-auto px-2 sm:px-0">
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-800">
              <MessageSquare className="h-6 w-6 text-text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
                Send invoices on WhatsApp
              </h1>
              <p className="text-text-secondary mt-1">
                Link your business number to send invoices, estimates, and payment reminders from billing.
              </p>
            </div>
          </div>
        </div>

        <WhatsAppTab connectOnly />

        <p className="text-sm text-text-muted">
          {hasConnectProduct ? (
            <>
              Need inbox, bot rules, or campaigns?{' '}
              <Link href="/settings/whatsapp" className="link-primary font-medium">
                Open Connect messaging settings
              </Link>
            </>
          ) : (
            <>
              Need inbox, bot, and customer messaging?{' '}
              <Link href="/settings/products?upsell=connect" className="link-primary font-medium">
                Add Connect on Your products
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
