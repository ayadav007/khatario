'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, Plug } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { IntegrationMarketplaceList } from '@/components/settings/IntegrationMarketplaceList';
import {
  filterCatalogByCategory,
  filterCatalogByPlatformModules,
  getCategoryLabel,
  normalizeCategoryParam,
  searchCatalog,
} from '@/lib/integrations/catalog';
import { useIntegrationMarketplaceStatus } from '@/hooks/useIntegrationMarketplaceStatus';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { useAuth } from '@/contexts/AuthContext';
import type { PlatformModule } from '@/lib/platform-modules';

function IntegrationsMarketplaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = normalizeCategoryParam(searchParams.get('category'));
  const [query, setQuery] = useState('');
  const { platformSession } = useAuth();
  const enabledModules = (platformSession?.enabledModules ?? ['billing']) as PlatformModule[];

  useEffect(() => {
    const raw = searchParams.get('category');
    if (raw === 'whatsapp') {
      router.replace('/connect/whatsapp');
    }
    if (raw === 'hr') {
      router.replace('/settings/integrations');
    }
  }, [router, searchParams]);

  const { statusById } = useIntegrationMarketplaceStatus();

  const items = useMemo(() => {
    const filtered = filterCatalogByCategory(category === 'crm' ? 'all' : category);
    const forCrm = category === 'crm' ? filtered.filter((e) => e.category === 'crm') : filtered;
    const forModules = filterCatalogByPlatformModules(forCrm, enabledModules);
    return searchCatalog(forModules, query);
  }, [category, query, enabledModules]);

  const title = getCategoryLabel(category === 'crm' ? 'crm' : category);

  return (
    <SettingsPageShell
      title={title}
      description="Connect external services and billing channels. Enable HR or Connect products under Your products."
      icon={Plug}
    >
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
    </SettingsPageShell>
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
