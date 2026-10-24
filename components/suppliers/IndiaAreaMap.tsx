'use client';

import type { AreaPerformance } from '@/lib/supplier-area-performance';

const STATE_POINTS: Record<string, [number, number]> = {
  'jammu and kashmir': [34.1, 76.3],
  ladakh: [34.2, 77.6],
  'himachal pradesh': [31.8, 77.2],
  punjab: [31.0, 75.3],
  uttarakhand: [30.1, 79.2],
  haryana: [29.2, 76.4],
  delhi: [28.6, 77.2],
  rajasthan: [26.6, 73.8],
  'uttar pradesh': [27.0, 80.8],
  bihar: [25.6, 85.3],
  sikkim: [27.5, 88.5],
  'arunachal pradesh': [28.2, 94.2],
  nagaland: [26.1, 94.5],
  manipur: [24.7, 93.9],
  mizoram: [23.3, 92.8],
  tripura: [23.8, 91.6],
  meghalaya: [25.5, 91.3],
  assam: [26.2, 92.6],
  'west bengal': [23.4, 87.8],
  jharkhand: [23.6, 85.3],
  odisha: [20.5, 84.4],
  chhattisgarh: [21.3, 82.0],
  'madhya pradesh': [23.5, 78.4],
  gujarat: [22.4, 71.2],
  maharashtra: [19.3, 76.2],
  goa: [15.4, 74.0],
  karnataka: [14.7, 75.9],
  kerala: [10.5, 76.4],
  'tamil nadu': [11.1, 78.4],
  telangana: [17.9, 79.2],
  'andhra pradesh': [15.9, 79.8],
};

function project(lat: number, lon: number) {
  const x = ((lon - 68) / (97.5 - 68)) * 340 + 16;
  const y = ((37.2 - lat) / (37.2 - 6.5)) * 460 + 12;
  return { x, y };
}

const INDIA_OUTLINE: [number, number][] = [
  [23.7, 68.2],
  [21.0, 72.6],
  [18.9, 72.8],
  [15.5, 73.2],
  [12.8, 74.8],
  [9.9, 76.3],
  [8.1, 77.5],
  [13.0, 80.2],
  [15.8, 80.3],
  [17.7, 83.3],
  [19.8, 85.1],
  [21.5, 87.0],
  [22.3, 88.3],
  [26.5, 88.6],
  [26.2, 91.8],
  [27.6, 94.2],
  [28.0, 97.0],
  [26.8, 95.2],
  [26.2, 92.2],
  [27.2, 88.1],
  [27.6, 84.0],
  [30.6, 80.0],
  [32.6, 77.0],
  [34.6, 74.4],
  [32.2, 73.2],
  [27.2, 71.5],
  [24.2, 69.6],
];

function statePoint(name: string): [number, number] | undefined {
  const key = name.trim().toLowerCase();
  const aliases: Record<string, string> = {
    orissa: 'odisha',
    pondicherry: 'puducherry',
    'jammu & kashmir': 'jammu and kashmir',
    tamilnadu: 'tamil nadu',
  };
  return STATE_POINTS[aliases[key] || key];
}

const BAND_FILL: Record<AreaPerformance['band'], string> = {
  strong: '#15803d',
  watch: '#b45309',
  weak: '#b91c1c',
  quiet: '#94a3b8',
};

export function IndiaAreaMap({
  states,
  onSelect,
}: {
  states: AreaPerformance[];
  onSelect?: (state: string) => void;
}) {
  const placed = states
    .map((area) => {
      const point = statePoint(area.state);
      if (!point) return null;
      const { x, y } = project(point[0], point[1]);
      const scale = Math.min(22, 8 + Math.sqrt(Math.max(area.sellThrough, area.sellIn) / 5000));
      return { area, x, y, r: area.band === 'quiet' ? 6 : scale };
    })
    .filter((dot): dot is NonNullable<typeof dot> => !!dot);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox="0 0 372 490" className="w-full max-w-xl mx-auto h-auto" role="img" aria-label="India map of customer areas">
        <rect x="0" y="0" width="372" height="490" rx="16" fill="#f8fafc" />
        <polygon
          points={INDIA_OUTLINE.map(([lat, lon]) => {
            const { x, y } = project(lat, lon);
            return `${x},${y}`;
          }).join(' ')}
          fill="#e2e8f0"
          stroke="#cbd5e1"
        />
        <text x="16" y="28" fontSize="12" fill="#64748b">North</text>
        {placed.map(({ area, x, y, r }) => (
          <g key={area.state} onClick={() => onSelect?.(area.state)} className="cursor-pointer">
            <circle cx={x} cy={y} r={r} fill={BAND_FILL[area.band]} fillOpacity="0.9" />
            <text x={x + r + 4} y={y + 4} fontSize="10" fill="#0f172a">
              {area.state}
            </text>
          </g>
        ))}
        {placed.length === 0 && (
          <text x="186" y="245" textAnchor="middle" fontSize="13" fill="#64748b">
            No mapped states yet
          </text>
        )}
      </svg>
    </div>
  );
}
