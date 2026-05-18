'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { HSNLookup } from '@/components/ui/HSNLookup';
import { X, Camera, Check, RefreshCw } from 'lucide-react';
import { validateBarcode, normalizeBarcode, generateRandomBarcode as generateBarcode } from '@/lib/barcode-validator';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

interface Item {
  id: string;
  name: string;
  code?: string;
  barcode?: string;
  unit: string;
  item_type: 'goods' | 'service';
  selling_price: number | null;
  purchase_price: number;
  tax_rate: number;
  hsn_sac?: string;
  current_stock: number;
}

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (item: Item) => void;
  initialData?: Partial<{
    name: string;
    code: string;
    barcode: string;
    unit: string;
    item_type: 'goods' | 'service';
    selling_price: string;
    purchase_price: string;
    tax_rate: string;
    hsn_sac: string;
  }>;
}

export function CreateItemModal({
  isOpen,
  onClose,
  onSuccess,
  initialData = {},
}: CreateItemModalProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeValid, setBarcodeValid] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const hasCheckedLimitsRef = useRef(false);
  const prevIsOpenRef = useRef(false);

  const [formData, setFormData] = useState({
    name: initialData.name || '',
    code: initialData.code || '',
    barcode: initialData.barcode || '',
    barcode_type: '',
    unit: initialData.unit || 'PCS',
    item_type: (initialData.item_type || 'goods') as 'goods' | 'service',
    selling_price: initialData.selling_price || '',
    purchase_price: initialData.purchase_price || '',
    tax_rate: initialData.tax_rate || '',
    hsn_sac: initialData.hsn_sac || '',
    opening_stock: '',
    min_stock: '',
    description: '',
    default_supplier_id: '',
    image_url: '',
    gst_included: false,
    mrp: '',
  });

  // Authorization check
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'items',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });

  // Reset form and check limits ONLY when modal opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setFormData({
        name: initialData.name || '',
        code: initialData.code || '',
        barcode: initialData.barcode || '',
        barcode_type: '',
        unit: initialData.unit || 'PCS',
        item_type: (initialData.item_type || 'goods') as 'goods' | 'service',
        selling_price: initialData.selling_price || '',
        purchase_price: initialData.purchase_price || '',
        tax_rate: initialData.tax_rate || '',
        hsn_sac: initialData.hsn_sac || '',
        opening_stock: '',
        min_stock: '',
        description: '',
        default_supplier_id: '',
        image_url: '',
        gst_included: false,
        mrp: '',
      });
      setBarcodeError(null);
      setBarcodeValid(false);
      setSelectedSupplier(null);
      setSupplierSearch('');
      hasCheckedLimitsRef.current = false;
      
      // Load suppliers
      if (business?.id) {
        fetchSuppliers();
        
        // Check subscription limits ONCE when modal opens
        if (!hasCheckedLimitsRef.current) {
          hasCheckedLimitsRef.current = true;
          fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=items`)
            .then(res => res.json())
            .then(data => {
              setLimitInfo({ current: data.current, limit: data.limit });
              if (!data.allowed) {
                setShowUpgradePrompt(true);
              }
            })
            .catch(err => console.error('Failed to check limits:', err));
        }
      }
    }
    
    if (!isOpen && prevIsOpenRef.current) {
      hasCheckedLimitsRef.current = false;
    }
    
    prevIsOpenRef.current = isOpen;
  }, [isOpen, business?.id]);

  // Close supplier dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.supplier-dropdown-container')) {
        setShowSupplierDropdown(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  async function fetchSuppliers() {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/suppliers?business_id=${business.id}`);
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleBarcodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = normalizeBarcode(e.target.value);
    setFormData({ ...formData, barcode: value });
    validateAndSetBarcode(value);
  };

  const validateAndSetBarcode = (value: string) => {
    if (!value) {
      setBarcodeError(null);
      setBarcodeValid(false);
      setFormData(prev => ({ ...prev, barcode_type: '' }));
      return;
    }
    
    const validation = validateBarcode(value);
    if (validation.isValid && validation.type) {
      setBarcodeError(null);
      setBarcodeValid(true);
      setFormData(prev => ({ ...prev, barcode_type: validation.type || '' }));
    } else {
      setBarcodeError(validation.error || 'Invalid barcode');
      setBarcodeValid(false);
      setFormData(prev => ({ ...prev, barcode_type: '' }));
    }
  };

  const handleBarcodeScan = (scannedBarcode: string) => {
    const normalized = normalizeBarcode(scannedBarcode);
    setFormData(prev => ({ ...prev, barcode: normalized }));
    validateAndSetBarcode(normalized);
    setShowBarcodeScanner(false);
  };

  const handleGenerateBarcode = () => {
    const newBarcode = generateBarcode();
    setFormData(prev => ({ ...prev, barcode: newBarcode }));
    validateAndSetBarcode(newBarcode);
  };

  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    supplier.phone?.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    supplier.email?.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !user) return;
    
    // Check subscription limits before creating item
    if (limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) {
      setShowUpgradePrompt(true);
      return;
    }
    
    setLoading(true);

    try {
      // Validate barcode before submission if provided
      if (formData.barcode) {
        const validation = validateBarcode(formData.barcode, formData.barcode_type as any);
        if (!validation.isValid) {
          setBarcodeError(validation.error || 'Invalid barcode');
          setLoading(false);
          return;
        }
      }

      const payload = {
        name: formData.name,
        code: formData.code || null,
        barcode: formData.barcode || null,
        barcode_type: formData.barcode_type || null,
        unit: formData.unit,
        item_type: formData.item_type,
        selling_price: formData.item_type === 'service'
          ? (formData.selling_price ? Number(formData.selling_price) : null)
          : (Number(formData.selling_price) || 0),
        purchase_price: Number(formData.purchase_price) || 0,
        tax_rate: Number(formData.tax_rate) || 0,
        hsn_sac: formData.hsn_sac || null,
        min_stock: formData.item_type === 'service' ? 0 : (Number(formData.min_stock) || 0),
        description: formData.description || null,
        default_supplier_id: formData.default_supplier_id || null,
        image_url: formData.image_url,
        has_variants: false,
        track_batch: false,
        track_serial: false,
        valuation_method: 'simple' as const,
        gst_included: formData.gst_included || false,
        mrp: formData.mrp ? Number(formData.mrp) : null,
        business_id: business.id,
        created_by: user.id,
        opening_stock: formData.item_type === 'service' ? 0 : (Number(formData.opening_stock) || 0),
        variants: []
      };

      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const item = data.item;
        
        // Transform to match ItemSearchResult format expected by invoice
        const itemResult = {
          id: item.id,
          name: item.name,
          code: item.code,
          barcode: item.barcode,
          unit: item.unit,
          item_type: item.item_type,
          selling_price: item.selling_price,
          purchase_price: item.purchase_price,
          tax_rate: item.tax_rate,
          hsn_sac: item.hsn_sac,
          current_stock: item.current_stock || 0,
          image_url: item.image_url,
          has_variants: false,
          gst_included: item.gst_included || false,
        };
        
        onSuccess(itemResult);
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({}));
        
        // Check if it's a subscription limit error
        if (res.status === 403 && errorData.code === 'SUBSCRIPTION_LIMIT_EXCEEDED' && errorData.current !== undefined && errorData.limit !== undefined) {
          setLimitInfo({ current: errorData.current, limit: errorData.limit });
          setShowUpgradePrompt(true);
        } else {
          toast.error(errorData.error || 'Failed to create item');
        }
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to create item');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Show authorization denied
  if (!canCreate) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative p-6">
          <AccessDenied
            module="items"
            action="create"
            details={reason}
            code="ITEM_CREATE_DENIED"
          />
          <div className="flex justify-end mt-4">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4" 
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative" 
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Add New Item</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-2">Item Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="item_type"
                      value="goods"
                      checked={formData.item_type === 'goods'}
                      onChange={(e) => setFormData({ ...formData, item_type: e.target.value as 'goods' | 'service' })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-text-primary">Goods (Track Stock)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="item_type"
                      value="service"
                      checked={formData.item_type === 'service'}
                      onChange={(e) => setFormData({ ...formData, item_type: e.target.value as 'goods' | 'service' })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-text-primary">Service (No Stock)</span>
                  </label>
                </div>
              </div>

              <div className="md:col-span-2">
                <Input label="Item Name" name="name" value={formData.name} onChange={handleChange} required placeholder="e.g. Parle-G Biscuit" />
              </div>
              
              <Input label="Item Code (Optional)" name="code" value={formData.code} onChange={handleChange} placeholder="P001" />
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Barcode (Optional)
                </label>
                <div className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input 
                      name="barcode" 
                      value={formData.barcode} 
                      onChange={handleBarcodeChange}
                      placeholder="Scan or enter barcode"
                      className={barcodeError ? 'border-red-500 focus:ring-red-500' : barcodeValid ? 'border-green-500 focus:ring-green-500' : ''}
                    />
                    {barcodeValid && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 text-green-600">
                        <Check className="w-4 h-4" />
                        <span className="text-xs">{formData.barcode_type}</span>
                      </div>
                    )}
                    {barcodeError && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-red-500">
                        <X className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBarcodeScanner(true)}
                      className="p-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-primary-500 transition-colors text-gray-600 hover:text-primary-600 flex-shrink-0"
                      title="Scan barcode with camera"
                    >
                      <Camera className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateBarcode}
                      className="p-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-primary-500 transition-colors text-gray-600 hover:text-primary-600 flex-shrink-0"
                      title="Generate unique barcode"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                {barcodeError && (
                  <p className="text-xs text-red-500 mt-1">{barcodeError}</p>
                )}
                {barcodeValid && formData.barcode_type && (
                  <p className="text-xs text-green-600 mt-1">
                    ✓ Valid {formData.barcode_type} barcode
                  </p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Unit</label>
                <select 
                  name="unit" 
                  className="input" 
                  value={formData.unit} 
                  onChange={handleChange}
                >
                  <option value="PCS">PCS</option>
                  <option value="KG">KG</option>
                  <option value="BOX">BOX</option>
                  <option value="LTR">LTR</option>
                  <option value="MTR">MTR</option>
                  <option value="NOS">NOS (Numbers)</option>
                  <option value="HRS">HRS (Hours)</option>
                  <option value="DAYS">DAYS (Days)</option>
                </select>
              </div>

              <Input 
                label={formData.item_type === 'service' ? "Selling Price (Optional)" : "Selling Price"} 
                name="selling_price" 
                type="number" 
                inputMode="decimal"
                value={formData.selling_price} 
                onChange={handleChange} 
                required={formData.item_type === 'goods'} 
                placeholder="0.00" 
              />
              <Input label="Purchase Price" name="purchase_price" type="number" inputMode="decimal" value={formData.purchase_price} onChange={handleChange} placeholder="0.00" />
              
              {formData.item_type === 'service' && (
                <div className="md:col-span-2 text-sm text-primary-600 bg-slate-50 p-3 rounded-md">
                  Note: For services you buy but don't sell, you can leave the selling price empty.
                </div>
              )}
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Default Supplier (Optional)
                </label>
                <div className="relative supplier-dropdown-container">
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Search supplier..."
                    value={supplierSearch}
                    onChange={(e) => {
                      setSupplierSearch(e.target.value);
                      setShowSupplierDropdown(true);
                    }}
                    onFocus={() => setShowSupplierDropdown(true)}
                  />
                  {showSupplierDropdown && filteredSuppliers.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                      {filteredSuppliers.map((supplier) => (
                        <div
                          key={supplier.id}
                          className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                          onClick={() => {
                            setSelectedSupplier(supplier);
                            setFormData(prev => ({ ...prev, default_supplier_id: supplier.id }));
                            setSupplierSearch(supplier.name);
                            setShowSupplierDropdown(false);
                          }}
                        >
                          <div className="font-medium">{supplier.name}</div>
                          {supplier.phone && (
                            <div className="text-xs text-gray-500">{supplier.phone}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedSupplier && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(null);
                        setFormData(prev => ({ ...prev, default_supplier_id: '' }));
                        setSupplierSearch('');
                      }}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-sm"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  HSN/SAC Code
                  <span className="text-xs text-text-secondary ml-2">
                    (Search by product name or code)
                  </span>
                </label>
                <HSNLookup
                  value={formData.hsn_sac}
                  onChange={(code) => setFormData({ ...formData, hsn_sac: code })}
                  onSelect={(result) => {
                    const updates: any = { hsn_sac: result.code };
                    // If SAC code (starts with 99), auto-switch to service
                    if (result.code.startsWith('99')) {
                      updates.item_type = 'service';
                    }
                    if (result.gst_rate) {
                      updates.tax_rate = result.gst_rate.toString();
                    }
                    setFormData(prev => ({ ...prev, ...updates }));
                  }}
                  placeholder="Type product name or HSN/SAC code (e.g. 'biscuit', 'software', '19053100')"
                />
              </div>
              
              <Input 
                label="Tax Rate (%)" 
                name="tax_rate" 
                type="number" 
                inputMode="decimal"
                value={formData.tax_rate} 
                onChange={handleChange} 
                placeholder="0"
                helperText="Auto-filled when HSN/SAC code is selected"
              />
              
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                <input
                  type="checkbox"
                  id="gst_included"
                  name="gst_included"
                  checked={formData.gst_included}
                  onChange={(e) => setFormData({ ...formData, gst_included: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="gst_included" className="text-sm font-medium text-text-secondary cursor-pointer">
                  GST Included in Selling Price
                </label>
              </div>
              
              {formData.item_type === 'goods' && (
                <>
                  <Input label="Opening Stock" name="opening_stock" type="number" inputMode="decimal" value={formData.opening_stock} onChange={handleChange} placeholder="0" />
                  <Input label="Low Stock Alert (Qty)" name="min_stock" type="number" inputMode="decimal" value={formData.min_stock} onChange={handleChange} placeholder="5" />
                </>
              )}
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" isLoading={loading}>
                Save Item
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Upgrade Modal */}
      {showUpgradePrompt && limitInfo && (
        <UpgradeModal
          limitType="items"
          currentCount={limitInfo.current}
          limit={limitInfo.limit}
          onClose={() => {
            setShowUpgradePrompt(false);
          }}
          onUpgradeSuccess={() => {
            setShowUpgradePrompt(false);
            window.location.reload();
          }}
        />
      )}

      {/* Barcode Scanner Modal */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowBarcodeScanner(false)}
        />
      )}
    </>
  );
}
