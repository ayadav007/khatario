'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Zap,
  Bot,
  Users,
  Smartphone,
  Building2,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { IntegrationCatalogEntry } from '@/lib/integrations/catalog';
import type { IntegrationRowStatus } from '@/hooks/useIntegrationMarketplaceStatus';

const ICON_MAP: Record<IntegrationCatalogEntry['icon'], LucideIcon> = {
  MessageSquare,
  Zap,
  Bot,
  Users,
  Smartphone,
  Building2,
  Mail,
};

export interface IntegrationMarketplaceListProps {
  items: IntegrationCatalogEntry[];
  statusById: Record<string, IntegrationRowStatus>;
}

export function IntegrationMarketplaceList({ items, statusById }: IntegrationMarketplaceListProps) {
  const router = useRouter();

  if (items.length === 0) {
    return (
      <p className="text-base text-text-secondary py-10 text-center">
        No integrations match your filters.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
      {items.map((entry) => {
        const status = statusById[entry.id] ?? {
          active: false,
          entitled: true,
          loading: false,
        };
        const Icon = ICON_MAP[entry.icon] ?? MessageSquare;
        const showActive = status.active && !entry.comingSoon;
        const entitled = status.entitled && !entry.comingSoon;

        const navigate = () => {
          if (entry.configureHref) router.push(entry.configureHref);
        };

        let primaryLabel = 'Connect';
        let primaryVariant: 'primary' | 'secondary' = 'primary';
        let onPrimary: (() => void) | undefined = navigate;
        let primaryDisabled = !entry.configureHref || status.loading;

        if (entry.comingSoon) {
          primaryLabel = 'Coming soon';
          primaryVariant = 'secondary';
          primaryDisabled = true;
          onPrimary = undefined;
        } else if (!entitled) {
          primaryLabel = 'Upgrade';
          primaryVariant = 'secondary';
          primaryDisabled = false;
          onPrimary = () => router.push('/settings/subscription');
        } else if (showActive) {
          primaryLabel = 'Access';
          primaryVariant = 'primary';
          onPrimary = navigate;
          primaryDisabled = !entry.configureHref;
        } else if (entry.ctaVariant === 'try') {
          primaryLabel = 'Try now';
          primaryVariant = 'secondary';
          onPrimary = entry.configureHref ? navigate : undefined;
          primaryDisabled = !entry.configureHref;
        } else if (entry.ctaVariant === 'access') {
          primaryLabel = 'Open';
          primaryVariant = 'primary';
          onPrimary = navigate;
          primaryDisabled = !entry.configureHref;
        }

        return (
          <li
            key={entry.id}
            className="flex flex-col sm:flex-row sm:items-center gap-5 p-5 sm:p-6 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <div className="flex gap-5 min-w-0 flex-1">
              <div className="shrink-0 p-3.5 rounded-xl bg-slate-100 text-primary-600 dark:bg-slate-800/60 dark:text-primary-400">
                <Icon className="w-8 h-8" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-text-primary">{entry.title}</h3>
                  {showActive && (
                    <span className="text-sm font-medium px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                      Active
                    </span>
                  )}
                  {entry.comingSoon && (
                    <span className="text-sm font-medium px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="text-base text-text-secondary mt-2 leading-relaxed">{entry.shortDescription}</p>
                {entry.learnMoreUrl && (
                  <Link
                    href={entry.learnMoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base text-primary-600 hover:underline mt-2 inline-block"
                  >
                    Learn more
                  </Link>
                )}
              </div>
            </div>
            <div className="shrink-0 flex sm:flex-col sm:items-end gap-2 sm:min-w-[10rem]">
              {onPrimary ? (
                <Button variant={primaryVariant} size="lg" disabled={primaryDisabled} onClick={onPrimary}>
                  {status.loading && !entry.comingSoon ? '…' : primaryLabel}
                </Button>
              ) : (
                <Button variant="secondary" size="lg" disabled>
                  {primaryLabel}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
