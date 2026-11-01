import { insertionPoints } from '@/lib/store/engine/editor/overlay';

describe('insertionPoints', () => {
  it('puts a point before the first, between each pair and after the last template section', () => {
    // Order indexes skip 1 (a hidden section): inserting before the third rendered one is index 3.
    const out = insertionPoints(
      [
        { index: 0, top: 100, bottom: 300 },
        { index: 2, top: 300, bottom: 500 },
        { index: 3, top: 520, bottom: 700 },
      ],
      0,
    );
    expect(out).toEqual([
      { index: 0, y: 100 },
      { index: 2, y: 300 },
      { index: 3, y: 510 },
      { index: 4, y: 700 },
    ]);
  });

  it('offers one point at the top of the template when nothing renders', () => {
    expect(insertionPoints([], 80)).toEqual([{ index: 0, y: 80 }]);
  });
});
