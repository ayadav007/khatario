'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Edit, Loader2, Package, Hash, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BatchManager } from '@/components/inventory/BatchManager';
import { SerialManager } from '@/components/inventory/SerialManager';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle } from 'lucide-react';

// Valuation Tab Component
function ValuationTab({ itemId, item, businessId }: { itemId: string; item: any; businessId?: string }) {
  const [valuationData, setValuationData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchValuation = useCallback(async () => {
    if (!businessId || !itemId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemId}/valuation?business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setValuationData(data);
      }
    } catch (error) {
      console.error('Error fetching valuation:', error);
    } finally {
      setLoading(false);
    }
  }, [businessId, itemId]);

  useEffect(() => {
    if (businessId && itemId) {
      fetchValuation();
    }
  }, [businessId, itemId, fetchValuation]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!valuationData) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <p>Unable to load valuation data</p>
      </div>
    );
  }

  const { valuation, batches, serials } = valuationData;
  const methodLabels: Record<string, string> = {
    simple: 'Simple (Purchase Price)',
    fifo: 'FIFO (First In First Out)',
    lifo: 'LIFO (Last In First Out)',
    weighted_avg: 'Weighted Average',
  };

  // Check for expiring batches (within 30 days)
  const today = new Date();
  const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringBatches = batches?.filter((batch: any) => {
    if (!batch.expiry_date) return false;
    const expiryDate = new Date(batch.expiry_date);
    return expiryDate <= thirtyDaysFromNow && expiryDate >= today;
  }) || [];

  const expiredBatches = batches?.filter((batch: any) => {
    if (!batch.expiry_date) return false;
    return new Date(batch.expiry_date) < today;
  }) || [];

  return (
    <div className="space-y-6">
      {/* Valuation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="p-4">
            <label className="text-sm font-medium text-text-secondary">Valuation Method</label>
            <p className="mt-1 text-lg font-semibold text-text-primary">
              {methodLabels[valuation.method] || valuation.method.toUpperCase()}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <label className="text-sm font-medium text-text-secondary">Total Stock Value</label>
            <p className="mt-1 text-lg font-semibold text-primary-600">
              ₹{valuation.total_value.toFixed(2)}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {valuation.current_stock} {item.unit} × ₹{valuation.unit_cost.toFixed(2)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <label className="text-sm font-medium text-text-secondary">Average Unit Cost</label>
            <p className="mt-1 text-lg font-semibold text-text-primary">
              ₹{valuation.average_cost.toFixed(2)}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {valuation.method === 'simple' ? 'Purchase Price' : 'Calculated Average'}
            </p>
          </div>
        </Card>
      </div>

      {/* Expiry Alerts */}
      {(expiringBatches.length > 0 || expiredBatches.length > 0) && (
        <Card className="border-yellow-200 bg-yellow-50">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-yellow-900">Batch Expiry Alerts</h3>
                {expiredBatches.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-red-700">
                      {expiredBatches.length} Batch(es) Expired:
                    </p>
                    <ul className="mt-1 space-y-1">
                      {expiredBatches.slice(0, 3).map((batch: any) => (
                        <li key={batch.id} className="text-sm text-red-600">
                          • {batch.batch_number} - Expired on {format(new Date(batch.expiry_date), 'dd MMM yyyy')}
                          {' '}(Qty: {batch.quantity})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {expiringBatches.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-yellow-700">
                      {expiringBatches.length} Batch(es) Expiring Soon (within 30 days):
                    </p>
                    <ul className="mt-1 space-y-1">
                      {expiringBatches.slice(0, 3).map((batch: any) => (
                        <li key={batch.id} className="text-sm text-yellow-600">
                          • {batch.batch_number} - Expires on {format(new Date(batch.expiry_date), 'dd MMM yyyy')}
                          {' '}(Qty: {batch.quantity})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Batch Breakdown */}
      {item.track_batch && batches && batches.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Batch Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Batch Number</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Quantity</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Unit Cost</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Batch Value</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Manufacturing</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Expiry</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {batches.map((batch: any) => {
                    const isExpired = batch.expiry_date && new Date(batch.expiry_date) < today;
                    const isExpiring = batch.expiry_date && 
                      new Date(batch.expiry_date) <= thirtyDaysFromNow && 
                      new Date(batch.expiry_date) >= today;
                    
                    return (
                      <tr key={batch.id} className={isExpired ? 'bg-red-50' : isExpiring ? 'bg-yellow-50' : ''}>
                        <td className="px-4 py-2 font-medium text-gray-900">{batch.batch_number}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{batch.quantity} {item.unit}</td>
                        <td className="px-4 py-2 text-right text-gray-600">₹{batch.purchase_price.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">
                          ₹{batch.batch_value.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {batch.manufacturing_date ? format(new Date(batch.manufacturing_date), 'dd MMM yyyy') : '-'}
                        </td>
                        <td className="px-4 py-2">
                          {batch.expiry_date ? (
                            <span className={isExpired ? 'text-red-600 font-medium' : isExpiring ? 'text-yellow-600 font-medium' : 'text-gray-600'}>
                              {format(new Date(batch.expiry_date), 'dd MMM yyyy')}
                              {isExpired && ' (Expired)'}
                              {isExpiring && ' (Expiring Soon)'}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{batch.location_name || 'Main'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <td className="px-4 py-2 font-semibold text-gray-900">Total</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">
                      {batches.reduce((sum: number, b: any) => sum + b.quantity, 0).toFixed(2)} {item.unit}
                    </td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right font-semibold text-primary-600">
                      ₹{batches.reduce((sum: number, b: any) => sum + b.batch_value, 0).toFixed(2)}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Serial Summary */}
      {item.track_serial && serials && (
        <Card>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Serial Number Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium text-text-secondary">Total Serials</label>
                <p className="mt-1 text-xl font-semibold text-text-primary">{serials.length}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Available</label>
                <p className="mt-1 text-xl font-semibold text-green-600">
                  {serials.filter((s: any) => s.status === 'available').length}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Sold</label>
                <p className="mt-1 text-xl font-semibold text-primary-600">
                  {serials.filter((s: any) => s.status === 'sold').length}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Other</label>
                <p className="mt-1 text-xl font-semibold text-gray-600">
                  {serials.filter((s: any) => !['available', 'sold'].includes(s.status)).length}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Link to Reports */}
      <div className="text-center py-4">
        <p className="text-sm text-text-secondary">
          View comprehensive stock valuation reports in{' '}
          <a href="/reports/stock/valuation" className="text-primary-600 hover:underline font-medium">
            Reports → Stock Valuation
          </a>
        </p>
      </div>
    </div>
  );
}

export default function ItemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;
  const { business } = useAuth();

  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'batches' | 'serials' | 'valuation'>('details');

  const fetchItem = useCallback(async () => {
    if (!business?.id || !itemId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemId}?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setItem(data.item);
      } else {
        router.push('/items');
      }
    } catch (error) {
      console.error('Error fetching item:', error);
      router.push('/items');
    } finally {
      setLoading(false);
    }
  }, [business?.id, itemId, router]);

  useEffect(() => {
    if (itemId && business?.id) {
      fetchItem();
    }
  }, [itemId, business?.id, fetchItem]);

  useMobileHeaderTitleOverride(item?.name);

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!item) {
    return (
      
        <div className="text-center py-12">
          <p className="text-gray-500">Item not found</p>
          <Button variant="ghost" onClick={() => router.push('/items')} className="mt-4">
            Back to Items
          </Button>
        </div>
      
    );
  }

  const itemSubtitle = [
    item.code ? `Code: ${item.code}` : null,
    item.barcode ? `Barcode: ${item.barcode}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        <Breadcrumbs customLabels={{ [`/items/${itemId}`]: item?.name || 'Item Details' }} />

        <MobileDuplicatePageChrome
          className="mb-0"
          title={item.name}
          description={itemSubtitle || undefined}
          trailing={
            <Button variant="secondary" onClick={() => router.push(`/items/new?edit=${itemId}`)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Item
            </Button>
          }
        />

        {/* Tabs */}
        <Card padding="none">
          <div className="border-b border-border">
            <div className="flex">
              {[
                { id: 'details', label: 'Details', icon: Package },
                { id: 'batches', label: 'Batches', icon: Package, show: item.track_batch },
                { id: 'serials', label: 'Serials', icon: Hash, show: item.track_serial },
                { id: 'valuation', label: 'Valuation', icon: TrendingUp, show: item.track_batch || item.track_serial },
              ]
                .filter((tab) => tab.show !== false)
                .map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`px-6 py-3 text-sm font-medium transition-colors flex items-center gap-2 ${
                        activeTab === tab.id
                          ? 'text-primary-500 border-b-2 border-primary-500'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'details' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Item Name</label>
                  <p className="mt-1 text-text-primary">{item.name}</p>
                </div>
                {item.code && (
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Item Code</label>
                    <p className="mt-1 text-text-primary">{item.code}</p>
                  </div>
                )}
                {item.barcode && (
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Barcode</label>
                    <p className="mt-1 text-text-primary font-mono">{item.barcode}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium text-text-secondary">Unit</label>
                  <p className="mt-1 text-text-primary">{item.unit}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-secondary">Item Type</label>
                  <p className="mt-1 text-text-primary capitalize">{item.item_type || 'goods'}</p>
                </div>
                {item.item_type === 'goods' && (
                  <>
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Current Stock</label>
                      <p className="mt-1 text-lg font-semibold text-text-primary">
                        {item.current_stock} {item.unit}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Purchase Price</label>
                      <p className="mt-1 text-text-primary">₹{Number(item.purchase_price || 0).toFixed(2)}</p>
                    </div>
                    {item.selling_price && (
                      <div>
                        <label className="text-sm font-medium text-text-secondary">Selling Price</label>
                        <p className="mt-1 text-text-primary">₹{Number(item.selling_price).toFixed(2)}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Low Stock Alert</label>
                      <p className="mt-1 text-text-primary">{item.min_stock || 0} {item.unit}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Track Batch</label>
                      <p className="mt-1 text-text-primary">{item.track_batch ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Track Serial</label>
                      <p className="mt-1 text-text-primary">{item.track_serial ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text-secondary">Valuation Method</label>
                      <p className="mt-1 text-text-primary uppercase">
                        {item.valuation_method === 'fifo' && 'FIFO (First In First Out)'}
                        {item.valuation_method === 'lifo' && 'LIFO (Last In First Out)'}
                        {item.valuation_method === 'weighted_avg' && 'Weighted Average'}
                        {item.valuation_method === 'simple' && 'Simple'}
                      </p>
                    </div>
                  </>
                )}
                {item.hsn_sac && (
                  <div>
                    <label className="text-sm font-medium text-text-secondary">HSN/SAC Code</label>
                    <p className="mt-1 text-text-primary">{item.hsn_sac}</p>
                  </div>
                )}
                {item.description && (
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-text-secondary">Description</label>
                    <p className="mt-1 text-text-primary">{item.description}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'batches' && item.track_batch && (
              <BatchManager key="batches" itemId={itemId} />
            )}

            {activeTab === 'serials' && item.track_serial && (
              <SerialManager key="serials" itemId={itemId} />
            )}

            {activeTab === 'valuation' && (item.track_batch || item.track_serial) && (
              <ValuationTab key="valuation" itemId={itemId} item={item} businessId={business?.id} />
            )}
          </div>
        </Card>
      </div>
    
  );
}
