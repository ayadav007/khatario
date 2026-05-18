'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { IntegrationMarketplaceList } from '@/components/settings/IntegrationMarketplaceList';
import {
  filterCatalogByCategory,
  getCategoryLabel,
  normalizeCategoryParam,
  searchCatalog,
} from '@/lib/integrations/catalog';
import { useIntegrationMarketplaceStatus } from '@/hooks/useIntegrationMarketplaceStatus';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

function IntegrationsMarketplaceContent() {
  const searchParams = useSearchParams();
  const category = normalizeCategoryParam(searchParams.get('category'));
  const [query, setQuery] = useState('');

  const { statusById } = useIntegrationMarketplaceStatus();

  const items = useMemo(() => {
    const filtered = filterCatalogByCategory(category === 'crm' ? 'all' : category);
    const forCrm = category === 'crm' ? filtered.filter((e) => e.category === 'crm') : filtered;
    return searchCatalog(forCrm, query);
  }, [category, query]);

  const title = getCategoryLabel(category === 'crm' ? 'crm' : category);

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div className="flex items-center gap-2 text-base text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">
          All Settings
        </Link>
        <ChevronRight className="w-5 h-5 shrink-0" />
        <span className="text-text-primary font-medium">Integrations & Marketplace</span>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-text-primary tracking-tight">{title}</h1>
        <p className="text-base text-text-secondary mt-2 max-w-4xl leading-relaxed">
          Connect apps and services to extend Khatario. More integrations are added over time.
        </p>
      </div>

      <div className="relative w-full max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
        <Input
          type="search"
          placeholder="Search integrations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-11 py-3 text-base min-h-[48px]"
          aria-label="Search integrations"
        />
      </div>

      {category === 'crm' && items.length === 0 && !query.trim() ? (
        <p className="text-base text-text-secondary rounded-lg border border-dashed border-border p-8 text-center leading-relaxed">
          CRM integrations will appear here when available. You can extend the catalog in{' '}
          <code className="text-sm bg-muted px-1.5 py-0.5 rounded">lib/integrations/catalog.ts</code>.
        </p>
      ) : (
        <IntegrationMarketplaceList items={items} statusById={statusById} />
      )}
    </div>
  );
}

export default function IntegrationsMarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      }
    >
      <IntegrationsMarketplaceContent />
    </Suspense>
  );
}
