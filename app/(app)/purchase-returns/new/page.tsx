'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { AnnotatedFormSection } from '@/components/ui/AnnotatedFormSection';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { Plus, Trash2 } from 'lucide-react';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import {
  formLinesFromPurchase,
  scaleLinkedReturnLine,
  type PurchaseReturnFormLine,
} from '@/lib/purchases/purchase-return-lines';

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
  supplier_id?: string;
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

type ReturnItem = PurchaseReturnFormLine;

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
  const [linesLoading, setLinesLoading] = useState(false);
  const linkedPurchaseRef = useRef<Purchase | null>(null);
  const appliedPurchaseIdRef = useRef('');

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
    const supplierId = formData.supplier_id || urlParams.supplier_id;
    if (!supplierId || suppliers.length === 0) return;
    if (!formData.supplier_id) {
      setFormData((prev) => ({ ...prev, supplier_id: supplierId }));
    }
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (supplier) setSelectedSupplier(supplier);
  }, [urlParams.supplier_id, formData.supplier_id, suppliers]);

  // Open the bill from the Return button without waiting for the latest-50 purchase list.
  useEffect(() => {
    if (!urlParams.purchase_id) return;
    setFormData((prev) =>
      prev.purchase_id === urlParams.purchase_id ? prev : { ...prev, purchase_id: urlParams.purchase_id || '' }
    );
  }, [urlParams.purchase_id]);

  useEffect(() => {
    if (formData.supplier_id) {
      fetchPurchases(formData.supplier_id);
    }
  }, [formData.supplier_id]);

  useEffect(() => {
    if (formData.purchase_id) {
      appliedPurchaseIdRef.current = formData.purchase_id;
      loadPurchaseItems(formData.purchase_id);
      return;
    }
    if (appliedPurchaseIdRef.current) {
      appliedPurchaseIdRef.current = '';
      linkedPurchaseRef.current = null;
      setReturnItems([]);
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
        const supplierPurchases = (data.purchases || []).filter(
          (p: Purchase) => p.supplier_id === supplierId && (p as any).status !== 'cancelled'
        );
        const linked = linkedPurchaseRef.current;
        if (
          linked &&
          linked.supplier_id === supplierId &&
          !supplierPurchases.some((p: Purchase) => p.id === linked.id)
        ) {
          supplierPurchases.unshift(linked);
        }
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
    linkedPurchaseRef.current = null;
    setFormData({ ...formData, supplier_id: supplierId, purchase_id: '' });
    const supplier = suppliers.find(s => s.id === supplierId);
    setSelectedSupplier(supplier || null);
    // Clear items when supplier changes
    setReturnItems([]);
  };

  const loadPurchaseItems = async (purchaseId: string) => {
    setLinesLoading(true);
    try {
      const response = await fetch(`/api/purchases/${purchaseId}`, { credentials: 'include' });
      if (!response.ok) {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Could not load items from this purchase'));
        setReturnItems([]);
        return;
      }
      const data = await response.json();
      const purchase = data.purchase;
      const loadedItems = formLinesFromPurchase(purchase.items || []);
      const linkedPurchase: Purchase = {
        id: purchase.id,
        bill_number: purchase.bill_number,
        bill_date: purchase.bill_date,
        grand_total: purchase.grand_total,
        supplier_id: purchase.supplier_id,
      };
      linkedPurchaseRef.current = linkedPurchase;

      setPurchases((prev) => {
        if (prev.some((p) => p.id === linkedPurchase.id)) return prev;
        return [linkedPurchase, ...prev];
      });
      if (purchase.supplier_id) {
        setFormData((prev) =>
          prev.supplier_id ? prev : { ...prev, supplier_id: purchase.supplier_id }
        );
        setSelectedSupplier((prev) => prev || suppliers.find((s) => s.id === purchase.supplier_id) || null);
      }

      setReturnItems(loadedItems);
      if (loadedItems.length === 0) {
        toast.error('This purchase has no items to return.');
      } else if (loadedItems.every((line) => line.max_qty <= 0)) {
        toast.info('Every item on this purchase has already been returned.');
      } else {
        toast.info(
          `Loaded ${loadedItems.length} item${loadedItems.length === 1 ? '' : 's'} from this purchase. Adjust the quantity to return.`
        );
      }
    } catch (error) {
      console.error('Error loading purchase items:', error);
      toast.error('Could not load items from this purchase');
      setReturnItems([]);
    } finally {
      setLinesLoading(false);
    }
  };

  const addReturnItem = () => {
    setReturnItems([
      ...returnItems,
      {
        item_id: null,
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
        purchased_qty: 0,
        already_returned: 0,
        max_qty: 0,
        inter_state: false,
      },
    ]);
  };

  const removeReturnItem = (index: number) => {
    setReturnItems(returnItems.filter((_, i) => i !== index));
  };

  const updateReturnItem = (index: number, field: string, value: any) => {
    if (formData.purchase_id) {
      if (field !== 'qty') return;
      setReturnItems((prev) =>
        prev.map((line, i) => (i === index ? scaleLinkedReturnLine(line, Number(value)) : line))
      );
      return;
    }

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

    const linesToSave = formData.purchase_id
      ? returnItems.filter((item) => Number(item.qty) > 0)
      : returnItems;

    if (!formData.supplier_id || !formData.return_number || linesToSave.length === 0) {
      toast.error(
        formData.purchase_id && returnItems.length > 0
          ? 'Enter a quantity on at least one item from this purchase'
          : 'Please fill all required fields and add at least one item'
      );
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
      items: linesToSave.map(item => ({
        item_id: item.item_id || null,
        item_name: item.item_name,
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
      <div className="w-full min-w-0 max-w-5xl space-y-6">
        <MobileDuplicatePageChrome
          title="New purchase return"
          description="Return goods to supplier."
          onBack={() => router.push('/purchase-returns')}
        />

        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            <AnnotatedFormSection
              title="Return details"
              description="Document reference, supplier, and optional link to the original purchase."
            >
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
            </AnnotatedFormSection>

            <AnnotatedFormSection
              title="Return items"
              description={
                formData.purchase_id
                  ? 'Items from this purchase. Change the quantity to return. Price and tax stay as on the bill.'
                  : 'Lines sent back to the supplier.'
              }
            >
          {!formData.purchase_id && (
          <div className="flex justify-end mb-4">
            <Button type="button" onClick={addReturnItem} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
          )}

          <div className="space-y-4">
            {returnItems.map((item, index) => (
              <div key={index} className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between md:hidden">
                  <span className="text-sm font-medium text-gray-900">Item {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeReturnItem(index)}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-12 md:gap-4">
                  <div className="col-span-2 md:col-span-3">
                    <label className="mb-1 block text-xs font-medium text-gray-700">Item</label>
                    {formData.purchase_id ? (
                      <div className="py-2 text-sm font-medium text-gray-900 md:py-1">
                        {item.item_name || item.description || 'Item'}
                        {item.hsn_sac ? (
                          <span className="mt-0.5 block text-xs font-normal text-gray-500">HSN {item.hsn_sac}</span>
                        ) : null}
                      </div>
                    ) : (
                    <select
                      value={item.item_id || ''}
                      onChange={(e) => updateReturnItem(index, 'item_id', e.target.value)}
                      className="w-full min-w-0 rounded border border-gray-300 px-2 py-2 text-sm md:py-1"
                    >
                      <option value="">Select Item</option>
                      {item.item_id && !items.some((i) => i.id === item.item_id) ? (
                        <option value={item.item_id}>{item.item_name || 'Item'}</option>
                      ) : null}
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    )}
                  </div>

                  <div className="min-w-0 md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-700">Qty</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={formData.purchase_id ? item.max_qty : undefined}
                      value={item.qty}
                      disabled={!!formData.purchase_id && item.max_qty <= 0}
                      onChange={(e) => updateReturnItem(index, 'qty', e.target.value)}
                      className="w-full min-w-0 rounded border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-50 md:py-1"
                    />
                    {formData.purchase_id ? (
                      <p className="mt-1 text-xs text-gray-500">
                        {item.max_qty <= 0
                          ? 'Already fully returned'
                          : `Purchased ${item.purchased_qty}${item.already_returned > 0 ? `, already returned ${item.already_returned}` : ''}. Up to ${item.max_qty}.`}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0 md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-700">Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.unit_price}
                      readOnly={!!formData.purchase_id}
                      onChange={(e) => updateReturnItem(index, 'unit_price', e.target.value)}
                      className="w-full min-w-0 rounded border border-gray-300 px-2 py-2 text-sm read-only:bg-gray-50 md:py-1"
                    />
                  </div>

                  <div className="min-w-0 md:col-span-1">
                    <label className="mb-1 block text-xs font-medium text-gray-700">Tax %</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.tax_rate}
                      readOnly={!!formData.purchase_id}
                      onChange={(e) => updateReturnItem(index, 'tax_rate', e.target.value)}
                      className="w-full min-w-0 rounded border border-gray-300 px-2 py-2 text-sm read-only:bg-gray-50 md:py-1"
                    />
                  </div>

                  <div className="min-w-0 md:col-span-3">
                    <label className="mb-1 block text-xs font-medium text-gray-700">Total</label>
                    <div className="py-2 text-sm font-medium md:py-1">
                      ₹{item.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="hidden items-end md:col-span-1 md:flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeReturnItem(index)}
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {returnItems.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                {linesLoading
                  ? 'Loading items from this purchase…'
                  : formData.purchase_id
                    ? 'No items found on this purchase.'
                    : 'No items added. Click "Add Item" to begin.'}
              </div>
            )}
          </div>
            </AnnotatedFormSection>

        {returnItems.length > 0 && (
            <AnnotatedFormSection
              title="Totals"
              description="GST breakdown for this return."
            >
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
            </AnnotatedFormSection>
        )}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end dark:border-border-dark">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => router.push('/purchase-returns')}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? 'Creating...' : 'Create purchase return'}
            </Button>
          </div>
        </form>
      </div>
  );
}

