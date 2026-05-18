'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Download, Loader2, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';

export default function StockValuationReportPage() {
  const { business, user } = useAuth();
  const searchParams = useSearchParams();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [asOnDate, setAsOnDate] = useState(new Date().toISOString().split('T')[0]);
  const [valuationMethod, setValuationMethod] = useState<'fifo' | 'lifo' | 'weighted_avg' | 'simple'>('simple');
  const [locationId, setLocationId] = useState<string>('');
  const [locations, setLocations] = useState<any[]>([]);
  const [autoGenerate, setAutoGenerate] = useState(false);

  // Read warehouse_id (or location_id for backward compatibility) from URL params
  useEffect(() => {
    const urlWarehouseId = searchParams.get('warehouse_id') || searchParams.get('location_id');
    if (urlWarehouseId) {
      setLocationId(urlWarehouseId);
      setAutoGenerate(true); // Auto-generate report when coming from warehouse page
    }
  }, [searchParams]);

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchLocations();
    }
  }, [business?.id, user?.id]);

  const fetchLocations = async () => {
    if (!business?.id || !user?.id) return;
    try {
      // Try to fetch warehouses first (new system)
      const res = await fetch(`/api/warehouses?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        // Map warehouses to location format
        const mappedLocations = (data.warehouses || []).map((w: any) => ({
          id: w.id,
          name: w.name,
          warehouse_code: w.warehouse_code,
        }));
        setLocations(mappedLocations);
      } else {
        // Fallback to legacy locations API
        const legacyRes = await fetch(`/api/locations?business_id=${business.id}`);
        if (legacyRes.ok) {
          const legacyData = await legacyRes.json();
          setLocations(legacyData.locations || []);
        }
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleGenerateReport = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        as_on_date: asOnDate,
        valuation_method: valuationMethod,
      });

      if (locationId) {
        params.append('location_id', locationId);
      }

      const res = await fetch(`/api/reports/stock/valuation?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to generate report');
      }
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate report when location is pre-selected from URL
  useEffect(() => {
    if (autoGenerate && locationId && business?.id && user?.id && locations.length > 0) {
      // Wait a bit for locations to load, then generate report
      const timer = setTimeout(() => {
        handleGenerateReport();
        setAutoGenerate(false); // Only auto-generate once
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, locationId, business?.id, user?.id, locations.length]);

  const exportToExcel = () => {
    if (!report) return;

    // Simple CSV export
    const headers = ['Item Name', 'Item Code', 'Unit', 'Quantity', 'Unit Cost', 'Total Value', 'Valuation Method'];
    const rows = report.items.map((item: any) => [
      item.item_name,
      item.item_code || '',
      item.unit,
      item.quantity,
      item.unit_cost.toFixed(2),
      item.total_value.toFixed(2),
      item.valuation_method,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-valuation-${asOnDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Stock Valuation Report</h1>
            <p className="text-sm text-text-secondary mt-1">View stock value by different valuation methods</p>
          </div>
        </div>

        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                As On Date
              </label>
              <Input
                type="date"
                value={asOnDate}
                onChange={(e) => setAsOnDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Valuation Method
              </label>
              <select
                value={valuationMethod}
                onChange={(e) => setValuationMethod(e.target.value as any)}
                className="input"
              >
                <option value="simple">Simple</option>
                <option value="fifo">FIFO</option>
                <option value="lifo">LIFO</option>
                <option value="weighted_avg">Weighted Average</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Location (Optional)
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="input"
              >
                <option value="">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <Button onClick={handleGenerateReport} disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Report'
                )}
              </Button>
            </div>
          </div>
        </Card>

        {report && (
          <Card padding="md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Stock Valuation Report</h2>
                <p className="text-sm text-text-secondary">
                  As on: {new Date(report.as_on_date).toLocaleDateString()} • 
                  Method: {report.valuation_method.toUpperCase()} • 
                  Items: {report.item_count}
                </p>
              </div>
              <Button variant="secondary" onClick={exportToExcel}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export to Excel
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Item Name</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Code</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Quantity</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Unit Cost</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Total Value</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item: any, index: number) => (
                    <tr key={index} className="border-b border-border hover:bg-gray-50">
                      <td className="py-3 px-4 text-text-primary">{item.item_name}</td>
                      <td className="py-3 px-4 text-text-secondary">{item.item_code || '-'}</td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        {item.quantity.toFixed(3)} {item.unit}
                      </td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        ₹{item.unit_cost.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-text-primary">
                        ₹{item.total_value.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {item.track_batch && '📦 Batch'} {item.track_serial && '🔢 Serial'}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="py-3 px-4 text-text-primary">Total Stock Value</td>
                    <td className="py-3 px-4 text-right text-primary-600">
                      ₹{report.total_value.toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    
  );
}

