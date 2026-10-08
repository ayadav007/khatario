'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Settings,
  LogOut,
  FileText,
  ShoppingCart,
  Package,
  DollarSign,
  BarChart3,
  UserCheck,
  Wrench,
  HelpCircle,
  Store,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useShellLayoutSettings } from '@/contexts/LayoutDataContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { buildMoreMenuSections, type MoreNavSection } from '@/lib/more-navigation';
import { MORE_SECTION_QUERY_KEY } from '@/lib/navigation/more-menu-back';
import type { LucideIcon } from 'lucide-react';
import { MobileAccountCard } from '@/components/layout/MobileAccountCard';
import { MobileListRow, MobileListSection } from '@/components/layout/MobileList';

const SECTION_ICONS: Record<string, LucideIcon> = {
  Supplier: Store,
  Sales: FileText,
  Purchases: ShoppingCart,
  Inventory: Package,
  Accounting: DollarSign,
  Reports: BarChart3,
  'HR & Employees': UserCheck,
  Connect: MessageSquare,
  WhatsApp: MessageSquare,
  Tools: Wrench,
  'Settings & data': Settings,
  Support: HelpCircle,
};

function moreSectionId(title: string) {
  return `more-${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
}

export default function MorePage() {
  const searchParams = useSearchParams();
  const { logout, business, platformSession } = useAuth();
  const { warehousesEnabled, snapshotLoaded } = useShellLayoutSettings();
  const { isOffline } = useNetworkStatus();
  const { hasCapability, checkCapability } = useCapabilityCheck();
  const [isSupplier, setIsSupplier] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    if (!business?.id || isOffline) {
      setIsSupplier(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    void (async () => {
      try {
        const res = await fetch(
          `/api/suppliers/dashboard?supplier_business_id=${business.id}`,
          { signal: controller.signal },
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setIsSupplier((data.stats?.active_customers || 0) > 0);
        } else if (!cancelled) {
          setIsSupplier(false);
        }
      } catch {
        if (!cancelled) setIsSupplier(false);
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [business?.id, isOffline]);

  // Show menu once capability snapshot is ready — do not block on supplier probe or
  // warehouses API (those refine sections in the background).
  const menuReady = snapshotLoaded;

  const enabledModules = platformSession?.enabledModules ?? ['billing'];

  const sections: MoreNavSection[] = useMemo(() => {
    if (!menuReady) return [];
    return buildMoreMenuSections({
      isSupplier,
      warehousesEnabled: !!warehousesEnabled,
      hasCapability,
      checkCapability,
      enabledModules,
    });
  }, [
    menuReady,
    isSupplier,
    warehousesEnabled,
    hasCapability,
    checkCapability,
    enabledModules,
  ]);

  // Back from a More destination opens that section (?section=).
  useEffect(() => {
    const section = searchParams.get(MORE_SECTION_QUERY_KEY);
    if (!section || !sections.length) return;
    setOpenSections((prev) => ({ ...prev, [section]: true }));
    document.getElementById(moreSectionId(section))?.scrollIntoView({ block: 'start' });
  }, [searchParams, sections]);

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <div className="mobile-screen flex min-h-[calc(100vh-5rem)] flex-col pb-2">
      {!menuReady ? (
        <div className="flex flex-col items-center justify-center gap-stack-tight py-12 text-text-muted">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <p className="text-sm">Loading menu…</p>
        </div>
      ) : (
        <>
          <MobileAccountCard className="mb-1 lg:hidden" />

          <div className="-mx-page-x">
            {sections.map((section) => {
              const Icon = SECTION_ICONS[section.title] || FileText;
              return (
                <MobileListSection
                  key={section.title}
                  id={moreSectionId(section.title)}
                  title={section.title}
                  open={openSections[section.title] !== false}
                  onToggle={() => toggleSection(section.title)}
                >
                  {section.items.map((item) => (
                    <MobileListRow
                      key={`${section.title}-${item.href}-${item.label}`}
                      href={item.href}
                      label={item.label}
                      icon={Icon}
                      locked={item.isLocked}
                    />
                  ))}
                </MobileListSection>
              );
            })}
          </div>

          <button
            type="button"
            onClick={logout}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--mobile-radius-sheet,18px)] border border-rose-100 bg-rose-50 py-3.5 text-sm font-semibold text-rose-600 transition-colors active:bg-rose-100"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>

          <p className="text-center text-2xs text-text-muted uppercase tracking-widest mt-4">
            Khatario
          </p>
        </>
      )}
    </div>
  );
}
