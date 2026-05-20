'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Loader2, AlertCircle, Info, CheckCircle } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

type AdjustmentType = 'QUANTITY' | 'VALUE';
type AdjustmentDirection = 'INCREASE' | 'DECREASE';
type ReasonCode = 
  | 'STOCK_TAKE'
  | 'DAMAGE'
  | 'THEFT'
  | 'EXPIRED'
  | 'FREE_SAMPLE'
  | 'COST_CORRECTION'
  | 'LANDED_COST'
  | 'REVALUATION'
  | 'WRITE_DOWN';

interface Location {
  id: string;
  name: string;
  location_code?: string;
}

interface ItemInfo {
  id: string;
  name: string;
  code?: string;
  current_stock: number;
  purchase_price: number;
  unit: string;
  has_variants?: boolean;
  variants?: any[];
}

export default function NewInventoryAdjustmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'inventory_adjustments',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehousesEnabled, setWarehousesEnabled] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemInfo | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [formData, setFormData] = useState({
    adjustment_type: 'QUANTITY' as AdjustmentType,
    adjustment_date: format(new Date(), 'yyyy-MM-dd'),
    item_id: '',
    variant_id: '',
    location_id: '',
    direction: 'INCREASE' as AdjustmentDirection,
    quantity: '',
    value_change: '',
    reason_code: 'STOCK_TAKE' as ReasonCode,
    reason_notes: '',
    notes: '',
    gst_impact: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (business?.id) {
      fetchLocations();
      checkWarehousesEnabled();
    }
  }, [business?.id]);

  const fetchLocations = async () => {
    try {
      const res = await fetch(`/api/locations?business_id=${business!.id}`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const checkWarehousesEnabled = async () => {
    try {
      const res = await fetch(`/api/settings/warehouses?business_id=${business!.id}`);
      if (res.ok) {
        const data = await res.json();
        setWarehousesEnabled(data.warehouses_enabled || false);
      }
    } catch (error) {
      console.error('Error checking warehouses setting:', error);
    }
  };

  const handleItemSelect = (item: any) => {
    setSelectedItem({
      id: item.id,
      name: item.name,
      code: item.code,
      current_stock: Number(item.current_stock) || 0,
      purchase_price: Number(item.purchase_price) || 0,
      unit: item.unit || 'PCS',
      has_variants: item.has_variants,
      variants: item.variants
    });
    setSelectedVariant(null);
    setFormData(prev => ({
      ...prev,
      item_id: item.id,
      variant_id: ''
    }));
  };

  useEffect(() => {
    const itemId = searchParams.get('item_id');
    if (!itemId || !business?.id || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/items/${itemId}?business_id=${business.id}&user_id=${user.id}`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.item && !cancelled) {
          handleItemSelect(data.item);
        }
      } catch {
        /* optional preload */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, business?.id, user?.id]);

  const handleVariantSelect = (variant: any) => {
    if (!selectedItem) return;
    
    setSelectedVariant(variant);
    setFormData(prev => ({
      ...prev,
      variant_id: variant.id
    }));
  };

  const getCurrentStock = (): number => {
    if (selectedVariant) {
      const stock = selectedVariant.current_stock;
      return stock != null ? Number(stock) : 0;
    }
    if (selectedItem) {
      const stock = selectedItem.current_stock;
      return stock != null ? Number(stock) : 0;
    }
    return 0;
  };

  const getCurrentUnitCost = (): number => {
    if (selectedVariant) {
      const price = selectedVariant.purchase_price || selectedVariant.selling_price;
      return price != null ? Number(price) : 0;
    }
    if (selectedItem) {
      const price = selectedItem.purchase_price;
      return price != null ? Number(price) : 0;
    }
    return 0;
  };

  const getCurrentTotalValue = (): number => {
    return getCurrentStock() * getCurrentUnitCost();
  };

  const calculateNewValues = () => {
    if (formData.adjustment_type === 'QUANTITY') {
      const quantity = parseFloat(formData.quantity) || 0;
      const direction = formData.direction;
      const currentStock = getCurrentStock();
      const unitCost = getCurrentUnitCost();
      
      const quantityChange = direction === 'INCREASE' ? quantity : -quantity;
      const newQuantity = currentStock + quantityChange;
      const valueChange = quantityChange * unitCost;
      const newTotalValue = newQuantity * unitCost;
      
      return {
        quantityBefore: currentStock,
        quantityAfter: newQuantity,
        unitCostBefore: unitCost,
        unitCostAfter: unitCost,
        totalValueBefore: currentStock * unitCost,
        totalValueAfter: newTotalValue,
        valueChange
      };
    } else {
      const valueChange = parseFloat(formData.value_change) || 0;
      const currentStock = getCurrentStock();
      const currentTotalValue = getCurrentTotalValue();
      
      if (currentStock === 0) {
        return null; // Cannot adjust value when quantity is zero
      }
      
      const newTotalValue = currentTotalValue + valueChange;
      const newUnitCost = newTotalValue / currentStock;
      
      return {
        quantityBefore: currentStock,
        quantityAfter: currentStock,
        unitCostBefore: getCurrentUnitCost(),
        unitCostAfter: newUnitCost,
        totalValueBefore: currentTotalValue,
        totalValueAfter: newTotalValue,
        valueChange
      };
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.item_id) {
      newErrors.item_id = 'Please select an item';
    }

    if (formData.adjustment_type === 'QUANTITY') {
      if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
        newErrors.quantity = 'Quantity must be greater than zero';
      }
      if (!formData.direction) {
        newErrors.direction = 'Please select direction';
      }
    } else {
      if (!formData.value_change || parseFloat(formData.value_change) === 0) {
        newErrors.value_change = 'Value change cannot be zero';
      }
      if (getCurrentStock() === 0) {
        newErrors.value_change = 'Cannot adjust value when quantity is zero';
      }
    }

    if (!formData.reason_code) {
      newErrors.reason_code = 'Please select a reason';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    const calculated = calculateNewValues();
    if (!calculated) {
      toast.error('Cannot calculate adjustment values');
      return;
    }

    // Check for negative quantity
    if (calculated.quantityAfter < 0) {
      toast.error('Quantity cannot go below zero');
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        business_id: business!.id,
        adjustment_type: formData.adjustment_type,
        adjustment_date: formData.adjustment_date,
        item_id: formData.item_id,
        reason_code: formData.reason_code,
        reason_notes: formData.reason_notes || undefined,
        notes: formData.notes || undefined,
        created_by: user?.id
      };

      if (formData.variant_id) {
        payload.variant_id = formData.variant_id;
      }

      if (warehousesEnabled && formData.location_id) {
        payload.location_id = formData.location_id;
      }

      if (formData.adjustment_type === 'QUANTITY') {
        payload.direction = formData.direction;
        payload.quantity = parseFloat(formData.quantity);
      } else {
        payload.value_change = parseFloat(formData.value_change);
        if (formData.gst_impact) {
          payload.gst_impact = parseFloat(formData.gst_impact);
        }
      }

      const res = await fetch('/api/inventory-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Adjustment ${data.adjustment.adjustmentNumber} created successfully! Stock updated from ${calculated.quantityBefore.toFixed(3)} to ${calculated.quantityAfter.toFixed(3)}.`);
        // Small delay to ensure database commit is complete
        setTimeout(() => {
          router.push('/inventory-adjustments');
          // Force refresh the items page if it's open
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('inventory-updated'));
          }
        }, 100);
      } else {
        const errorData = await safeJsonParse(res);
        toast.error(getApiErrorMessage(errorData, 'Failed to create adjustment'));
      }
    } catch (error: any) {
      console.error('Error creating adjustment:', error);
      toast.error(error.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
      setShowConfirmModal(false);
    }
  };

  const reasonCodeOptions: { value: ReasonCode; label: string; description: string }[] = [
    { value: 'STOCK_TAKE', label: 'Stock Take', description: 'Physical stock count correction' },
    { value: 'DAMAGE', label: 'Damage', description: 'Items damaged or broken' },
    { value: 'THEFT', label: 'Theft', description: 'Items stolen or missing' },
    { value: 'EXPIRED', label: 'Expired', description: 'Items past expiry date' },
    { value: 'FREE_SAMPLE', label: 'Free Sample', description: 'Given as free sample' },
    { value: 'COST_CORRECTION', label: 'Cost Correction', description: 'Correcting purchase cost entry' },
    { value: 'LANDED_COST', label: 'Landed Cost', description: 'Adding freight/landed costs' },
    { value: 'REVALUATION', label: 'Revaluation', description: 'Inventory revaluation' },
    { value: 'WRITE_DOWN', label: 'Write Down', description: 'Inventory write-down' }
  ];

  const calculated = calculateNewValues();
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="items"
          action="create"
          details={reason}
          code="INVENTORY_ADJUSTMENT_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title="New adjustment"
          description="Adjust inventory quantity or value"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <div className="p-6 space-y-6">
                {/* Adjustment Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Adjustment Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.adjustment_type}
                    onChange={(e) => {
                      setFormData(prev => ({
                        ...prev,
                        adjustment_type: e.target.value as AdjustmentType,
                        quantity: '',
                        value_change: ''
                      }));
                      setErrors({});
                    }}
                  >
                    <option value="QUANTITY">Quantity Adjustment</option>
                    <option value="VALUE">Value Adjustment</option>
                  </select>
                  {formData.adjustment_type === 'QUANTITY' && (
                    <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Quantity adjustments affect stock count
                    </p>
                  )}
                  {formData.adjustment_type === 'VALUE' && (
                    <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Value adjustments affect unit cost
                    </p>
                  )}
                </div>

                {/* Adjustment Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Adjustment Date <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="date"
                    value={formData.adjustment_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, adjustment_date: e.target.value }))}
                  />
                </div>

                {/* Item Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Item <span className="text-red-500">*</span>
                  </label>
                  <ItemAutocomplete
                    value={selectedItem?.name || ''}
                    onChange={() => {}}
                    onSelect={handleItemSelect}
                    placeholder="Search and select item..."
                  />
                  {errors.item_id && (
                    <p className="mt-1 text-xs text-red-600">{errors.item_id}</p>
                  )}
                </div>

                {/* Variant Selection */}
                {selectedItem?.has_variants && selectedItem.variants && selectedItem.variants.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Variant (Optional)
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={formData.variant_id}
                      onChange={(e) => {
                        const variant = selectedItem.variants?.find(v => v.id === e.target.value);
                        if (variant) {
                          handleVariantSelect(variant);
                        } else {
                          setSelectedVariant(null);
                          setFormData(prev => ({ ...prev, variant_id: '' }));
                        }
                      }}
                    >
                      <option value="">Base Item (No Variant)</option>
                      {selectedItem.variants.map((variant: any) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.variant_name} (Stock: {variant.current_stock || 0})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Location Selection (if warehouses enabled) */}
                {warehousesEnabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location (Optional)
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={formData.location_id}
                      onChange={(e) => setFormData(prev => ({ ...prev, location_id: e.target.value }))}
                    >
                      <option value="">All Locations</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name} {location.location_code && `(${location.location_code})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Quantity Adjustment Fields */}
                {formData.adjustment_type === 'QUANTITY' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Direction <span className="text-red-500">*</span>
                      </label>
                      <select
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        value={formData.direction}
                        onChange={(e) => setFormData(prev => ({ ...prev, direction: e.target.value as AdjustmentDirection }))}
                      >
                        <option value="INCREASE">Increase</option>
                        <option value="DECREASE">Decrease</option>
                      </select>
                      {errors.direction && (
                        <p className="mt-1 text-xs text-red-600">{errors.direction}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Quantity <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={formData.quantity}
                        onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                        placeholder="Enter quantity"
                      />
                      {errors.quantity && (
                        <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>
                      )}
                    </div>
                  </>
                )}

                {/* Value Adjustment Fields */}
                {formData.adjustment_type === 'VALUE' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Value Change <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-gray-500">₹</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.value_change}
                          onChange={(e) => setFormData(prev => ({ ...prev, value_change: e.target.value }))}
                          placeholder="Enter value change (positive or negative)"
                          className="pl-8"
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Positive value increases inventory value, negative decreases it
                      </p>
                      {errors.value_change && (
                        <p className="mt-1 text-xs text-red-600">{errors.value_change}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        GST Impact (Optional)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-gray-500">₹</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.gst_impact}
                          onChange={(e) => setFormData(prev => ({ ...prev, gst_impact: e.target.value }))}
                          placeholder="Enter GST impact"
                          className="pl-8"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Reason Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.reason_code}
                    onChange={(e) => setFormData(prev => ({ ...prev, reason_code: e.target.value as ReasonCode }))}
                  >
                    {reasonCodeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {reasonCodeOptions.find(o => o.value === formData.reason_code)?.description}
                  </p>
                  {errors.reason_code && (
                    <p className="mt-1 text-xs text-red-600">{errors.reason_code}</p>
                  )}
                </div>

                {/* Reason Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason Notes
                  </label>
                  <textarea
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    rows={3}
                    value={formData.reason_notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, reason_notes: e.target.value }))}
                    placeholder="Additional details about the reason..."
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes (Optional)
                  </label>
                  <textarea
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Summary Panel */}
          <div className="lg:col-span-1">
            <Card>
              <div className="p-6 space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Current Status</h3>
                
                {selectedItem ? (
                  <>
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs text-gray-500">Item</p>
                        <p className="text-sm font-medium text-gray-900">
                          {selectedItem.name}
                          {selectedVariant && ` - ${selectedVariant.variant_name}`}
                        </p>
                        {selectedItem.code && (
                          <p className="text-xs text-gray-500">Code: {selectedItem.code}</p>
                        )}
                      </div>

                      <div className="border-t pt-4 space-y-3">
                        <div>
                          <p className="text-xs text-gray-500">Current Stock</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {getCurrentStock().toFixed(3)} {selectedItem.unit}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500">Unit Cost</p>
                          <p className="text-lg font-semibold text-gray-900">
                            ₹{getCurrentUnitCost().toFixed(2)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500">Total Value</p>
                          <p className="text-lg font-semibold text-primary-600">
                            ₹{getCurrentTotalValue().toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {calculated && (
                        <div className="border-t pt-4 space-y-3 bg-gray-50 p-4 rounded-lg">
                          <h4 className="text-sm font-semibold text-gray-900">After Adjustment</h4>
                          
                          <div>
                            <p className="text-xs text-gray-500">Stock</p>
                            <p className="text-sm font-medium text-gray-900">
                              {calculated.quantityAfter.toFixed(3)} {selectedItem.unit}
                              {calculated.quantityAfter !== calculated.quantityBefore && (
                                <span className={`ml-2 text-xs ${calculated.quantityAfter > calculated.quantityBefore ? 'text-green-600' : 'text-red-600'}`}>
                                  ({calculated.quantityAfter > calculated.quantityBefore ? '+' : ''}
                                  {(calculated.quantityAfter - calculated.quantityBefore).toFixed(3)})
                                </span>
                              )}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-gray-500">Unit Cost</p>
                            <p className="text-sm font-medium text-gray-900">
                              ₹{calculated.unitCostAfter.toFixed(2)}
                              {calculated.unitCostAfter !== calculated.unitCostBefore && (
                                <span className={`ml-2 text-xs ${calculated.unitCostAfter > calculated.unitCostBefore ? 'text-green-600' : 'text-red-600'}`}>
                                  ({calculated.unitCostAfter > calculated.unitCostBefore ? '+' : ''}
                                  {(calculated.unitCostAfter - calculated.unitCostBefore).toFixed(2)})
                                </span>
                              )}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-gray-500">Total Value</p>
                            <p className="text-sm font-semibold text-primary-600">
                              ₹{calculated.totalValueAfter.toFixed(2)}
                              {calculated.totalValueAfter !== calculated.totalValueBefore && (
                                <span className={`ml-2 text-xs ${calculated.totalValueAfter > calculated.totalValueBefore ? 'text-green-600' : 'text-red-600'}`}>
                                  ({calculated.totalValueAfter > calculated.totalValueBefore ? '+' : ''}
                                  {(calculated.totalValueAfter - calculated.totalValueBefore).toFixed(2)})
                                </span>
                              )}
                            </p>
                          </div>

                          {calculated.quantityAfter < 0 && (
                            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                              <AlertCircle className="w-4 h-4 inline mr-1" />
                              Warning: Quantity will go below zero!
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    <Info className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p>Select an item to see current status</p>
                  </div>
                )}

                <div className="border-t pt-4">
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (validateForm() && calculated && calculated.quantityAfter >= 0) {
                        setShowConfirmModal(true);
                      }
                    }}
                    disabled={loading || !selectedItem || (calculated?.quantityAfter || 0) < 0}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Adjustment'
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Confirmation Modal */}
        {showConfirmModal && calculated && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Adjustment</h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Type:</span>
                  <span className="text-sm font-medium">{formData.adjustment_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Item:</span>
                  <span className="text-sm font-medium">{selectedItem?.name}</span>
                </div>
                {formData.adjustment_type === 'QUANTITY' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Direction:</span>
                      <span className="text-sm font-medium">{formData.direction}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Quantity:</span>
                      <span className="text-sm font-medium">{formData.quantity} {selectedItem?.unit}</span>
                    </div>
                  </>
                )}
                {formData.adjustment_type === 'VALUE' && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Value Change:</span>
                    <span className="text-sm font-medium">₹{formData.value_change}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Reason:</span>
                  <span className="text-sm font-medium">
                    {reasonCodeOptions.find(o => o.value === formData.reason_code)?.label}
                  </span>
                </div>
                <div className="border-t pt-3 mt-3">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-700">New Stock:</span>
                    <span className="text-sm font-semibold">{calculated.quantityAfter.toFixed(3)} {selectedItem?.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-700">New Total Value:</span>
                    <span className="text-sm font-semibold text-primary-600">₹{calculated.totalValueAfter.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowConfirmModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Confirm'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    
  );
}
