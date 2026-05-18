'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { BarChart3, TrendingUp, Calendar, DollarSign } from 'lucide-react';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { getChartPalette } from '@/lib/chartTheme';

import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';

interface ChartData {
  date: string;
  sales: number;
  purchases: number;
}

interface DashboardChartsProps {
  businessId: string;
  dateRange?: { start: string; end: string };
}

export const DashboardCharts: React.FC<DashboardChartsProps> = ({ businessId, dateRange }) => {
  const { isDarkMode } = useDarkMode();
  const chartColors = getChartPalette(isDarkMode);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | '90d' | 'custom'>('30d');

  useEffect(() => {
    fetchChartData();
  }, [businessId, selectedPeriod, dateRange]);

  const fetchChartData = async () => {
    if (!businessId) return;

    setLoading(true);
    try {
      let startDate: string;
      let endDate: string = format(new Date(), 'yyyy-MM-dd');

      if (dateRange) {
        startDate = dateRange.start;
        endDate = dateRange.end;
      } else {
        switch (selectedPeriod) {
          case '7d':
            startDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
            break;
          case '30d':
            startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
            break;
          case '90d':
            startDate = format(subDays(new Date(), 90), 'yyyy-MM-dd');
            break;
          default:
            startDate = format(startOfMonth(new Date()), 'yyyy-MM-dd');
            endDate = format(endOfMonth(new Date()), 'yyyy-MM-dd');
        }
      }

      const res = await fetch(
        `/api/dashboard/charts?business_id=${businessId}&start_date=${startDate}&end_date=${endDate}`
      );

      if (res.ok) {
        const data = await res.json();
        setChartData(data.chartData || []);
      }
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Simple SVG-based line chart (no external dependencies)
  const renderLineChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-text-muted">
          <p>No data available</p>
        </div>
      );
    }

    const maxValue = Math.max(
      ...chartData.map(d => Math.max(d.sales, d.purchases)),
      1000
    );

    const width = 800;
    const height = 300;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const c = chartColors;

    const points = chartData.map((d, i) => {
      const x = padding + (i / (chartData.length - 1 || 1)) * chartWidth;
      const salesY = padding + chartHeight - (d.sales / maxValue) * chartHeight;
      const purchasesY = padding + chartHeight - (d.purchases / maxValue) * chartHeight;
      return { x, salesY, purchasesY, date: d.date };
    });

    const salesPath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.salesY}`)
      .join(' ');

    const purchasesPath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.purchasesY}`)
      .join(' ');

    return (
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} className="w-full h-auto">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding + chartHeight * (1 - ratio);
            return (
              <line
                key={ratio}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke={c.grid}
                strokeWidth="1"
              />
            );
          })}

          {/* Sales line */}
          <path
            d={salesPath}
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Purchases line */}
          <path
            d={purchasesPath}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.salesY}
                r="4"
                fill="#10b981"
                className="hover:r-6 transition-all cursor-pointer"
              />
              <circle
                cx={point.x}
                cy={point.purchasesY}
                r="4"
                fill="#ef4444"
                className="hover:r-6 transition-all cursor-pointer"
              />
            </g>
          ))}

          {/* X-axis labels */}
          {points
            .filter((_, i) => i % Math.ceil(chartData.length / 6) === 0 || i === chartData.length - 1)
            .map((point, i) => (
              <text
                key={i}
                x={point.x}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill={c.axis}
              >
                {format(new Date(point.date), 'MMM dd')}
              </text>
            ))}
        </svg>
      </div>
    );
  };

  const renderBarChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-text-muted">
          <p>No data available</p>
        </div>
      );
    }

    const maxValue = Math.max(
      ...chartData.map(d => Math.max(d.sales, d.purchases)),
      1000
    );

    const barWidth = Math.max(20, 800 / chartData.length - 4);

    return (
      <div className="w-full overflow-x-auto">
        <div className="flex items-end gap-1 h-64 px-4">
          {chartData.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-[40px]">
              <div className="flex flex-col items-center gap-1 w-full">
                <div
                  className="w-full bg-green-500 rounded-t hover:bg-green-600 transition-colors cursor-pointer"
                  style={{ height: `${(d.sales / maxValue) * 200}px` }}
                  title={`Sales: ₹${d.sales.toLocaleString()}`}
                />
                <div
                  className="w-full bg-red-500 rounded-t hover:bg-red-600 transition-colors cursor-pointer"
                  style={{ height: `${(d.purchases / maxValue) * 200}px` }}
                  title={`Purchases: ₹${d.purchases.toLocaleString()}`}
                />
              </div>
              <span className="text-xs text-text-secondary transform -rotate-45 origin-top-left whitespace-nowrap">
                {format(new Date(d.date), 'MMM dd')}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sales vs Purchases Chart */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary-500" />
            <h3 className="text-lg font-semibold text-text-primary">Sales vs Purchases</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as any)}
              className="text-sm bg-surface text-text-primary border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-4 text-sm text-text-primary">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span>Sales</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded"></div>
            <span>Purchases</span>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          {renderLineChart()}
        </div>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary mb-1">Total Sales</p>
              <p className="text-2xl font-bold text-text-primary">
                ₹{chartData.reduce((sum, d) => sum + d.sales, 0).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-950/40 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary mb-1">Total Purchases</p>
              <p className="text-2xl font-bold text-text-primary">
                ₹{chartData.reduce((sum, d) => sum + d.purchases, 0).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">
              <DollarSign className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary mb-1">Net Profit</p>
              <p className="text-2xl font-bold text-text-primary">
                ₹{(
                  chartData.reduce((sum, d) => sum + d.sales, 0) -
                  chartData.reduce((sum, d) => sum + d.purchases, 0)
                ).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg">
              <Calendar className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

