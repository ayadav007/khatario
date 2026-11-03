'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { engineProductHref } from '@/lib/store/engine/links';
import type { StudioSettings } from '@/lib/store/studio-sections';
import { StoreProductCard, type StoreProduct } from '../../StoreProductCard';
import { StudioProductsSection } from '../../studio-theme/StudioSections';

type BuyAgainProduct = StoreProduct & { buy_again_variant_id: string | null };

/** Studio 2 editor mode: the shell carries `eng-editor` (sections are server components with no editor prop). */
function useEngineEditor(): boolean {
  const [editor, setEditor] = useState(false);
  useEffect(() => setEditor(!!document.querySelector('.eng-root.eng-editor')), []);
  return editor;
}

/**
 * The signed-in shopper's own past products, fetched after mount (nothing is drawn until there are some). Each card
 * starts on the pack ordered before. The rail scrolls on phones and shows up to six across on computers.
 */
export function BuyAgainProducts({
  subdomain,
  demo,
  heading,
  maxItems,
  rail,
}: {
  subdomain: string;
  demo: boolean;
  heading: string;
  maxItems: number;
  rail: boolean;
}) {
  const { customer, selectedBranchId } = useStore();
  const router = useRouter();
  const editor = useEngineEditor();
  const [items, setItems] = useState<BuyAgainProduct[]>([]);
  const customerId = customer?.id ?? null;

  useEffect(() => {
    // Only a signed-in shopper has orders to show; a demo store shows its sample list to everyone.
    if (!customerId && !demo) {
      setItems([]);
      return;
    }
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    let cancelled = false;
    void fetch(`/api/public/store/${encodeURIComponent(subdomain)}/buy-again?${withStoreDraft(params)}`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data?.items) ? (data.items as BuyAgainProduct[]) : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subdomain, demo, customerId, selectedBranchId]);

  const shown = items.slice(0, maxItems);
  if (!shown.length) {
    return editor ? (
      <p className="py-4 text-center text-[13px]" style={{ opacity: 0.6 }} data-eng-placeholder>
        Buy again shows a signed-in shopper&apos;s past orders.
      </p>
    ) : null;
  }

  const s: StudioSettings = {
    title: heading,
    eyebrow: '',
    display: rail ? 'carousel' : 'grid',
    columns: rail ? 6 : 4,
    spacingTop: 0,
    spacingBottom: 0,
  };
  return (
    <StudioProductsSection s={s} action={null} gridClassName={rail ? 'isRow' : undefined}>
      {shown.map((item) => (
        <StoreProductCard
          key={`${item.id}:${item.buy_again_variant_id ?? ''}`}
          product={item}
          initialPackId={item.buy_again_variant_id}
          onViewDetail={(p) => router.push(engineProductHref(window.location.search, p.id))}
        />
      ))}
    </StudioProductsSection>
  );
}
