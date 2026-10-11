'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { IndiaAreaMap } from '@/components/suppliers/IndiaAreaMap';
import type { AreaPerformance } from '@/lib/supplier-area-performance';

type PeriodKey = '30d' | '90d' | 'fy';
type ViewKey = 'map' | 'pivot' | 'rank';
type Grain = 'state' | 'city' | 'pincode';

type AnalyticsPayload = {
  period: { key: PeriodKey; from: string; to: string };
  states: AreaPerformance[];
  cities: AreaPerformance[];
  pincodes: AreaPerformance[];
  pivot_items: string[];
  pivot_matrix: { state: string; cells: Record<string, number>; total: number }[];
};

const BAND_LABEL: Record<AreaPerformance['band'], string> = {
  strong: 'Doing well',
  watch: 'Watch',
  weak: 'Needs attention',
  quiet: 'No movement',
};

function money(value: number) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export default function SupplierAnalyticsPage() {
  const { business } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>('90d');
  const [view, setView] = useState<ViewKey>('map');
  const [grain, setGrain] = useState<Grain>('state');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/suppliers/dashboard/analytics?period=${period}`)
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload.success) setData(payload);
      })
      .catch((error) => console.error('Error fetching analytics:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [business?.id, period]);

  const rows = grain === 'state' ? data?.states : grain === 'city' ? data?.cities : data?.pincodes;
  const visibleRows = useMemo(() => {
    const list = rows || [];
    if (!selectedState) return list;
    return list.filter((row) => row.state === selectedState);
  }, [rows, selectedState]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Area performance"
        subtitle="Where customers are buying from you, and where those goods are selling onward. Only customers who granted low-stock access are included."
      />

      <div className="flex flex-wrap gap-2">
        {([
          ['30d', 'Last 30 days'],
          ['90d', 'Last 90 days'],
          ['fy', 'This financial year'],
        ] as const).map(([key, label]) => (
          <Button key={key} size="sm" variant={period === key ? 'primary' : 'secondary'} onClick={() => setPeriod(key)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['map', 'Map'],
          ['pivot', 'Pivot'],
          ['rank', 'Ranking'],
        ] as const).map(([key, label]) => (
          <Button key={key} size="sm" variant={view === key ? 'primary' : 'secondary'} onClick={() => setView(key)}>
            {label}
          </Button>
        ))}
      </div>

      {data?.period && (
        <p className="text-xs text-gray-500">
          {data.period.from} to {data.period.to}. Bought from you is their posted purchase bills. Sold onward is their posted invoices of items they buy from you, list you as the default supplier for, or that you set a threshold on.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : !data || data.states.length === 0 ? (
        <Card padding="lg">
          <p className="text-center text-gray-500">No linked customers have granted low-stock access yet.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-700" /> Doing well</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-700" /> Watch</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-700" /> Needs attention</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> No movement</span>
          </div>

          {view === 'map' && (
            <Card padding="md" className="space-y-3">
              <IndiaAreaMap states={data.states} onSelect={(state) => setSelectedState(state)} />
              {selectedState && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-gray-700">Selected: {selectedState}</p>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedState(null)}>Clear</Button>
                </div>
              )}
              <AreaTable rows={selectedState ? data.states.filter((row) => row.state === selectedState) : data.states} />
            </Card>
          )}

          {view === 'pivot' && (
            <div className="space-y-4">
              <GrainSwitch grain={grain} onChange={setGrain} />
              <Card padding="md">
                <h3 className="font-semibold text-gray-900 mb-3">Location pivot</h3>
                <AreaTable rows={visibleRows} />
              </Card>
              <Card padding="md">
                <h3 className="font-semibold text-gray-900 mb-1">State by item</h3>
                <p className="text-xs text-gray-500 mb-3">Onward sales of the top items, by state.</p>
                {data.pivot_items.length === 0 ? (
                  <p className="text-sm text-gray-500">No onward sales in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left text-xs font-semibold text-gray-600 py-2 pr-3">State</th>
                          {data.pivot_items.map((item) => (
                            <th key={item} className="text-right text-xs font-semibold text-gray-600 py-2 px-2">{item}</th>
                          ))}
                          <th className="text-right text-xs font-semibold text-gray-600 py-2 pl-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pivot_matrix
                          .filter((row) => !selectedState || row.state === selectedState)
                          .map((row) => (
                            <tr key={row.state} className="border-b border-gray-100">
                              <td className="py-2 pr-3 font-medium text-gray-900">{row.state}</td>
                              {data.pivot_items.map((item) => (
                                <td key={item} className="py-2 px-2 text-right text-gray-700">{money(row.cells[item] || 0)}</td>
                              ))}
                              <td className="py-2 pl-2 text-right font-medium text-gray-900">{money(row.total)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {view === 'rank' && (
            <div className="space-y-3">
              <GrainSwitch grain={grain} onChange={setGrain} />
              <Card padding="md">
                <AreaTable rows={visibleRows} />
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GrainSwitch({ grain, onChange }: { grain: Grain; onChange: (grain: Grain) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {([
        ['state', 'State'],
        ['city', 'City'],
        ['pincode', 'PIN code'],
      ] as const).map(([key, label]) => (
        <Button key={key} size="sm" variant={grain === key ? 'primary' : 'secondary'} onClick={() => onChange(key)}>
          {label}
        </Button>
      ))}
    </div>
  );
}

function AreaTable({ rows }: { rows: AreaPerformance[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">Nothing in this selection.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left text-xs font-semibold text-gray-600 py-2 pr-3">Area</th>
            <th className="text-right text-xs font-semibold text-gray-600 py-2 px-2">Customers</th>
            <th className="text-right text-xs font-semibold text-gray-600 py-2 px-2">Bought from you</th>
            <th className="text-right text-xs font-semibold text-gray-600 py-2 px-2">Sold onward</th>
            <th className="text-right text-xs font-semibold text-gray-600 py-2 px-2">Low stock</th>
            <th className="text-left text-xs font-semibold text-gray-600 py-2 pl-2">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-gray-100">
              <td className="py-2 pr-3 font-medium text-gray-900">{row.label}</td>
              <td className="py-2 px-2 text-right text-gray-700">{row.customerCount}</td>
              <td className="py-2 px-2 text-right text-gray-700">{money(row.sellIn)}</td>
              <td className="py-2 px-2 text-right text-gray-700">{money(row.sellThrough)}</td>
              <td className="py-2 px-2 text-right text-gray-700">{row.lowStockItems}</td>
              <td className="py-2 pl-2 text-gray-800">{BAND_LABEL[row.band]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
