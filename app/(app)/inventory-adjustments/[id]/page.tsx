'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface Adjustment {
  id: string;
  adjustment_number: string;
  adjustment_date: string;
  adjustment_type: 'QUANTITY' | 'VALUE';
  direction?: 'INCREASE' | 'DECREASE';
  item_name: string;
  item_code?: string;
  variant_name?: string;
  location_name?: string;
  quantity_before: number;
  quantity_after: number;
  unit_cost_before: number;
  unit_cost_after: number;
  total_value_before: number;
  total_value_after: number;
  quantity_change?: number;
  value_change?: number;
  reason_code: string;
  reason_notes?: string;
  notes?: string;
  gst_impact?: number;
  journal_entry_id?: string;
  created_by_name?: string;
  created_at: string;
}

export default function AdjustmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { business } = useAuth();
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id && business?.id) {
      fetchAdjustment();
    }
  }, [params.id, business?.id]);

  const fetchAdjustment = async () => {
    try {
      const res = await fetch(`/api/inventory-adjustments/${params.id}?business_id=${business!.id}`);
      if (res.ok) {
        const data = await res.json();
        // Convert string numbers to actual numbers
        if (data.adjustment) {
          const adj = data.adjustment;
          setAdjustment({
            ...adj,
            quantity_before: Number(adj.quantity_before) || 0,
            quantity_after: Number(adj.quantity_after) || 0,
            unit_cost_before: Number(adj.unit_cost_before) || 0,
            unit_cost_after: Number(adj.unit_cost_after) || 0,
            total_value_before: Number(adj.total_value_before) || 0,
            total_value_after: Number(adj.total_value_after) || 0,
            quantity_change: adj.quantity_change ? Number(adj.quantity_change) : undefined,
            value_change: adj.value_change ? Number(adj.value_change) : undefined,
            gst_impact: adj.gst_impact ? Number(adj.gst_impact) : undefined,
          });
        } else {
          setAdjustment(null);
        }
      }
    } catch (error) {
      console.error('Error fetching adjustment:', error);
    } finally {
      setLoading(false);
    }
  };

  const reasonCodeLabels: Record<string, string> = {
    STOCK_TAKE: 'Stock Take',
    DAMAGE: 'Damage',
    THEFT: 'Theft',
    EXPIRED: 'Expired',
    FREE_SAMPLE: 'Free Sample',
    COST_CORRECTION: 'Cost Correction',
    LANDED_COST: 'Landed Cost',
    REVALUATION: 'Revaluation',
    WRITE_DOWN: 'Write Down'
  };

  if (loading) {
    return (
      
        <div className="p-8 text-center">Loading...</div>
      
    );
  }

  if (!adjustment) {
    return (
      
        <div className="p-8 text-center">
          <p className="text-gray-500 mb-4">Adjustment not found</p>
          <Button onClick={() => router.back()}>Go Back</Button>
        </div>
      
    );
  }

  const quantityChange = adjustment.quantity_after - adjustment.quantity_before;
  const valueChange = adjustment.total_value_after - adjustment.total_value_before;
  const unitCostChange = adjustment.unit_cost_after - adjustment.unit_cost_before;

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{adjustment.adjustment_number}</h1>
              <p className="text-sm text-gray-600 mt-1">
                {format(new Date(adjustment.adjustment_date), 'dd MMMM yyyy')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <div className="p-6 space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Adjustment Details</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Adjustment Type</p>
                    <p className="text-sm font-medium text-gray-900">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        adjustment.adjustment_type === 'QUANTITY'
                          ? 'bg-slate-100 text-primary-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {adjustment.adjustment_type}
                      </span>
                    </p>
                  </div>

                  {adjustment.adjustment_type === 'QUANTITY' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Direction</p>
                      <p className="text-sm font-medium text-gray-900">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          adjustment.direction === 'INCREASE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {adjustment.direction}
                        </span>
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Item</p>
                    <p className="text-sm font-medium text-gray-900">{adjustment.item_name}</p>
                    {adjustment.item_code && (
                      <p className="text-xs text-gray-500">Code: {adjustment.item_code}</p>
                    )}
                  </div>

                  {adjustment.variant_name && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Variant</p>
                      <p className="text-sm font-medium text-gray-900">{adjustment.variant_name}</p>
                    </div>
                  )}

                  {adjustment.location_name && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Location</p>
                      <p className="text-sm font-medium text-gray-900">{adjustment.location_name}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Reason</p>
                    <p className="text-sm font-medium text-gray-900">
                      {reasonCodeLabels[adjustment.reason_code] || adjustment.reason_code}
                    </p>
                  </div>

                  {adjustment.created_by_name && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Created By</p>
                      <p className="text-sm font-medium text-gray-900">{adjustment.created_by_name}</p>
                    </div>
                  )}
                </div>

                {adjustment.reason_notes && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Reason Notes</p>
                    <p className="text-sm text-gray-900">{adjustment.reason_notes}</p>
                  </div>
                )}

                {adjustment.notes && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <p className="text-sm text-gray-900">{adjustment.notes}</p>
                  </div>
                )}

                {adjustment.journal_entry_id && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Journal Entry</p>
                    <p className="text-sm text-gray-900">#{adjustment.journal_entry_id}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Before/After Comparison */}
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Before & After</h3>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Metric</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Before</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">After</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <tr>
                        <td className="px-4 py-3 font-medium text-gray-900">Quantity</td>
                        <td className="px-4 py-3 text-right text-gray-600">{adjustment.quantity_before.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{adjustment.quantity_after.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${
                          quantityChange > 0 ? 'text-green-600' : quantityChange < 0 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {quantityChange > 0 ? '+' : ''}{quantityChange.toFixed(2)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium text-gray-900">Unit Cost</td>
                        <td className="px-4 py-3 text-right text-gray-600">₹{adjustment.unit_cost_before.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">₹{adjustment.unit_cost_after.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${
                          unitCostChange > 0 ? 'text-green-600' : unitCostChange < 0 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {unitCostChange > 0 ? '+' : ''}₹{unitCostChange.toFixed(2)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium text-gray-900">Total Value</td>
                        <td className="px-4 py-3 text-right text-gray-600">₹{adjustment.total_value_before.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-medium text-primary-600">₹{adjustment.total_value_after.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${
                          valueChange > 0 ? 'text-green-600' : valueChange < 0 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {valueChange > 0 ? '+' : ''}₹{valueChange.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          </div>

          {/* Summary Sidebar */}
          <div className="lg:col-span-1">
            <Card>
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Summary</h3>
                
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Adjustment Number</span>
                    <span className="text-sm font-medium text-gray-900">{adjustment.adjustment_number}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Date</span>
                    <span className="text-sm font-medium text-gray-900">
                      {format(new Date(adjustment.adjustment_date), 'dd MMM yyyy')}
                    </span>
                  </div>

                  {adjustment.adjustment_type === 'QUANTITY' && adjustment.quantity_change && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Quantity Change</span>
                      <span className={`text-sm font-medium ${
                        adjustment.quantity_change > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {adjustment.quantity_change > 0 ? '+' : ''}{adjustment.quantity_change.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {adjustment.adjustment_type === 'VALUE' && adjustment.value_change && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Value Change</span>
                      <span className={`text-sm font-medium ${
                        adjustment.value_change > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {adjustment.value_change > 0 ? '+' : ''}₹{adjustment.value_change.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {adjustment.gst_impact && adjustment.gst_impact !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">GST Impact</span>
                      <span className="text-sm font-medium text-gray-900">
                        ₹{adjustment.gst_impact.toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="border-t pt-3">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-700">Current Stock</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {adjustment.quantity_after.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className="text-sm font-medium text-gray-700">Current Value</span>
                      <span className="text-sm font-semibold text-primary-600">
                        ₹{adjustment.total_value_after.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    
  );
}
