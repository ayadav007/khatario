/**
 * FIFO cost-lot engine (pure, no I/O). Replays one item's stock movements in date order:
 * inward movements open cost lots, outward movements consume the oldest open lots.
 * Selling without stock leaves a deficit that the next inward lot settles at its own cost;
 * a deficit never settled keeps a provisional rate (last inward cost, else the item fallback).
 */

export type MovementKind =
  | 'opening'
  | 'purchase'
  | 'credit_note'
  | 'adjustment_in'
  | 'invoice'
  | 'purchase_return'
  | 'adjustment_out'
  | 'value_adjustment';

export interface Movement {
  /** Unique per movement, e.g. `invoice:<id>` or `purchase:<id>:<line>`. */
  key: string;
  kind: MovementKind;
  docId: string;
  docNumber?: string | null;
  party?: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** Tie-breaker within a date (creation timestamp). */
  seq: string;
  qty: number;
  /** Fixed cost of an inward lot (opening, purchase, positive adjustment). */
  unitCost?: number | null;
  /** value_adjustment only: signed amount spread over open lots. */
  value?: number;
  /** Cost the issue without consuming lots (inter-branch transfer invoice). */
  peek?: boolean;
  /** Credit note → invoice id; purchase return → purchase id. */
  linkedDocId?: string | null;
}

export interface Allocation {
  lotKey: string | null;
  qty: number;
  unitCost: number;
  /** True while the quantity is not yet matched to a lot (negative stock). */
  pending?: boolean;
}

export interface MovementResult {
  key: string;
  kind: MovementKind;
  docId: string;
  qty: number;
  cost: number;
  allocations: Allocation[];
}

export interface Lot {
  key: string;
  kind: MovementKind;
  docId: string;
  docNumber: string | null;
  party: string | null;
  date: string;
  qty: number;
  remaining: number;
  unitCost: number;
}

export interface ItemReplay {
  lots: Lot[];
  results: Map<string, MovementResult>;
  openQty: number;
  openValue: number;
  /** Quantity sold without stock and not yet matched to any lot. */
  deficitQty: number;
}

const EPS = 1e-9;

const KIND_RANK: Record<MovementKind, number> = {
  opening: 0,
  purchase: 1,
  credit_note: 1,
  adjustment_in: 1,
  value_adjustment: 1,
  invoice: 2,
  purchase_return: 2,
  adjustment_out: 2,
};

const INWARD = new Set<MovementKind>(['opening', 'purchase', 'credit_note', 'adjustment_in']);

export function isInward(kind: MovementKind): boolean {
  return INWARD.has(kind);
}

