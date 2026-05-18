'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TrendingUp, TrendingDown, Target, DollarSign, FileText, Users, Calendar, Loader2, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmployeePerformance } from '@/types/database';
import { format } from 'date-fns';

interface PerformanceWithDetails extends EmployeePerformance {
  employee_code: string;
  employee_name: string;
  designation?: string;
  achievement_percentage?: number;
}

export default function PerformanceDashboardPage() {
  const { business } = useAuth();
  const [performance, setPerformance] = useState<PerformanceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summary, setSummary] = useState({
    totalSales: 0,
    totalInvoices: 0,
    totalCommission: 0,
    totalEmployees: 0,
  });

  useEffect(() => {
    if (business?.id) {
      fetchPerformance();
    }
  }, [business?.id, periodType, startDate, endDate]);

  const fetchPerformance = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
      });

      const res = await fetch(`/api/employees/performance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPerformance(data.performance || []);
        setSummary(data.summary || {
          totalSales: 0,
          totalInvoices: 0,
          totalCommission: 0,
          totalEmployees: 0,
        });
      }
    } catch (error) {
      console.error('Error fetching performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAchievementColor = (percentage?: number) => {
    if (!percentage) return 'text-gray-500';
    if (percentage >= 100) return 'text-green-600';
    if (percentage >= 80) return 'text-primary-600';
    if (percentage >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Performance Dashboard</h1>
            <p className="text-sm text-text-secondary mt-1">Track employee sales performance and targets</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Total Sales</p>
                <p className="text-2xl font-bold text-text-primary">
                  ₹{summary.totalSales.toLocaleString('en-IN')}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Total Invoices</p>
                <p className="text-2xl font-bold text-text-primary">
                  {summary.totalInvoices.toLocaleString('en-IN')}
                </p>
              </div>
              <FileText className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Total Commission</p>
                <p className="text-2xl font-bold text-text-primary">
                  ₹{summary.totalCommission.toLocaleString('en-IN')}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Active Employees</p>
                <p className="text-2xl font-bold text-text-primary">
                  {summary.totalEmployees}
                </p>
              </div>
              <Users className="w-8 h-8 text-purple-500" />
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Period Type
              </label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as any)}
                className="input"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div className="flex items-end">
              <Button onClick={fetchPerformance} className="w-full">
                Refresh
              </Button>
            </div>
          </div>
        </Card>

        {/* Performance Table */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : performance.length === 0 ? (
            <div className="text-center py-12">
              <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No performance data found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Period</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Sales</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Invoices</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Avg Invoice</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Target</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Achievement</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((perf) => (
                    <tr
                      key={perf.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{perf.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {perf.employee_code}
                          </div>
                          {perf.designation && (
                            <div className="text-xs text-text-secondary">{perf.designation}</div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {format(new Date(perf.period_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="font-medium">₹{perf.total_sales.toLocaleString('en-IN')}</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        {perf.total_invoices}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{perf.average_invoice_value.toLocaleString('en-IN')}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {perf.target_amount ? (
                          <span>₹{perf.target_amount.toLocaleString('en-IN')}</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {perf.achievement_percentage !== null && perf.achievement_percentage !== undefined ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className={`font-bold ${getAchievementColor(perf.achievement_percentage)}`}>
                              {perf.achievement_percentage.toFixed(1)}%
                            </span>
                            {perf.achievement_percentage >= 100 ? (
                              <TrendingUp className="w-4 h-4 text-green-600" />
                            ) : perf.achievement_percentage < 50 ? (
                              <TrendingDown className="w-4 h-4 text-red-600" />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="font-medium text-primary-600">
                          ₹{perf.total_commission.toLocaleString('en-IN')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    
  );
}

