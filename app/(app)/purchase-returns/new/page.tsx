'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  state_code?: string;
}

interface Purchase {
  id: string;
  bill_number: string;
  bill_date: string;
  grand_total: number;
}

interface Item {
  id: string;
  name: string;
  hsn_sac?: string;
  unit?: string;
  selling_price: number;
  tax_rate: number;
  current_stock: number;
}

interface ReturnItem {
  item_id: string;
  item_name: string;
  description: string;
  hsn_sac: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  taxable_value: number;
  tax_rate: number;
  tax_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
}

export default function NewPurchaseReturnPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // Get purchase_id and supplier_id from URL params if provided
  const [urlParams, setUrlParams] = useState<{ purchase_id?: string; supplier_id?: string }>({});

  const [formData, setFormData] = useState({
    supplier_id: '',
    purchase_id: '',
    return_number: '',
    return_date: new Date().toISOString().split('T')[0],
    reason: '',
  });

  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  // Parse URL params on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const purchaseId = params.get('purchase_id');
      const supplierId = params.get('supplier_id');
      if (purchaseId || supplierId) {
        setUrlParams({ purchase_id: purchaseId || undefined, supplier_id: supplierId || undefined });
      }
    }
  }, []);

  useEffect(() => {
    if (business?.id) {
      fetchSuppliers();
      fetchItems();
    }
  }, [business?.id]);

  // Pre-select supplier from URL params
  useEffect(() => {
    if (urlParams.supplier_id && suppliers.length > 0) {
      setFormData(prev => ({ ...prev, supplier_id: urlParams.supplier_id || '' }));
      const supplier = suppliers.find(s => s.id === urlParams.supplier_id);
      setSelectedSupplier(supplier || null);
    }
  }, [urlParams.supplier_id, suppliers]);

  // Pre-select purchase from URL params
  useEffect(() => {
    if (urlParams.purchase_id && purchases.length > 0) {
      setFormData(prev => ({ ...prev, purchase_id: urlParams.purchase_id || '' }));
    }
  }, [urlParams.purchase_id, purchases]);

  useEffect(() => {
    if (formData.supplier_id) {
      fetchPurchases(formData.supplier_id);
    }
  }, [formData.supplier_id]);

  useEffect(() => {
    if (formData.purchase_id) {
      loadPurchaseItems(formData.purchase_id);
    }
  }, [formData.purchase_id]);

  const fetchSuppliers = async () => {
    try {
      const response = await fetch(`/api/suppliers?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setSuppliers(data.suppliers || []);
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const fetchPurchases = async (supplierId: string) => {
    try {
      const response = await fetch(`/api/purchases?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        const supplierPurchases = data.purchases.filter(
          (p: Purchase) => (p as any).supplier_id === supplierId
        );
        setPurchases(supplierPurchases);
      }
    } catch (error) {
      console.error('Error fetching purchases:', error);
    }
  };

  const fetchItems = async () => {
    try {
      const response = await fetch(`/api/items?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    setFormData({ ...formData, supplier_id: supplierId, purchase_id: '' });
    const supplier = suppliers.find(s => s.id === supplierId);
    setSelectedSupplier(supplier || null);
    // Clear items when supplier changes
    setReturnItems([]);
  };

  const loadPurchaseItems = async (purchaseId: string) => {
    try {
      const response = await fetch(`/api/purchases/${purchaseId}`);
      if (response.ok) {
        const data = await response.json();
        const purchase = data.purchase;
        
        // Auto-populate items from the purchase
        const loadedItems = purchase.items.map((item: any) => {
          const subtotal = Number(item.quantity) * Number(item.unit_price);
          const discountAmount = (subtotal * Number(item.discount_percent || 0)) / 100;
          const taxableValue = subtotal - discountAmount;
          
          // Use the same GST breakdown as the original purchase item
          const cgstAmount = Number(item.cgst_amount || 0);
          const sgstAmount = Number(item.sgst_amount || 0);
          const igstAmount = Number(item.igst_amount || 0);
          const taxAmount = cgstAmount + sgstAmount + igstAmount;
          const lineTotal = taxableValue + taxAmount;

          return {
            item_id: item.item_id || '',
            item_name: item.item_name,
            description: item.item_name,
            hsn_sac: item.hsn_sac || '',
            qty: Number(item.quantity), // User can adjust this
            unit: item.unit || 'PCS',
            unit_price: Number(item.unit_price),
            discount_percent: Number(item.discount_percent || 0),
            discount_amount: discountAmount,
            taxable_value: taxableValue,
            tax_rate: Number(item.tax_rate || 0),
            tax_amount: taxAmount,
            cgst_amount: cgstAmount,
            sgst_amount: sgstAmount,
            igst_amount: igstAmount,
            line_total: lineTotal,
          };
        });

        setReturnItems(loadedItems);
        toast.info(`Loaded ${loadedItems.length} items from purchase. You can adjust quantities as needed.`);
      } else {
        console.error('Failed to fetch purchase details');
      }
    } catch (error) {
      console.error('Error loading purchase items:', error);
    }
  };

  const addReturnItem = () => {
    setReturnItems([
      ...returnItems,
      {
        item_id: '',
        item_name: '',
        description: '',
        hsn_sac: '',
        qty: 1,
        unit: 'PCS',
        unit_price: 0,
        discount_percent: 0,
        discount_amount: 0,
        taxable_value: 0,
        tax_rate: 18,
        tax_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        line_total: 0,
      },
    ]);
  };

  const removeReturnItem = (index: number) => {
    setReturnItems(returnItems.filter((_, i) => i !== index));
  };

  const updateReturnItem = (index: number, field: string, value: any) => {
    const updatedItems = [...returnItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    // If item selected, populate details
    if (field === 'item_id' && value) {
      const item = items.find(i => i.id === value);
      if (item) {
        updatedItems[index].item_name = item.name;
        updatedItems[index].description = item.name;
        updatedItems[index].hsn_sac = item.hsn_sac || '';
        updatedItems[index].unit = item.unit || 'PCS';
        updatedItems[index].unit_price = Number(item.selling_price);
        updatedItems[index].tax_rate = Number(item.tax_rate);
      }
    }

    // Recalculate amounts
    const qty = Number(updatedItems[index].qty) || 0;
    const unitPrice = Number(updatedItems[index].unit_price) || 0;
    const discountPercent = Number(updatedItems[index].discount_percent) || 0;
    const taxRate = Number(updatedItems[index].tax_rate) || 0;

    const subtotal = qty * unitPrice;
    const discountAmount = (subtotal * discountPercent) / 100;
    const taxableValue = subtotal - discountAmount;
    
    // Determine if intra-state or inter-state
    const businessStateCode = business?.state_code || '';
    const supplierStateCode = selectedSupplier?.state_code || '';
    const isIntraState = businessStateCode === supplierStateCode;

    let cgst = 0, sgst = 0, igst = 0;
    if (isIntraState) {
      cgst = (taxableValue * (taxRate / 2)) / 100;
      sgst = (taxableValue * (taxRate / 2)) / 100;
    } else {
      igst = (taxableValue * taxRate) / 100;
    }

    const taxAmount = cgst + sgst + igst;
    const lineTotal = taxableValue + taxAmount;

    updatedItems[index].discount_amount = discountAmount;
    updatedItems[index].taxable_value = taxableValue;
    updatedItems[index].cgst_amount = cgst;
    updatedItems[index].sgst_amount = sgst;
    updatedItems[index].igst_amount = igst;
    updatedItems[index].tax_amount = taxAmount;
    updatedItems[index].line_total = lineTotal;

    setReturnItems(updatedItems);
  };

  const calculateTotals = () => {
    const subtotal = returnItems.reduce((sum, item) => sum + item.taxable_value, 0);
    const taxTotal = returnItems.reduce((sum, item) => sum + item.tax_amount, 0);
    const cgstTotal = returnItems.reduce((sum, item) => sum + item.cgst_amount, 0);
    const sgstTotal = returnItems.reduce((sum, item) => sum + item.sgst_amount, 0);
    const igstTotal = returnItems.reduce((sum, item) => sum + item.igst_amount, 0);
    const grandTotal = returnItems.reduce((sum, item) => sum + item.line_total, 0);

    return { subtotal, taxTotal, cgstTotal, sgstTotal, igstTotal, grandTotal };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.supplier_id || !formData.return_number || returnItems.length === 0) {
      toast.error('Please fill all required fields and add at least one item');
      return;
    }

    const totals = calculateTotals();

    const payload = {
      business_id: business?.id,
      supplier_id: formData.supplier_id,
      purchase_id: formData.purchase_id || null,
      return_number: formData.return_number,
      return_date: formData.return_date,
      reason: formData.reason,
      place_of_supply_state_code: selectedSupplier?.state_code,
      items: returnItems.map(item => ({
        item_id: item.item_id || null,
        description: item.description,
        hsn_sac: item.hsn_sac,
        qty: item.qty,
        unit: item.unit,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        discount_amount: item.discount_amount,
        taxable_value: item.taxable_value,
        tax_rate: item.tax_rate,
        tax_amount: item.tax_amount,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
        line_total: item.line_total,
      })),
      subtotal: totals.subtotal,
      tax_total: totals.taxTotal,
      cgst_total: totals.cgstTotal,
      sgst_total: totals.sgstTotal,
      igst_total: totals.igstTotal,
      grand_total: totals.grandTotal,
      created_by: user?.id,
    };

    if (!user?.id) {
      toast.error('You must be signed in to create a purchase return.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/purchase-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await safeJsonParse<{ purchaseReturn?: { id?: string } }>(response);
        toast.success('Purchase return created successfully!');
        const id = result?.purchaseReturn?.id;
        router.push(id ? `/purchase-returns/${id}` : '/purchase-returns');
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to create purchase return'));
      }
    } catch (error) {
      console.error('Error creating purchase return:', error);
      toast.error('Failed to create purchase return');
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="purchases"
          action="create"
          details={reason}
          code="PURCHASE_RETURN_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/purchase-returns">
              <Button type="button" variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">New Purchase Return</h1>
              <p className="text-sm text-text-secondary mt-1">Return goods to supplier</p>
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Purchase Return'}
          </Button>
        </div>

        {/* Basic Details */}
        <Card padding="md">
          <h2 className="text-lg font-semibold mb-4">Return Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Return Number *
              </label>
              <input
                type="text"
                required
                value={formData.return_number}
                onChange={(e) => setFormData({ ...formData, return_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="PR-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Return Date *
              </label>
              <input
                type="date"
                required
                value={formData.return_date}
                onChange={(e) => setFormData({ ...formData, return_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier *
              </label>
              <select
                required
                value={formData.supplier_id}
                onChange={(e) => handleSupplierChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link to Purchase (Optional)
              </label>
              <select
                value={formData.purchase_id}
                onChange={(e) => setFormData({ ...formData, purchase_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                disabled={!formData.supplier_id}
              >
                <option value="">Select Purchase (Optional)</option>
                {purchases.map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.bill_number} - ₹{Number(purchase.grand_total).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Return
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="Defective goods, excess quantity, etc."
              />
            </div>
          </div>
        </Card>

        {/* Return Items */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Return Items</h2>
            <Button type="button" onClick={addReturnItem} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {returnItems.map((item, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Item</label>
                    <select
                      value={item.item_id}
                      onChange={(e) => updateReturnItem(index, 'item_id', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    >
                      <option value="">Select Item</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.qty}
                      onChange={(e) => updateReturnItem(index, 'qty', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateReturnItem(index, 'unit_price', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Tax %</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.tax_rate}
                      onChange={(e) => updateReturnItem(index, 'tax_rate', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Total</label>
                    <div className="text-sm font-medium py-1">
                      ₹{item.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="col-span-1 flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeReturnItem(index)}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {returnItems.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No items added. Click "Add Item" to begin.
              </div>
            )}
          </div>
        </Card>

        {/* Totals */}
        {returnItems.length > 0 && (
          <Card padding="md">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              {totals.cgstTotal > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CGST:</span>
                    <span className="font-medium">₹{totals.cgstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">SGST:</span>
                    <span className="font-medium">₹{totals.sgstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}
              {totals.igstTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">IGST:</span>
                  <span className="font-medium">₹{totals.igstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Grand Total:</span>
                <span>₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </Card>
        )}
      </form>
    
  );
}

