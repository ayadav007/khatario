'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, FileText, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';

interface AgingBucket {
  supplier_id: string;
  supplier_name: string;
  total_outstanding: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
}

function PayablesAgingPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<AgingBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchAging();
    }
  }, [business?.id, asOnDate]);

  const fetchAging = async () => {
    if (!business?.id) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        as_on_date: asOnDate,
      });

      const res = await fetch(`/api/reports/aging/payables?${params}`);
      
      if (res.ok) {
        const result = await res.json();
        setData(result.aging || []);
      } else {
        // Handle authorization and other errors
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch payables aging report' }));
        
        if (res.status === 403 || res.status === 401) {
          // Authorization error - show access denied
          setError({
            message: errorData.message || errorData.error || 'Access denied',
            code: errorData.code || 'ACCESS_DENIED'
          });
          setData([]); // Clear data on access denied
        } else {
          // Other errors
          setError({
            message: errorData.message || errorData.error || 'Failed to fetch payables aging report',
            code: errorData.code || 'FETCH_ERROR'
          });
        }
      }
    } catch (error) {
      console.error('Error fetching payables aging:', error);
      setError({
        message: 'Failed to fetch payables aging report',
        code: 'NETWORK_ERROR'
      });
    } finally {
      setLoading(false);
    }
  };

  const totals = data.reduce((acc, item) => ({
    total_outstanding: acc.total_outstanding + item.total_outstanding,
    bucket_0_30: acc.bucket_0_30 + item.bucket_0_30,
    bucket_31_60: acc.bucket_31_60 + item.bucket_31_60,
    bucket_61_90: acc.bucket_61_90 + item.bucket_61_90,
    bucket_90_plus: acc.bucket_90_plus + item.bucket_90_plus,
  }), { total_outstanding: 0, bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 });

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Payables Aging Report</h1>
            <p className="text-sm text-text-secondary mt-1">Outstanding payables by age</p>
          </div>
          <Button onClick={() => window.print()}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>

        <Card>
          <Input
            type="date"
            label="As On Date"
            value={asOnDate}
            onChange={(e) => setAsOnDate(e.target.value)}
            className="max-w-xs"
          />
        </Card>

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : error ? (
            <div className="py-12">
              <AccessDenied
                module="reports"
                action="read"
                details={error.message}
                code={error.code || "ACCESS_DENIED"}
              />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No payables found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Supplier</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">0-30 Days</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">31-60 Days</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">61-90 Days</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">90+ Days</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Total Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item) => (
                    <tr key={item.supplier_id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4 font-medium">{item.supplier_name}</td>
                      <td className="py-4 px-4 text-right">
                        ₹{item.bucket_0_30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{item.bucket_31_60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{item.bucket_61_90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right text-red-600">
                        ₹{item.bucket_90_plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right font-semibold">
                        ₹{item.total_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-bold bg-gray-50">
                    <td className="py-4 px-4">Total</td>
                    <td className="py-4 px-4 text-right">
                      ₹{totals.bucket_0_30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-4 px-4 text-right">
                      ₹{totals.bucket_31_60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-4 px-4 text-right">
                      ₹{totals.bucket_61_90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-4 px-4 text-right text-red-600">
                      ₹{totals.bucket_90_plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-4 px-4 text-right">
                      ₹{totals.total_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    
  );
}

export default withPageAuth('reports', 'read', PayablesAgingPage);
