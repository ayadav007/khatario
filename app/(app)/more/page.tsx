'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings,
  LogOut,
  ChevronRight,
  ChevronUp,
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
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { buildMoreMenuSections, type MoreNavSection } from '@/lib/more-navigation';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

const SECTION_ICONS: Record<string, LucideIcon> = {
  Supplier: Store,
  Sales: FileText,
  Purchases: ShoppingCart,
  Inventory: Package,
  Accounting: DollarSign,
  Reports: BarChart3,
  'HR & Employees': UserCheck,
  Tools: Wrench,
  'Settings & data': Settings,
  Support: HelpCircle,
};

function sectionIconBg(title: string): string {
  const key = title.split('&')[0].trim();
  const map: Record<string, string> = {
    Supplier: 'bg-amber-100 text-amber-800',
    Sales: 'bg-slate-100 text-primary-700',
    Purchases: 'bg-orange-100 text-orange-800',
    Inventory: 'bg-emerald-100 text-emerald-800',
    Accounting: 'bg-violet-100 text-violet-800',
    Reports: 'bg-cyan-100 text-cyan-800',
    'HR & Employees': 'bg-pink-100 text-pink-800',
    Tools: 'bg-indigo-100 text-indigo-800',
    'Settings & data': 'bg-slate-200 text-slate-800',
    Support: 'bg-rose-100 text-rose-800',
  };
  return map[key] || 'bg-slate-100 text-primary-800';
}

export default function MorePage() {
  const { logout, business } = useAuth();
  const { warehousesEnabled, warehousesSettingLoaded, snapshotLoaded } = useLayoutData();
  const { hasCapability } = useCapabilityCheck();
  const [isSupplier, setIsSupplier] = useState(false);
  const [supplierResolved, setSupplierResolved] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const defaultSectionApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!business?.id) {
      setIsSupplier(false);
      setSupplierResolved(true);
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsSupplier(false);
      setSupplierResolved(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/dashboard?supplier_business_id=${business.id}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setIsSupplier((data.stats?.active_customers || 0) > 0);
        } else if (!cancelled) {
          setIsSupplier(false);
        }
      } catch {
        if (!cancelled) setIsSupplier(false);
      } finally {
        if (!cancelled) setSupplierResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  const menuReady =
    snapshotLoaded && warehousesSettingLoaded && supplierResolved;

  const sections: MoreNavSection[] = useMemo(() => {
    if (!menuReady) return [];
    return buildMoreMenuSections({
      isSupplier,
      warehousesEnabled: !!warehousesEnabled,
      hasCapability,
    });
  }, [menuReady, isSupplier, warehousesEnabled, hasCapability]);

  // Default once: expand Sales (like reference) or first section — do not reset when user collapses all
  useEffect(() => {
    if (!sections.length || defaultSectionApplied.current) return;
    defaultSectionApplied.current = true;
    const preferred = sections.find((s) => s.title === 'Sales');
    setOpenSection(preferred?.title ?? sections[0].title);
  }, [sections]);

  const toggleSection = (title: string) => {
    setOpenSection((prev) => (prev === title ? null : title));
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] pb-stack-section">
      {!menuReady ? (
        <div className="flex flex-col items-center justify-center py-12 gap-stack-tight text-text-muted">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          <p className="text-sm">Loading menu…</p>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold text-text-primary mb-2">My Business</h2>

            <div className="divide-y divide-border border-y border-border">
              {sections.map((section) => {
                const Icon = SECTION_ICONS[section.title] || FileText;
                const iconRound = sectionIconBg(section.title);
                const expanded = openSection === section.title;

                return (
                  <div key={section.title}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.title)}
                      className="w-full flex items-center gap-3 py-2.5 text-left transition-colors active:bg-slate-50/60 dark:active:bg-slate-800/40"
                      aria-expanded={expanded}
                    >
                      <div
                        className={clsx(
                          'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                          iconRound,
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="flex-1 font-semibold text-text-primary text-sm leading-snug">
                        {section.title}
                      </span>
                      {expanded ? (
                        <ChevronUp className="w-4 h-4 text-text-muted shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                      )}
                    </button>

                    {expanded && (
                      <ul className="divide-y divide-border border-t border-border">
                        {section.items.map((item) => (
                          <li key={`${section.title}-${item.href}-${item.label}`}>
                            <Link
                              href={item.href}
                              className="flex items-center justify-between pl-11 pr-0 py-2 active:bg-slate-50/80 dark:active:bg-slate-800/40"
                            >
                              <span className="text-sm leading-snug text-text-primary pr-2">
                                {item.label}
                                {item.isLocked ? (
                                  <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700">
                                    (Upgrade)
                                  </span>
                                ) : null}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0 opacity-60" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="w-full py-2.5 mt-4 bg-rose-50 text-rose-600 font-semibold text-sm rounded-xl border border-rose-100 flex items-center justify-center gap-2 active:bg-rose-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>

          <p className="text-center text-[10px] text-text-muted uppercase tracking-widest mt-4">
            Khatario
          </p>
        </>
      )}
    </div>
  );
}
