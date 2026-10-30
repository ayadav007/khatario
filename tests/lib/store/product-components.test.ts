import {
  clampPan,
  clampScale,
  createScrollLock,
  initialVariantId,
  isDoubleTap,
  pickVariant,
  preselect,
  selectionFromVariant,
  stepIndex,
  swipeDirection,
  valueInStock,
  zoomAt,
} from '@/components/store/features/product/product-logic';
import type { StoreVariantInput } from '@/lib/store/variant-options';

const v = (
  id: string,
  name: string,
  stock: number | string,
  attributes: Record<string, string> | null = null,
): StoreVariantInput => ({ id, variant_name: name, selling_price: '100', current_stock: stock, attributes });

const plain = [v('a', '500 g', 0), v('b', '1 kg', '4'), v('c', '1 kg', 2)];
const shirts = [
  v('r-s', 'Red S', 3, { Color: 'Red', Size: 'S' }),
  v('r-m', 'Red M', 0, { Color: 'Red', Size: 'M' }),
  v('b-s', 'Blue S', 0, { color: 'Blue', size: 'S' }),
  v('b-m', 'Blue M', 5, { color: 'Blue', size: 'M' }),
];

describe('swipeDirection', () => {
  it('needs 40 px of mostly horizontal travel', () => {
    expect(swipeDirection(-41, 5)).toBe(1);
    expect(swipeDirection(60, -10)).toBe(-1);
    expect(swipeDirection(-39, 0)).toBe(0);
    expect(swipeDirection(-50, 80)).toBe(0);
  });
});

describe('stepIndex', () => {
  it('wraps both ways', () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe('zoom helpers', () => {
  it('detects a double tap close in time and place', () => {
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 250, x: 20, y: 15 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 400, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 100, x: 90, y: 10 })).toBe(false);
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
  });

  it('clamps scale and pan', () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(9)).toBe(4);
    expect(clampScale(NaN)).toBe(1);
    expect(clampPan(500, 2, 400)).toBe(200);
    expect(clampPan(-500, 2, 400)).toBe(-200);
    expect(clampPan(50, 1, 400)).toBe(0);
  });

  it('keeps the pinched point still', () => {
    expect(zoomAt({ x: 100, y: 0 }, { scale: 1, x: 0, y: 0 }, 2)).toEqual({ x: -100, y: 0 });
  });
});

describe('variant selection', () => {
  it('reads the option label of plain variants, duplicates included', () => {
    expect(selectionFromVariant(plain, 'c')).toEqual({ option: '1 kg (2)' });
    expect(selectionFromVariant(plain, 'zz')).toEqual({});
    expect(selectionFromVariant(plain, null)).toEqual({});
  });

  it('reads attribute axes with normalised keys', () => {
    expect(selectionFromVariant(shirts, 'b-m')).toEqual({ colour: 'Blue', size: 'M' });
  });

  it('preselects the only or first in-stock variant', () => {
    expect(initialVariantId([v('x', 'x', 0)])).toBe('x');
    expect(initialVariantId(plain)).toBe('b');
    expect(initialVariantId([v('x', 'x', 0), v('y', 'y', 0)])).toBe('x');
    expect(initialVariantId([])).toBeNull();
  });

  it('picks every plain option, out of stock included', () => {
    expect(pickVariant(plain, 'b', 'option', '500 g')).toBe('a');
    expect(pickVariant(plain, 'a', 'option', '1 kg (2)')).toBe('c');
    expect(pickVariant(plain, null, 'option', '1 kg')).toBe('b');
  });

  it('keeps an existing sold-out combination', () => {
    expect(pickVariant(shirts, 'r-s', 'size', 'M')).toBe('r-m');
    expect(pickVariant(shirts, 'r-s', 'colour', 'Blue')).toBe('b-s');
  });

  it('moves the other axis only when the combination does not exist', () => {
    const odd = [...shirts, v('g-l', 'Green L', 0, { colour: 'Green', size: 'L' }), v('g-xl', 'Green XL', 2, { colour: 'Green', size: 'XL' })];
    expect(pickVariant(odd, 'r-s', 'colour', 'Green')).toBe('g-xl');
  });

  it('preselects again for a new variant list only', () => {
    const first = preselect(null, plain, null);
    expect(first).toEqual({ doneKey: 'a|b|c', emit: 'b' });
    expect(preselect(first.doneKey, plain, null).emit).toBeNull();
    const next = preselect(first.doneKey, shirts, null);
    expect(next).toEqual({ doneKey: 'r-s|r-m|b-s|b-m', emit: 'r-s' });
    expect(preselect(null, plain, 'c')).toEqual({ doneKey: 'a|b|c', emit: null });
    expect(preselect(null, [], null)).toEqual({ doneKey: null, emit: null });
  });

  it('judges stock against the other choices', () => {
    expect(valueInStock(shirts, { colour: 'Red', size: 'S' }, 'size', 'M')).toBe(false);
    expect(valueInStock(shirts, { colour: 'Blue', size: 'M' }, 'size', 'M')).toBe(true);
    expect(valueInStock(plain, {}, 'option', '500 g')).toBe(false);
  });
});

describe('createScrollLock', () => {
  it('locks on the first holder and restores after the last', () => {
    let overflow = 'auto';
    const lock = createScrollLock(() => overflow, (o) => {
      overflow = o;
    });
    lock.lock();
    lock.lock();
    expect(overflow).toBe('hidden');
    lock.unlock();
    expect(overflow).toBe('hidden');
    lock.unlock();
    expect(overflow).toBe('auto');
    lock.unlock();
    expect(lock.count).toBe(0);
    expect(overflow).toBe('auto');
  });
});
