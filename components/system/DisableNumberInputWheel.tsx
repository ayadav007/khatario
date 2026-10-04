'use client';

import { useEffect } from 'react';

function isFocusedNumberInput(target: EventTarget | null): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement &&
    target.type === 'number' &&
    document.activeElement === target
  );
}

/**
 * Browsers increment/decrement focused `type="number"` inputs on mouse-wheel.
 * That accidentally corrupts amounts, qty, rates, etc. while scrolling forms.
 * Block the default and blur so the next wheel events scroll the page normally.
 */
export function DisableNumberInputWheel() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!isFocusedNumberInput(event.target)) return;
      event.preventDefault();
      event.target.blur();
    };

    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);

  return null;
}