export function compareMovements(a: Movement, b: Movement): number {
  if (a.kind === 'opening' || b.kind === 'opening') {
    if (a.kind !== b.kind) return a.kind === 'opening' ? -1 : 1;
  }
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function sumCost(allocs: Allocation[]): number {
  return allocs.reduce((s, a) => s + a.qty * a.unitCost, 0);
}

/**
 * @param fallbackRate unit cost used before any lot exists (opening rate, else item purchase price).
 */
export function replayItem(movements: Movement[], fallbackRate: number): ItemReplay {
  const ordered = [...movements].sort(compareMovements);
  const lots: Lot[] = [];
  const results = new Map<string, MovementResult>();
  const deficits: Array<{ resultKey: string; alloc: Allocation }> = [];
  let lastInwardCost: number | null = null;
  let lastIssueCost: number | null = null;

  const provisionalRate = () => lastInwardCost ?? fallbackRate;

  const take = (lot: Lot, want: number, consume: boolean): Allocation | null => {
    const q = Math.min(lot.remaining, want);
    if (q <= EPS) return null;
    if (consume) lot.remaining -= q;
    return { lotKey: lot.key, qty: q, unitCost: lot.unitCost };
  };

  for (const m of ordered) {
    const qty = Number(m.qty) || 0;

    if (m.kind === 'value_adjustment') {
      const open = lots.filter((l) => l.remaining > EPS);
      const openQty = open.reduce((s, l) => s + l.remaining, 0);
      const value = Number(m.value) || 0;
      if (openQty > EPS && value !== 0) {
        const perUnit = value / openQty;
        for (const l of open) l.unitCost = Math.max(0, l.unitCost + perUnit);
      }
      results.set(m.key, { key: m.key, kind: m.kind, docId: m.docId, qty: 0, cost: value, allocations: [] });
      continue;
    }

    if (qty <= EPS) continue;

    if (isInward(m.kind)) {
      let unitCost: number;
      if (m.kind === 'credit_note') {
        const origin = m.linkedDocId ? results.get(`invoice:${m.linkedDocId}`) : undefined;
        unitCost =
          origin && origin.qty > EPS
            ? sumCost(origin.allocations) / origin.qty
            : lastIssueCost ?? provisionalRate();
      } else {
        unitCost = m.unitCost != null && Number.isFinite(Number(m.unitCost)) ? Number(m.unitCost) : provisionalRate();
      }
      const lot: Lot = {
        key: m.key,
        kind: m.kind,
        docId: m.docId,
        docNumber: m.docNumber ?? null,
        party: m.party ?? null,
        date: m.date,
        qty,
        remaining: qty,
        unitCost,
      };
      lots.push(lot);
      while (deficits.length > 0 && lot.remaining > EPS) {
        const d = deficits[0];
        const q = Math.min(d.alloc.qty, lot.remaining);
        lot.remaining -= q;
        d.alloc.qty -= q;
        results.get(d.resultKey)!.allocations.push({ lotKey: lot.key, qty: q, unitCost: lot.unitCost });
        if (d.alloc.qty <= EPS) {
          const r = results.get(d.resultKey)!;
          r.allocations = r.allocations.filter((a) => a !== d.alloc);
          deficits.shift();
        }
      }
      results.set(m.key, { key: m.key, kind: m.kind, docId: m.docId, qty, cost: qty * unitCost, allocations: [] });
      lastInwardCost = unitCost;
      continue;
    }

    const consume = !m.peek;
    const allocations: Allocation[] = [];
    let want = qty;
    if (m.kind === 'purchase_return' && m.linkedDocId) {
      for (const lot of lots) {
        if (want <= EPS) break;
        if (lot.kind !== 'purchase' || lot.docId !== m.linkedDocId) continue;
        const a = take(lot, want, consume);
        if (a) {
          allocations.push(a);
          want -= a.qty;
        }
      }
    }
    for (const lot of lots) {
      if (want <= EPS) break;
      const a = take(lot, want, consume);
      if (a) {
        allocations.push(a);
        want -= a.qty;
      }
    }
    const result: MovementResult = { key: m.key, kind: m.kind, docId: m.docId, qty, cost: 0, allocations };
    results.set(m.key, result);
    if (want > EPS) {
      const alloc: Allocation = { lotKey: null, qty: want, unitCost: provisionalRate(), pending: true };
      allocations.push(alloc);
      if (consume) deficits.push({ resultKey: m.key, alloc });
    }
    lastIssueCost = sumCost(allocations) / qty;
  }

  for (const r of results.values()) {
    if (r.kind !== 'value_adjustment' && !isInward(r.kind)) r.cost = sumCost(r.allocations);
  }

  const openQty = lots.reduce((s, l) => s + Math.max(0, l.remaining), 0);
  const openValue = lots.reduce((s, l) => s + Math.max(0, l.remaining) * l.unitCost, 0);
  const deficitQty = deficits.reduce((s, d) => s + d.alloc.qty, 0);
  return { lots, results, openQty, openValue, deficitQty };
}

/** Unit cost of the next `qty` units out (peek, nothing consumed). */
export function issueUnitCost(replay: ItemReplay, fallbackRate: number, qty = 1): number {
  let want = qty;
  let cost = 0;
  let last: number | null = null;
  for (const l of replay.lots) {
    last = l.unitCost;
    if (want <= EPS) break;
    const q = Math.min(l.remaining, want);
    if (q > EPS) {
      cost += q * l.unitCost;
      want -= q;
    }
  }
  if (want > EPS) cost += want * (last ?? fallbackRate);
  return qty > 0 ? cost / qty : 0;
}
