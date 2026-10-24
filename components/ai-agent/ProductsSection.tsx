'use client';

import React from 'react';
import Link from 'next/link';
import { ExternalLink, Package } from 'lucide-react';
import { clsx } from 'clsx';
import { Switch } from '@/components/ui/Switch';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { SectionCard } from './SectionCard';

type ShowField = WhatsAppBotUIConfig['productInfo']['showFields'][number];

const FIELDS: Array<{ value: ShowField; label: string }> = [
  { value: 'price', label: 'Price' },
  { value: 'stock', label: 'Stock' },
  { value: 'description', label: 'Description' },
  { value: 'specifications', label: 'Specifications' },
  { value: 'sizes', label: 'Sizes' },
  { value: 'colors', label: 'Colours' },
  { value: 'dimensions', label: 'Dimensions' },
  { value: 'ingredients', label: 'Ingredients' },
  { value: 'warranty', label: 'Warranty' },
];

export function ProductsSection({
  behavior,
  onChange,
  catalogItems,
}: {
  behavior: WhatsAppBotUIConfig;
  onChange: (b: WhatsAppBotUIConfig) => void;
  catalogItems: number | null;
}) {
  const p = behavior.productInfo;
  const setProduct = (patch: Partial<WhatsAppBotUIConfig['productInfo']>) =>
    onChange({ ...behavior, productInfo: { ...p, ...patch } });
  const promo = behavior.promotions;
  const setPromo = (patch: Partial<WhatsAppBotUIConfig['promotions']>) =>
    onChange({ ...behavior, promotions: { ...promo, ...patch } });
  const cx = behavior.customerExperience;
  const setCx = (patch: Partial<WhatsAppBotUIConfig['customerExperience']>) =>
    onChange({ ...behavior, customerExperience: { ...cx, ...patch } });

  const toggleField = (f: ShowField) =>
    setProduct({ showFields: p.showFields.includes(f) ? p.showFields.filter((x) => x !== f) : [...p.showFields, f] });

  return (
    <SectionCard id="products" icon={Package} title="Products" description="Which product details the agent shares, and offers.">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3 dark:bg-slate-800/50">
          <p className="text-sm text-text-primary">
            {catalogItems == null
              ? 'Your items are read from the catalogue automatically.'
              : catalogItems === 0
                ? 'No items are visible to the agent yet.'
                : `${catalogItems.toLocaleString('en-IN')} items visible to the agent.`}
          </p>
          <Link href="/items" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline">
            Manage items <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text-primary">Details to share</p>
          <div className="flex flex-wrap gap-2">
            {FIELDS.map((f) => {
              const on = p.showFields.includes(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleField(f.value)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    on
                      ? 'border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
                      : 'border-border text-text-secondary hover:border-primary-400',
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <Switch
            checked={p.showOutOfStock}
            onChange={(v) => setProduct({ showOutOfStock: v })}
            label="Mention out-of-stock items"
            description="When off, the agent suggests an available alternative instead."
          />
          <Switch
            checked={p.highlightBestSellers}
            onChange={(v) => setProduct({ highlightBestSellers: v })}
            label="Highlight best sellers"
            description="Recommend popular items when the customer is unsure."
          />
          <Switch
            checked={cx.enableUpselling}
            onChange={(v) => setCx({ enableUpselling: v })}
            label="Suggest related products"
            description="Offer one complementary item after the customer picks something."
          />
          {cx.enableUpselling && (
            <div className="ml-1 flex items-center gap-2 text-sm text-text-secondary">
              How often
              <select
                className="input h-9 w-40 py-1"
                value={cx.upsellingStyle}
                onChange={(e) => setCx({ upsellingStyle: e.target.value as typeof cx.upsellingStyle })}
              >
                <option value="subtle">Now and then</option>
                <option value="moderate">Often</option>
                <option value="aggressive">Every order</option>
              </select>
            </div>
          )}
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <p className="text-sm font-medium text-text-primary">Offers</p>
          <Switch
            checked={promo.autoMentionActiveOffers}
            onChange={(v) => setPromo({ autoMentionActiveOffers: v })}
            label="Mention active offers"
            description="Bring up a relevant discount when it fits the conversation."
          />
          <Switch
            checked={promo.showExpiryDates}
            onChange={(v) => setPromo({ showExpiryDates: v })}
            label="Say when an offer ends"
          />
        </div>
      </div>
    </SectionCard>
  );
}
