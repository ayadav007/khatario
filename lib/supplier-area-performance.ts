export type CustomerAreaFact = {
  state: string;
  city: string;
  pincode: string;
  sellIn: number;
  sellThrough: number;
  lowStockItems: number;
};

export type AreaPerformance = {
  state: string;
  city: string;
  pincode: string;
  label: string;
  customerCount: number;
  sellIn: number;
  sellThrough: number;
  lowStockItems: number;
  /** strong = buying and selling, watch = mixed or stock not moving, weak = low activity, quiet = no bills */
  band: 'strong' | 'watch' | 'weak' | 'quiet';
};

export type AreaLevel = 'state' | 'city' | 'pincode';

function clean(value: string | null | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function groupKey(fact: CustomerAreaFact, level: AreaLevel): string {
  if (level === 'state') return clean(fact.state);
  if (level === 'city') return `${clean(fact.city)}|${clean(fact.state)}`;
  return `${clean(fact.pincode)}|${clean(fact.city)}|${clean(fact.state)}`;
}

function labelFor(fact: CustomerAreaFact, level: AreaLevel): string {
  if (level === 'state') return clean(fact.state);
  if (level === 'city') return `${clean(fact.city)}, ${clean(fact.state)}`;
  return `${clean(fact.pincode)} · ${clean(fact.city)}, ${clean(fact.state)}`;
}

export function aggregateAreas(facts: CustomerAreaFact[], level: AreaLevel): AreaPerformance[] {
  const groups = new Map<string, AreaPerformance>();
  for (const fact of facts) {
    const key = groupKey(fact, level);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        state: clean(fact.state),
        city: level === 'state' ? '' : clean(fact.city),
        pincode: level === 'pincode' ? clean(fact.pincode) : '',
        label: labelFor(fact, level),
        customerCount: 1,
        sellIn: fact.sellIn,
        sellThrough: fact.sellThrough,
        lowStockItems: fact.lowStockItems,
        band: 'quiet',
      });
      continue;
    }
    existing.customerCount += 1;
    existing.sellIn += fact.sellIn;
    existing.sellThrough += fact.sellThrough;
    existing.lowStockItems += fact.lowStockItems;
  }
  return assignBands([...groups.values()]);
}

export function assignBands(rows: AreaPerformance[]): AreaPerformance[] {
  const active = rows.filter((row) => row.sellIn > 0 || row.sellThrough > 0);
  const scores = active
    .map((row) => row.sellThrough * 0.6 + row.sellIn * 0.4)
    .sort((a, b) => a - b);
  const lowCut = scores.length ? scores[Math.floor((scores.length - 1) * 0.33)] : 0;
  const highCut = scores.length ? scores[Math.floor((scores.length - 1) * 0.66)] : 0;

  return rows
    .map((row) => {
      if (row.sellIn <= 0 && row.sellThrough <= 0) return { ...row, band: 'quiet' as const };
      if (row.sellIn > 0 && row.sellThrough < row.sellIn * 0.25) return { ...row, band: 'watch' as const };
      const score = row.sellThrough * 0.6 + row.sellIn * 0.4;
      if (active.length === 1 || score >= highCut) return { ...row, band: 'strong' as const };
      if (score <= lowCut) return { ...row, band: 'weak' as const };
      return { ...row, band: 'watch' as const };
    })
    .sort((a, b) => b.sellThrough - a.sellThrough || b.sellIn - a.sellIn || a.label.localeCompare(b.label));
}

export type ItemAreaAmount = { state: string; itemName: string; sellThrough: number };

export function topItemPivot(rows: ItemAreaAmount[], itemLimit = 6) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = row.itemName.trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + row.sellThrough);
  }
  const items = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, itemLimit)
    .map(([name]) => name);

  const byState = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const name = row.itemName.trim();
    if (!items.includes(name)) continue;
    const state = clean(row.state);
    const cell = byState.get(state) || {};
    cell[name] = (cell[name] || 0) + row.sellThrough;
    byState.set(state, cell);
  }

  const matrix = [...byState.entries()]
    .map(([state, cells]) => ({
      state,
      cells,
      total: items.reduce((sum, name) => sum + (cells[name] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total || a.state.localeCompare(b.state));

  return { items, matrix };
}
