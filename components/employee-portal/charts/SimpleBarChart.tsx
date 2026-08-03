'use client';

type BarItem = { label: string; value: number };

type SimpleBarChartProps = {
  title: string;
  items: BarItem[];
  barClass?: string;
};

export function SimpleBarChart({
  title,
  items,
  barClass = 'bg-primary-600',
}: SimpleBarChartProps) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3>
      <div className="flex h-36 items-end justify-between gap-1">
        {items.map((item) => (
          <div key={item.label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full max-w-[28px] rounded-t ${barClass}`}
              style={{ height: `${Math.max(4, (item.value / max) * 100)}%` }}
              title={`${item.value}`}
            />
            <span className="text-[9px] text-text-muted">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBarChart({ title, items }: SimpleBarChartProps) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-0.5 flex justify-between text-xs">
              <span className="text-text-secondary">{item.label}</span>
              <span className="font-medium text-text-primary">{item.value}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-primary-600"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
