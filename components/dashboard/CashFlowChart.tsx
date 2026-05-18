'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Info, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { getChartPalette } from '@/lib/chartTheme';

interface CashFlowMonth {
  month: string;
  monthLabel: string;
  opening: number;
  incoming: number;
  outgoing: number;
  closing: number;
}

interface CashFlowData {
  fiscal_year: string;
  months: CashFlowMonth[];
  chart_series?: CashFlowMonth[];
  summary: {
    total_incoming: number;
    total_outgoing: number;
    opening_balance: number;
    closing_balance: number;
    breakdown?: {
      incoming: {
        receivable_payments: number;
      };
      outgoing: {
        purchases?: number;
        payments_out?: number;
        expenses: number;
        other_payments: number;
      };
    };
  };
}

interface CashFlowChartProps {
  businessId: string;
}

export const CashFlowChart: React.FC<CashFlowChartProps> = ({ businessId }) => {
  const { isDarkMode } = useDarkMode();
  const chartColors = getChartPalette(isDarkMode);
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    const currentDate = new Date();
    let year = currentDate.getFullYear();
    if (currentDate.getMonth() < 3) {
      year = currentDate.getFullYear() - 1;
    }
    setSelectedYear(year);
  }, []);

  useEffect(() => {
    if (!businessId || !selectedYear) return;
    fetchCashFlowData();
  }, [businessId, selectedYear]);

  const fetchCashFlowData = async () => {
    if (!businessId || !selectedYear) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/dashboard/cash-flow?business_id=${businessId}&fiscal_year=${selectedYear}`,
        { credentials: 'include' }
      );

      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch cash flow data:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderChart = () => {
    if (!data || data.months.length === 0) {
      return (
        <div className="h-64 flex items-center justify-center text-text-muted">
          <p>No data available</p>
        </div>
      );
    }

    const c = chartColors;
    const series = data.chart_series?.length ? data.chart_series : data.months;

    const allValues = series.flatMap((m) => [m.opening, m.closing, m.incoming, m.outgoing]);
    const minValue = Math.min(...allValues, 0);
    const maxValue = Math.max(...allValues, 1000);
    
    // Add padding to the range for better visualization
    const valueRange = maxValue - minValue;
    const padding = valueRange * 0.1; // 10% padding
    const adjustedMin = minValue - padding;
    const adjustedMax = maxValue + padding;
    const adjustedRange = adjustedMax - adjustedMin;

    const height = 300;
    const width = 800;
    const chartPadding = 60;
    const bottomPadding = series.length > 7 ? 40 : 30;
    const chartWidth = width - chartPadding * 2;
    const chartHeight = height - chartPadding - bottomPadding;

    const points = series.map((month, i) => {
      const x = chartPadding + (i / (series.length - 1 || 1)) * chartWidth;
      const normalizedValue = (month.closing - adjustedMin) / adjustedRange;
      const y = chartPadding + chartHeight - normalizedValue * chartHeight;

      let monthLabel: string;
      if (month.month === 'opening') {
        monthLabel = 'Open';
      } else {
        const [y, monthNum] = month.month.split('-');
        const monthDate = new Date(parseInt(y, 10), parseInt(monthNum, 10) - 1, 1);
        monthLabel = format(monthDate, 'MMM-yy');
      }

      return { x, y, month: monthLabel, value: month.closing, fullMonth: month.monthLabel };
    });

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    // Generate Y-axis labels dynamically based on data range
    // Ensure zero is always included if it's within the range
    const numLabels = 6;
    let yAxisLabels = Array.from({ length: numLabels }, (_, i) => {
      const value = adjustedMin + (adjustedRange * (numLabels - 1 - i) / (numLabels - 1));
      const y = chartPadding + (i / (numLabels - 1)) * chartHeight;
      let label = '';
      if (Math.abs(value) >= 100000) {
        label = `₹${(value / 100000).toFixed(1)}L`;
      } else if (Math.abs(value) >= 1000) {
        label = `₹${(value / 1000).toFixed(1)}K`;
      } else {
        label = `₹${Math.round(value)}`;
      }
      return { y, label, value };
    });

    // If zero is in range but not in labels, add it
    if (adjustedMin <= 0 && adjustedMax >= 0) {
      const hasZero = yAxisLabels.some(label => Math.abs(label.value) < 0.01);
      if (!hasZero) {
        const zeroY = chartPadding + chartHeight - ((0 - adjustedMin) / adjustedRange) * chartHeight;
        yAxisLabels.push({ y: zeroY, label: '₹0', value: 0 });
        yAxisLabels.sort((a, b) => b.y - a.y); // Sort by Y position (top to bottom)
      }
    }

    // Draw zero line if it's within the range
    const zeroY = adjustedMin <= 0 && adjustedMax >= 0
      ? chartPadding + chartHeight - ((0 - adjustedMin) / adjustedRange) * chartHeight
      : null;

    // Calculate SVG height to accommodate rotated labels
    const svgHeight = height + (series.length > 7 ? 40 : 0);
    const svgWidth = Math.max(width, series.length * 70);

    return (
      <div className="w-full overflow-x-auto overflow-y-visible">
        <svg width={svgWidth} height={svgHeight} className="w-full h-auto" viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ overflow: 'visible' }}>
          {/* Zero line - draw first so it's behind everything */}
          {zeroY !== null && (
            <line
              x1={chartPadding}
              y1={zeroY}
              x2={width - chartPadding}
              y2={zeroY}
              stroke={c.zeroLine}
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.8"
            />
          )}

          {/* Grid lines */}
          {yAxisLabels.map((label, i) => (
            <line
              key={i}
              x1={chartPadding}
              y1={label.y}
              x2={width - chartPadding}
              y2={label.y}
              stroke={label.value === 0 ? c.gridStrong : c.grid}
              strokeWidth={label.value === 0 ? "1.5" : "1"}
              strokeDasharray={label.value === 0 ? "4,4" : "none"}
            />
          ))}

          {/* Y-axis labels */}
          {yAxisLabels.map((label, i) => (
            <text
              key={i}
              x={chartPadding - 10}
              y={label.y + 4}
              textAnchor="end"
              fontSize="10"
              fill={label.value === 0 ? c.labelStrong : c.axis}
              fontWeight={label.value === 0 ? "700" : "400"}
            >
              {label.label}
            </text>
          ))}

          {/* Cash flow line */}
          <path
            d={path}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r="5"
                fill="#3b82f6"
                stroke={c.pointStroke}
                strokeWidth="2"
                className="hover:r-7 transition-all cursor-pointer"
              />
              <title>{`${point.fullMonth}: ₹${point.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</title>
            </g>
          ))}

          {/* X-axis labels - show all months */}
          {points.map((point, i) => {
            // Rotate labels if there are more than 6 months to prevent overlap
            const shouldRotate = data.months.length > 6;
            const rotation = shouldRotate ? -45 : 0;
            const labelY = shouldRotate ? height + 30 : height - 5;
            const labelX = point.x;
            
            return (
              <g key={`month-label-${i}`} transform={`translate(${labelX}, ${labelY})`}>
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  fontSize="11"
                  fill={c.labelStrong}
                  fontWeight="500"
                  className="select-none"
                  transform={shouldRotate ? `rotate(${rotation} 0 0)` : ''}
                  style={{ textOverflow: 'visible', overflow: 'visible' }}
                >
                  {point.month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Get available fiscal years (current and previous 2 years)
  const getAvailableYears = () => {
    const currentDate = new Date();
    let currentYear = currentDate.getFullYear();
    if (currentDate.getMonth() < 3) {
      currentYear = currentDate.getFullYear() - 1;
    }
    return [currentYear, currentYear - 1, currentYear - 2];
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

  const fiscalYearLabel = data?.fiscal_year || `${selectedYear}-${(selectedYear || 0) + 1}`;
  const openingDate = `01/04/${selectedYear}`;
  const closingDate = `31/03/${(selectedYear || 0) + 1}`;

  return (
    <Card padding="md" className="border border-border h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-text-primary">Cash Flow</h3>
          <div className="relative group">
            <Info className="w-4 h-4 text-text-muted cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <p className="font-semibold mb-2">Cash Flow Calculation:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li><strong>Incoming:</strong> Payments received from customers (receivables)</li>
                <li><strong>Outgoing:</strong> Payments out (suppliers, payables) + cash expenses (rent, utilities, etc.)</li>
                <li><strong>Opening:</strong> Ledger balance of cash &amp; bank accounts on the day before 1 Apr</li>
                <li><strong>Expenses:</strong> Rent, utilities, and other operational expenses</li>
                <li><strong>Closing Balance:</strong> Opening balance + Incoming - Outgoing</li>
              </ul>
              <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        </div>
        <select
          value={selectedYear || ''}
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          className="text-sm bg-surface text-text-primary border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {getAvailableYears().map(year => (
            <option key={year} value={year}>
              FY {year}-{year + 1}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-border pt-4 mb-6">
        {renderChart()}
        {data && data.months.length > 1 && (() => {
          const closings = data.months.map((m) => m.closing);
          const minC = Math.min(...closings);
          const maxC = Math.max(...closings);
          const flat = Math.abs(maxC - minC) < 0.01;
          return flat ? (
            <p className="text-xs text-text-muted mt-2 px-1">
              The line shows <strong>cash at each month-end</strong> (opening + in − out, month by month). If
              it looks flat, your receipts and payments are mostly in <strong>one</strong> month, so the
              balance does not change in other months. Hover a point to see the amount for that month.
            </p>
          ) : null;
        })()}
      </div>

      {/* Summary Panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
        <div className="flex flex-col relative group">
          <p className="text-xs text-text-secondary mb-1">Cash as on {openingDate}</p>
          <p className="text-lg font-bold text-text-primary cursor-help">
            ₹{(data?.summary.opening_balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
            <p className="font-semibold mb-2">Opening Balance:</p>
            <p className="text-xs leading-relaxed">
              Sum of cash &amp; bank ledger balances as of the day before {openingDate} (from posted entries and opening balances).
            </p>
            <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </div>
        
        {/* Incoming with breakdown tooltip */}
        <div className="flex flex-col relative group">
          <p className="text-xs text-text-secondary mb-1">Incoming</p>
          <p className="text-lg font-bold text-green-600 cursor-help">
            <span className="text-green-600">+</span> ₹{(data?.summary.total_incoming || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          {data?.summary.breakdown && (
            <div className="absolute left-0 bottom-full mb-2 w-72 p-4 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <p className="font-bold mb-3 text-sm">Incoming Cash Flow Breakdown:</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-gray-700">
                  <span className="text-gray-300">Payments from Customers:</span>
                  <span className="font-semibold text-green-400">₹{data.summary.breakdown.incoming.receivable_payments.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-gray-700">
                  <span className="font-semibold">Total Incoming:</span>
                  <span className="font-bold text-green-400 text-sm">₹{data.summary.total_incoming.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="absolute left-6 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          )}
        </div>

        {/* Outgoing with breakdown tooltip */}
        <div className="flex flex-col relative group">
          <p className="text-xs text-text-secondary mb-1">Outgoing</p>
          <p className="text-lg font-bold text-red-600 cursor-help">
            <span className="text-red-600">-</span> ₹{(data?.summary.total_outgoing || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          {data?.summary.breakdown && (
            <div className="absolute left-0 bottom-full mb-2 w-72 p-4 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <p className="font-bold mb-3 text-sm">Outgoing Cash Flow Breakdown:</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-gray-700">
                  <span className="text-gray-300">Payments out:</span>
                  <span className="font-semibold text-red-400">
                    ₹{(data.summary.breakdown.outgoing.payments_out ?? data.summary.breakdown.outgoing.other_payments ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-gray-700">
                  <span className="text-gray-300">Expenses (cash):</span>
                  <span className="font-semibold text-red-400">₹{data.summary.breakdown.outgoing.expenses.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t-2 border-gray-600">
                  <span className="font-semibold">Total Outgoing:</span>
                  <span className="font-bold text-red-400 text-sm">₹{data.summary.total_outgoing.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="absolute left-6 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          )}
        </div>

        {/* Closing Balance with calculation tooltip */}
        <div className="flex flex-col relative group">
          <p className="text-xs text-text-secondary mb-1">Cash as on {closingDate}</p>
          <p className="text-lg font-bold text-gray-900 cursor-help">
            <span className="text-text-secondary">=</span> ₹{(data?.summary.closing_balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
            <p className="font-semibold mb-2">Closing Balance Calculation:</p>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Opening Balance:</span>
                <span className="font-medium">₹{(data?.summary.opening_balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-green-400">
                <span>+ Incoming:</span>
                <span className="font-medium">₹{(data?.summary.total_incoming || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>- Outgoing:</span>
                <span className="font-medium">₹{(data?.summary.total_outgoing || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="border-t border-gray-700 pt-1 mt-1 flex justify-between font-semibold">
                <span>= Closing Balance:</span>
                <span className="font-bold">₹{(data?.summary.closing_balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </div>
      </div>
    </Card>
  );
};


