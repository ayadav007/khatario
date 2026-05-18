'use client';

import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  IndianRupee,
  Landmark,
  Smartphone,
  Store,
  Wallet,
} from 'lucide-react';
import type { PaymentProviderCatalogEntry } from '@/lib/payment-providers-catalog';
import type { PaymentProviderStatusRow } from '@/components/settings/PaymentProviderCard';

function providerIcon(id: string): LucideIcon {
  switch (id.toLowerCase()) {
    case 'cashfree':
      return Wallet;
    case 'razorpay':
      return IndianRupee;
    case 'payu':
      return CreditCard;
    case 'phonepe':
      return Smartphone;
    case 'instamojo':
      return Store;
    default:
      return Landmark;
  }
}

export type ProviderSelectorProps = {
  definitions: PaymentProviderCatalogEntry[];
  statuses: PaymentProviderStatusRow[];
  selectedProviderId: string;
  onSelect: (providerId: string) => void;
};

export function ProviderSelector({
  definitions,
  statuses,
  selectedProviderId,
  onSelect,
}: ProviderSelectorProps) {
  return (
    <div className="relative">
      <div
        className="-mx-1 flex gap-3 overflow-x-auto pb-2 pt-1"
        role="tablist"
        aria-label="Payment providers"
      >
        {definitions.map((def) => {
          const status = statuses.find((s) => s.id === def.id);
          const configured = Boolean(status?.configured);
          const active = def.id === selectedProviderId;
          const Icon = providerIcon(def.id);
          const name = status?.displayName ?? def.displayName;

          return (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-selected={active}
              id={`provider-tab-${def.id}`}
              onClick={() => onSelect(def.id)}
              className={[
                'group flex min-w-[148px] shrink-0 flex-col gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition-all',
                'hover:border-gray-300 hover:shadow-md',
                'dark:bg-slate-900',
                active
                  ? 'border-primary-600 ring-2 ring-primary-500/20 dark:border-primary-500 dark:ring-primary-500/25'
                  : 'border-border dark:border-slate-700',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <div
                  className={[
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors',
                    active
                      ? 'bg-gray-100 dark:bg-slate-800'
                      : 'bg-gray-50 group-hover:bg-gray-100 dark:bg-slate-800/80 dark:group-hover:bg-slate-800',
                  ].join(' ')}
                  aria-hidden
                >
                  <Icon className="h-5 w-5 text-gray-700 dark:text-slate-200" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {name}
                  </p>
                  <div className="mt-2">
                    {configured ? (
                      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        Not configured
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
