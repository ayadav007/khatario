'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, MapPin, TrendingUp, Package } from 'lucide-react';

interface LocationStat {
  state?: string;
  city?: string;
  pincode?: string;
  customer_count: number;
  total_sales: number;
  item_count: number;
}

export default function SupplierAnalyticsPage() {
  const { business } = useAuth();
  const [loading, setLoading] = useState(true);
  const [byState, setByState] = useState<LocationStat[]>([]);
  const [byCity, setByCity] = useState<LocationStat[]>([]);
  const [byPincode, setByPincode] = useState<LocationStat[]>([]);

  useEffect(() => {
    fetchAnalytics();
  }, [business?.id]);

  const fetchAnalytics = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/suppliers/dashboard/analytics?supplier_business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setByState(data.by_state || []);
        setByCity(data.by_city || []);
        setByPincode(data.by_pincode || []);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderLocationTable = (data: LocationStat[], title: string, locationField: 'state' | 'city' | 'pincode') => {
    return (
      <Card padding="md">
        <h3 className="font-semibold text-gray-900 mb-4">{title}</h3>
        {data.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-semibold text-gray-600 pb-2 px-2">Location</th>
                  <th className="text-right text-xs font-semibold text-gray-600 pb-2 px-2">Customers</th>
                  <th className="text-right text-xs font-semibold text-gray-600 pb-2 px-2">Items</th>
                  <th className="text-right text-xs font-semibold text-gray-600 pb-2 px-2">Total Sales</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, index) => (
                  <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">
                          {item[locationField] || 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right text-gray-700">{item.customer_count}</td>
                    <td className="py-3 px-2 text-right text-gray-700">{item.item_count}</td>
                    <td className="py-3 px-2 text-right font-medium text-gray-900">
                      ₹{item.total_sales?.toLocaleString('en-IN') || '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  };

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Location Analytics</h1>
          <p className="text-sm text-gray-600 mt-1">
            Track your product performance by geographic location
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">States Covered</p>
                <p className="text-2xl font-bold text-gray-900">{byState.length}</p>
              </div>
              <div className="bg-slate-100 p-3 rounded-lg">
                <MapPin className="w-6 h-6 text-primary-600" />
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Cities Covered</p>
                <p className="text-2xl font-bold text-gray-900">{byCity.length}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">PIN Codes</p>
                <p className="text-2xl font-bold text-gray-900">{byPincode.length}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <Package className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </Card>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* By State */}
            {renderLocationTable(byState, 'Performance by State', 'state')}

            {/* By City */}
            {renderLocationTable(byCity, 'Performance by City', 'city')}

            {/* By Pincode */}
            {renderLocationTable(byPincode, 'Performance by PIN Code', 'pincode')}
          </div>
        )}
      </div>
    
  );
}

