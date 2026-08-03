'use client';

type DonutStatProps = {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  colorClass?: string;
};

const COLORS = ['#7c3aed', '#e11d48', '#65a30d', '#2563eb', '#d97706'];

export function DonutStat({
  value,
  max,
  label,
  sublabel,
  colorClass = 'text-primary-600',
}: DonutStatProps) {
  const safeMax = max > 0 ? max : Math.max(value, 1);
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center rounded-lg border border-border bg-white p-4">
      <div className="relative h-28 w-28">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            className={colorClass}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-bold text-gray-900">{value}</span>
          <span className="text-[10px] text-text-muted">Days</span>
        </div>
      </div>
      <p className="mt-2 text-center text-sm font-semibold text-text-primary">{label}</p>
      {sublabel ? <p className="text-center text-xs text-text-secondary">{sublabel}</p> : null}
    </div>
  );
}

export function donutColor(index: number): string {
  return COLORS[index % COLORS.length];
}

export function DonutStatWithHex({
  value,
  max,
  label,
  sublabel,
  stroke,
}: DonutStatProps & { stroke: string }) {
  const safeMax = max > 0 ? max : Math.max(value, 1);
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 shrink-0">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={stroke}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold text-gray-900">{value}</span>
            <span className="text-[9px] text-text-muted">available</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-primary">{label}</p>
          {sublabel ? <p className="text-xs text-text-secondary">{sublabel}</p> : null}
        </div>
      </div>
    </div>
  );
}
