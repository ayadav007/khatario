import { issueUnitCost, replayItem, type Movement } from '@/lib/inventory/fifo-engine';

let n = 0;
const mv = (m: Partial<Movement> & Pick<Movement, 'kind' | 'docId' | 'qty'>): Movement => {
  n += 1;
  return {
    key: `${m.kind}:${m.docId}`,
    date: '2026-10-01',
    seq: String(n).padStart(4, '0'),
    ...m,
  } as Movement;
};
const cost = (r: ReturnType<typeof replayItem>, key: string) => Math.round(r.results.get(key)!.cost * 100) / 100;

describe('FIFO engine', () => {
  beforeEach(() => {
    n = 0;
  });

  it('Zoho documentation example: opening 20 @ 10 + bill 10 @ 12, sell 25 → 260', () => {
    const r = replayItem(
      [
        mv({ kind: 'opening', docId: 'item', qty: 20, unitCost: 10, date: '0001-01-01' }),
        mv({ kind: 'purchase', docId: 'b1', qty: 10, unitCost: 12 }),
        mv({ kind: 'invoice', docId: 'i1', qty: 25 }),
      ],
      0
    );
    expect(cost(r, 'invoice:i1')).toBe(260);
    expect(r.openQty).toBe(5);
    expect(Math.round(r.openValue * 100) / 100).toBe(60);
  });

  it('QA org scenario: INV-000004 crosses two lots (10 × 100 + 2 × 150)', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 10, unitCost: 100 }),
        mv({ kind: 'purchase', docId: 'p2', qty: 10, unitCost: 150 }),
        mv({ kind: 'invoice', docId: 'inv4', qty: 12 }),
        mv({ kind: 'invoice', docId: 'inv5', qty: 2 }),
      ],
      0
    );
    expect(cost(r, 'invoice:inv4')).toBe(1300);
    expect(cost(r, 'invoice:inv5')).toBe(300);
  });

  it('orders by document date, not entry order (backdated bill)', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'late', qty: 5, unitCost: 200, date: '2026-10-05' }),
        mv({ kind: 'invoice', docId: 'i1', qty: 5, date: '2026-10-06' }),
        mv({ kind: 'purchase', docId: 'early', qty: 5, unitCost: 100, date: '2026-10-02' }),
      ],
      0
    );
    expect(cost(r, 'invoice:i1')).toBe(500);
  });

  it('negative stock is settled by the next inward lot at that lot’s cost', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 2, unitCost: 100 }),
        mv({ kind: 'invoice', docId: 'i1', qty: 5 }),
        mv({ kind: 'purchase', docId: 'p2', qty: 10, unitCost: 120, date: '2026-10-03' }),
      ],
      0
    );
    expect(cost(r, 'invoice:i1')).toBe(2 * 100 + 3 * 120);
    expect(r.deficitQty).toBe(0);
    expect(r.openQty).toBe(7);
  });

  it('unsettled negative stock keeps the last inward cost, then the fallback rate', () => {
    const withLot = replayItem(
      [mv({ kind: 'purchase', docId: 'p1', qty: 1, unitCost: 90 }), mv({ kind: 'invoice', docId: 'i1', qty: 3 })],
      50
    );
    expect(cost(withLot, 'invoice:i1')).toBe(270);
    expect(withLot.deficitQty).toBe(2);

    const noLot = replayItem([mv({ kind: 'invoice', docId: 'i2', qty: 2 })], 50);
    expect(cost(noLot, 'invoice:i2')).toBe(100);
  });

  it('credit note comes back at the cost its invoice took out', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 10, unitCost: 100 }),
        mv({ kind: 'purchase', docId: 'p2', qty: 10, unitCost: 150 }),
        mv({ kind: 'invoice', docId: 'inv', qty: 12 }),
        mv({ kind: 'credit_note', docId: 'cn', qty: 3, linkedDocId: 'inv' }),
      ],
      0
    );
    expect(cost(r, 'credit_note:cn')).toBe(325);
    expect(r.openQty).toBe(11);
  });

  it('purchase return consumes its own bill’s lot before older lots', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 10, unitCost: 100 }),
        mv({ kind: 'purchase', docId: 'p2', qty: 10, unitCost: 150 }),
        mv({ kind: 'purchase_return', docId: 'pr', qty: 4, linkedDocId: 'p2' }),
        mv({ kind: 'invoice', docId: 'inv', qty: 10 }),
      ],
      0
    );
    expect(cost(r, 'purchase_return:pr')).toBe(600);
    expect(cost(r, 'invoice:inv')).toBe(1000);
  });

  it('quantity adjustments consume and open lots', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 5, unitCost: 100 }),
        mv({ kind: 'adjustment_out', docId: 'a1', qty: 2 }),
        mv({ kind: 'adjustment_in', docId: 'a2', qty: 1, unitCost: 80 }),
        mv({ kind: 'invoice', docId: 'inv', qty: 4 }),
      ],
      0
    );
    expect(cost(r, 'adjustment_out:a1')).toBe(200);
    expect(cost(r, 'invoice:inv')).toBe(380);
  });

  it('value adjustment spreads over open lots only', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 4, unitCost: 100 }),
        mv({ kind: 'invoice', docId: 'i1', qty: 2 }),
        mv({ kind: 'value_adjustment', docId: 'v1', qty: 0, value: 40 }),
        mv({ kind: 'invoice', docId: 'i2', qty: 2 }),
      ],
      0
    );
    expect(cost(r, 'invoice:i1')).toBe(200);
    expect(cost(r, 'invoice:i2')).toBe(240);
  });

  it('peek costs an issue without consuming lots', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 5, unitCost: 100 }),
        mv({ kind: 'invoice', docId: 'transfer', qty: 3, peek: true }),
        mv({ kind: 'invoice', docId: 'sale', qty: 5 }),
      ],
      0
    );
    expect(cost(r, 'invoice:transfer')).toBe(300);
    expect(cost(r, 'invoice:sale')).toBe(500);
  });

  it('issueUnitCost peeks at the next units out', () => {
    const r = replayItem(
      [
        mv({ kind: 'purchase', docId: 'p1', qty: 1, unitCost: 100 }),
        mv({ kind: 'purchase', docId: 'p2', qty: 1, unitCost: 200 }),
      ],
      0
    );
    expect(issueUnitCost(r, 0, 1)).toBe(100);
    expect(issueUnitCost(r, 0, 2)).toBe(150);
    expect(issueUnitCost(r, 0, 3)).toBeCloseTo((100 + 200 + 200) / 3, 6);
  });
});
