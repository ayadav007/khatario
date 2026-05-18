'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Trash2, Package } from 'lucide-react';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface Warehouse {
  id: string;
  name: string;
  warehouse_code: string | null;
}

interface TransferItem {
  item_id: string;
  item_name: string;
  qty: number;
  unit: string;
  notes?: string;
}

export default function NewStockTransferPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const [saving, setSaving] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [items, setItems] = useState<TransferItem[]>([]);
  
  // Check if multi_warehouse feature is enabled
  const hasWarehouseAccess = hasFeature('multi_warehouse') || hasFeature('settings_multi_warehouse');
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'warehouse_transfer',
    action: 'create',
    skipCheck: !user?.id || !business?.id || !hasWarehouseAccess
  });

  const [formData, setFormData] = useState({
    transfer_number: '',
    transfer_date: format(new Date(), 'yyyy-MM-dd'),
    from_location_id: '',
    to_location_id: '',
    notes: '',
  });

  useEffect(() => {
    if (business?.id && user?.id && hasWarehouseAccess) {
      fetchWarehouses();
      // Generate transfer number
      generateTransferNumber();
    }
  }, [business, user, hasWarehouseAccess]);

  async function fetchWarehouses() {
    if (!business?.id || !user?.id) return;

    try {
      const response = await fetch(`/api/warehouses?business_id=${business.id}&user_id=${user.id}`);
      
      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        if (
          response.status === 403 &&
          (errorData?.code === 'FEATURE_NOT_IN_PLAN' || errorData?.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        throw new Error(getApiErrorMessage(errorData, 'Failed to fetch warehouses'));
      }
      
      const data = await response.json();
      setWarehouses(data.warehouses || []);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    } finally {
      setLoadingWarehouses(false);
    }
  }

  function generateTransferNumber() {
    // Generate transfer number: TRF-YYYYMMDD-001 format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // For now, use a simple format. In production, you might want to query the database
    // to get the next sequence number for the day
    const transferNumber = `TRF-${dateStr}-001`;
    setFormData(prev => ({ ...prev, transfer_number: transferNumber }));
  }

  function handleChange(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function handleAddItem() {
    setItems([...items, { item_id: '', item_name: '', qty: 1, unit: 'PCS' }]);
  }

  function handleRemoveItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function handleItemSelect(item: any, index: number) {
    const newItems = [...items];
    newItems[index] = {
      item_id: item.id,
      item_name: item.name,
      qty: newItems[index].qty || 1,
      unit: item.unit || 'PCS',
      notes: newItems[index].notes,
    };
    setItems(newItems);
  }

  function handleItemChange(index: number, field: string, value: string | number) {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business || !user) return;
    
    // Validation
    if (!formData.from_location_id || !formData.to_location_id) {
      toast.error('Please select both source and destination warehouses');
      return;
    }

    if (formData.from_location_id === formData.to_location_id) {
      toast.error('Source and destination warehouses cannot be the same');
      return;
    }

    if (items.length === 0) {
      toast.error('Please add at least one item to transfer');
      return;
    }

    // Validate all items have item_id and qty > 0
    for (const item of items) {
      if (!item.item_id) {
        toast.error('Please select an item for all rows');
        return;
      }
      if (item.qty <= 0) {
        toast.error('Quantity must be greater than 0');
        return;
      }
    }
    
    setSaving(true);

    try {
      const response = await fetch('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          business_id: business.id,
          created_by: user.id,
          items: items.map(item => ({
            item_id: item.item_id,
            qty: item.qty,
            unit: item.unit,
            notes: item.notes || null,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        
        // Check if this is a feature access error
        if (
          response.status === 403 &&
          (errorData?.code === 'FEATURE_NOT_IN_PLAN' || errorData?.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        
        throw new Error(getApiErrorMessage(errorData, 'Failed to create transfer'));
      }

      const data = await response.json();
      toast.success('Stock transfer created successfully!');
      router.push('/stock-transfers');
    } catch (error: any) {
      console.error('Error creating transfer:', error);
      toast.error(error.message || 'Failed to create transfer. Please try again.');
    } finally {
      setSaving(false);
    }
  }
  
  // Show loading state while checking authorization or features
  if (authLoading || featuresLoading || loadingWarehouses) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show upgrade prompt if warehouse feature is not available
  if (!hasWarehouseAccess) {
    return (
      <>
        <UpgradePrompt
          limitType="feature"
          featureName="Stock Transfers"
          featureKey="settings_multi_warehouse"
          onClose={() => router.push('/stock-transfers')}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      </>
    );
  }

  // Show authorization denied if user cannot create (PBAC failure)
  if (!canCreate) {
    return (
      <AccessDenied
        module="warehouse_transfer"
        action="create"
        details={reason}
        code="TRANSFER_CREATE_DENIED"
      />
    );
  }

  return (
    <FormPageContainer className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link
          href="/stock-transfers"
          className="p-2 hover:bg-surface rounded-lg transition border border-border"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">New Stock Transfer</h1>
          <p className="text-text-secondary text-sm mt-1">Transfer inventory between warehouses</p>
        </div>
      </div>

      <FormCard>
      <form onSubmit={handleSubmit}>
      <div className="form-page-shell">
        <FormSection title="Transfer details" description="Number, date, source and destination warehouses, and optional notes.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
            <Input
              label="Transfer Number *"
              value={formData.transfer_number}
              onChange={(e) => handleChange('transfer_number', e.target.value)}
              placeholder="TRF-YYYYMMDD-001"
              required
            />
            <Input
              label="Transfer Date *"
              type="date"
              value={formData.transfer_date}
              onChange={(e) => handleChange('transfer_date', e.target.value)}
              required
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                From Warehouse *
              </label>
              <select
                className="input w-full"
                value={formData.from_location_id}
                onChange={(e) => handleChange('from_location_id', e.target.value)}
                required
              >
                <option value="">Select source warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} {warehouse.warehouse_code ? `(${warehouse.warehouse_code})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                To Warehouse *
              </label>
              <select
                className="input w-full"
                value={formData.to_location_id}
                onChange={(e) => handleChange('to_location_id', e.target.value)}
                required
              >
                <option value="">Select destination warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} {warehouse.warehouse_code ? `(${warehouse.warehouse_code})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Notes
              </label>
              <textarea
                className="input w-full"
                rows={3}
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="Optional notes about this transfer"
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Line items" description="Add goods to move; quantities must be positive.">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <span className="sr-only">Items</span>
            <Button
              type="button"
              onClick={handleAddItem}
              className="flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Item</span>
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
              <Package className="w-12 h-12 text-text-secondary/60 mx-auto mb-2" />
              <p className="text-text-secondary">No items added</p>
              <Button
                type="button"
                onClick={handleAddItem}
                className="mt-4"
                variant="outline"
              >
                Add First Item
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-text-primary">Item {index + 1}</h3>
                    <Button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Item *
                      </label>
                      <ItemAutocomplete
                        value={item.item_name}
                        onChange={(val) => handleItemChange(index, 'item_name', val)}
                        onSelect={(selectedItem) => handleItemSelect(selectedItem, index)}
                        placeholder="Search and select item"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Quantity *
                      </label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.qty}
                        onChange={(e) => handleItemChange(index, 'qty', parseFloat(e.target.value) || 0)}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Unit
                      </label>
                      <Input
                        value={item.unit}
                        onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                        placeholder="PCS"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Notes
                      </label>
                      <Input
                        value={item.notes || ''}
                        onChange={(e) => handleItemChange(index, 'notes', e.target.value)}
                        placeholder="Optional item notes"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </FormSection>
      </div>

        <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
          <Button
            type="button"
            onClick={() => router.push('/stock-transfers')}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || items.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              'Create Transfer'
            )}
          </Button>
        </div>
      </form>
      </FormCard>

      {/* Upgrade Prompt Modal */}
      {showUpgradePrompt && (
        <UpgradePrompt
          limitType="feature"
          featureName="Stock Transfers"
          featureKey="settings_multi_warehouse"
          onClose={() => setShowUpgradePrompt(false)}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      )}
    </FormPageContainer>
  );
}
