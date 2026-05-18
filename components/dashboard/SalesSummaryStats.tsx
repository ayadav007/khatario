'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { TrendingUp, DollarSign, Calendar } from 'lucide-react';

import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';

interface ChartData {
  date: string;
  sales: number;
  purchases: number;
}

interface SalesSummaryStatsProps {
  businessId: string;
  dateRange?: { start: string; end: string };
}

export const SalesSummaryStats: React.FC<SalesSummaryStatsProps> = ({ businessId, dateRange }) => {
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
      } else {
        console.error('Failed to fetch chart data:', await res.text());
        setChartData([]);
      }
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} padding="md">
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const totalSales = chartData.reduce((sum, d) => sum + (Number(d.sales) || 0), 0);
  const totalPurchases = chartData.reduce((sum, d) => sum + (Number(d.purchases) || 0), 0);
  const netProfit = totalSales - totalPurchases;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
      <Card padding="md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary mb-1">Total Sales</p>
            <p className="text-2xl font-bold text-text-primary">
              ₹{totalSales.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <TrendingUp className="w-6 h-6 text-green-600" />
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary mb-1">Total Purchases</p>
            <p className="text-2xl font-bold text-text-primary">
              ₹{totalPurchases.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <DollarSign className="w-6 h-6 text-red-600" />
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary mb-1">Net Profit</p>
            <p className="text-2xl font-bold text-text-primary">
              ₹{netProfit.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <Calendar className="w-6 h-6 text-primary-600" />
          </div>
        </div>
      </Card>
    </div>
  );
};

