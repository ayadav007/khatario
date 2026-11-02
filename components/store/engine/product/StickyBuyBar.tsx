'use client';

import { useEffect, useState } from 'react';
import { BTN, BuyStepper, inr, useBuyState } from './buy-action';
import { stickyBuyBarVisible, variantSizeLabel } from './product-blocks';

const PHONE_QUERY = '(max-width: 767px)';

/** The block's element on the page, found by the id every product block carries in `data-eng-block`. */
function blockElement(id: string | null): Element | null {
  if (!id) return null;
  return Array.from(document.querySelectorAll('[data-eng-block]')).find((el) => el.getAttribute('data-eng-block') === id) ?? null;
}

/**
 * Phone "Add to bag" bar, fixed at the bottom while the page's own buy buttons are out of view. It shows the chosen size
 * (or "Select size", which scrolls to the Options block), the price and the same add or choose action as the Buy buttons
 * block. While shown it sets `body[data-eng-buy-bar="on"]`, which hides the phone kit's cart bar (quick-theme.css).
 */
export function StickyBuyBar({ buyBlockId, optionsBlockId }: { buyBlockId: string | null; optionsBlockId: string | null }) {
  const buy = useBuyState();
  const [phone, setPhone] = useState(false);
  // Starts "in view" so the bar does not flash at the top of the page before the observer reports.
  const [buyInView, setBuyInView] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = blockElement(buyBlockId);
    // No buy block on the page (or no observer support): nothing else to buy with, so the bar stays.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setBuyInView(false);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setBuyInView(last.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [buyBlockId, buy != null]);

  const visible = stickyBuyBarVisible({ enabled: true, phone, buyInView, hasProduct: buy != null });
  useEffect(() => {
    if (!visible) return;
    document.body.dataset.engBuyBar = 'on';
    return () => {
      delete document.body.dataset.engBuyBar;
    };
  }, [visible]);

  if (!buy || !visible) return null;
  const { offer, needsVariant, variant, state, quantity, add, setQuantity } = buy;
  const pickSize = state === 'choose' && needsVariant && variant == null;
  const scrollToOptions = () => {
    (blockElement(optionsBlockId) ?? blockElement(buyBlockId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div
      className="eng-buybar"
      role="region"
      aria-label="Add to bag"
      style={{
        background: 'var(--c-bg, var(--st-bg, #fff))',
        color: 'var(--c-text, var(--text, inherit))',
        borderColor: 'var(--c-border, var(--st-line, rgba(0,0,0,.12)))',
      }}
    >
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-base font-bold tabular-nums">{inr(offer.price)}</p>
        {needsVariant && variant ? <p className="truncate text-xs opacity-70">{variantSizeLabel(variant)}</p> : null}
      </div>
      {state === 'stepper' ? (
        <BuyStepper quantity={quantity} stock={offer.stock} onChange={setQuantity} />
      ) : pickSize ? (
        <button type="button" onClick={scrollToOptions} className="min-h-12 shrink-0 px-6 text-sm font-semibold" style={BTN}>
          Select size
        </button>
      ) : (
        <button
          type="button"
          disabled={state !== 'add'}
          onClick={add}
          className={
            state === 'add'
              ? 'min-h-12 shrink-0 px-6 text-sm font-semibold'
              : 'min-h-12 shrink-0 cursor-not-allowed bg-gray-200 px-6 text-sm font-semibold text-gray-500'
          }
          style={state === 'add' ? BTN : { borderRadius: BTN.borderRadius }}
        >
          {state === 'sold_out' ? 'Out of stock' : state === 'add' ? 'Add to bag' : 'Choose an option'}
        </button>
      )}
    </div>
  );
}
