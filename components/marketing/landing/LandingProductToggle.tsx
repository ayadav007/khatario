'use client';

import { clsx } from 'clsx';
import { Calculator, MessageSquare, UserCheck } from 'lucide-react';
import { PRODUCT_LINE_LABELS, type ProductLine } from '@/lib/product-lines';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';

const OPTIONS: { id: ProductLine; icon: typeof Calculator }[] = [
  { id: 'billing', icon: Calculator },
  { id: 'hr', icon: UserCheck },
  { id: 'connect', icon: MessageSquare },
];

export function LandingProductToggle({
  className,
  label = 'Choose a Khatario product',
}: {
  className?: string;
  label?: string;
}) {
  const { productLine, setProductLine } = useLandingProduct();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm',
        className,
      )}
    >
      {OPTIONS.map(({ id, icon: Icon }) => {
        const selected = productLine === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setProductLine(id)}
            className={clsx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition sm:px-4',
              selected
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {PRODUCT_LINE_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
