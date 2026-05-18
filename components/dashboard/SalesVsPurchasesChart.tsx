'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { BarChart3 } from 'lucide-react';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { getChartPalette } from '@/lib/chartTheme';

import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';

interface ChartData {
  date: string;
  sales: number;
  purchases: number;
}

interface SalesVsPurchasesChartProps {
  businessId: string;
  dateRange?: { start: string; end: string };
}

export const SalesVsPurchasesChart: React.FC<SalesVsPurchasesChartProps> = ({ businessId, dateRange }) => {
  const router = useRouter();
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

      // If user selected a period in the chart dropdown, use that instead of dateRange prop
      // This allows the chart to have its own period selector independent of dashboard date range
      if (selectedPeriod !== 'custom') {
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
      } else if (dateRange) {
        // Only use dateRange prop when period is set to 'custom'
        startDate = dateRange.start;
        endDate = dateRange.end;
      } else {
        // Fallback to 30 days if nothing is set
        startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
      }

      const res = await fetch(
        `/api/dashboard/charts?business_id=${businessId}&start_date=${startDate}&end_date=${endDate}`
      );

      if (res.ok) {
        const data = await res.json();
        console.log('[SalesVsPurchasesChart] Fetched data:', {
          chartDataLength: data.chartData?.length || 0,
          sampleData: data.chartData?.slice(0, 3),
          dateRange: { startDate, endDate },
        });
        setChartData(data.chartData || []);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('[SalesVsPurchasesChart] API error:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData.error || errorData,
          details: errorData.details,
        });
        // Show user-friendly error message
        if (errorData.error) {
          console.error('Error details:', errorData.error);
        }
      }
    } catch (error) {
      console.error('[SalesVsPurchasesChart] Failed to fetch chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Simple SVG-based bar chart (no external dependencies)
  const renderBarChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-text-muted">
          <p>No data available</p>
        </div>
      );
    }

    // Debug: Log chart data
    console.log('[SalesVsPurchasesChart] Rendering bars with data:', {
      dataLength: chartData.length,
      sampleData: chartData.slice(0, 3),
      allSales: chartData.map(d => d.sales),
      allPurchases: chartData.map(d => d.purchases),
    });

    const maxValue = Math.max(
      ...chartData.map(d => Math.max(Number(d.sales) || 0, Number(d.purchases) || 0)),
      1000
    );

    const width = 800;
    const height = 300;
    const padding = 50; // Increased padding for Y-axis labels
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = Math.max(30, Math.min(60, (chartWidth / chartData.length) * 0.6));
    const barSpacing = chartWidth / chartData.length;
    const gapBetweenBars = 4;
    const c = chartColors;

    return (
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} className="w-full h-auto" viewBox={`0 0 ${width} ${height}`}>
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

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding + chartHeight * (1 - ratio);
            const value = Math.round(maxValue * ratio);
            return (
              <text
                key={ratio}
                x={padding - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill={c.axis}
              >
                ₹{value > 1000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString('en-IN')}
              </text>
            );
          })}

          {/* Bars */}
          {chartData.map((d, i) => {
            const salesValue = Number(d.sales) || 0;
            const purchasesValue = Number(d.purchases) || 0;
            const x = padding + i * barSpacing + (barSpacing - barWidth) / 2;
            const salesHeight = maxValue > 0 ? (salesValue / maxValue) * chartHeight : 0;
            const purchasesHeight = maxValue > 0 ? (purchasesValue / maxValue) * chartHeight : 0;
            const salesY = padding + chartHeight - salesHeight;
            const purchasesY = padding + chartHeight - purchasesHeight;
            const barHalfWidth = (barWidth - gapBetweenBars) / 2;

            // Ensure minimum height for visibility (at least 2px if value > 0)
            const minBarHeight = 2;
            const finalSalesHeight = salesValue > 0 && salesHeight < minBarHeight ? minBarHeight : salesHeight;
            const finalPurchasesHeight = purchasesValue > 0 && purchasesHeight < minBarHeight ? minBarHeight : purchasesHeight;
            const finalSalesY = padding + chartHeight - finalSalesHeight;
            const finalPurchasesY = padding + chartHeight - finalPurchasesHeight;

            const handleSalesClick = () => {
              if (salesValue > 0) {
                router.push(`/invoices?date_from=${d.date}&date_to=${d.date}`);
              }
            };

            const handlePurchasesClick = () => {
              if (purchasesValue > 0) {
                router.push(`/purchases?date_from=${d.date}&date_to=${d.date}`);
              }
            };

            return (
              <g key={i}>
                {/* Sales bar */}
                {salesValue > 0 && (
                  <rect
                    x={x}
                    y={finalSalesY}
                    width={barHalfWidth}
                    height={finalSalesHeight}
                    fill="#10b981"
                    className="hover:opacity-80 transition-opacity cursor-pointer"
                    rx="2"
                    onClick={handleSalesClick}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    <title>
                      Sales: ₹{salesValue.toLocaleString('en-IN')} on {format(new Date(d.date), 'MMM dd, yyyy')} - Click to view invoices
                    </title>
                  </rect>
                )}

                {/* Purchases bar */}
                {purchasesValue > 0 && (
                  <rect
                    x={x + barHalfWidth + gapBetweenBars}
                    y={finalPurchasesY}
                    width={barHalfWidth}
                    height={finalPurchasesHeight}
                    fill="#ef4444"
                    className="hover:opacity-80 transition-opacity cursor-pointer"
                    rx="2"
                    onClick={handlePurchasesClick}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    <title>
                      Purchases: ₹{purchasesValue.toLocaleString('en-IN')} on {format(new Date(d.date), 'MMM dd, yyyy')} - Click to view purchases
                    </title>
                  </rect>
                )}

                {/* X-axis label */}
                {i % Math.ceil(chartData.length / 8) === 0 || i === chartData.length - 1 ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 15}
                    textAnchor="middle"
                    fontSize="10"
                    fill={c.axis}
                  >
                    {format(new Date(d.date), 'MMM dd')}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  if (loading) {
    return (
      <Card padding="md" className="h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="md" className="h-full border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary-500" />
          <h3 className="text-lg font-semibold text-text-primary">Sales vs Purchases</h3>
        </div>
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
        {renderBarChart()}
      </div>
    </Card>
  );
};

