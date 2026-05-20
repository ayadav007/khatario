'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Search, Plus, Trash2, Save, X, Loader2 } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { format } from 'date-fns';
import { Supplier, Item } from '@/types/database';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

// List of all Indian States and Union Territories
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

// Helper function to get state code from state name
const getStateCode = (stateName: string): string => {
  if (!stateName) return '';
  const name = stateName.trim().toLowerCase();
  
  const stateCodeMap: Record<string, string> = {
    'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
    'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
    'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
    'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
    'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
    'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
    'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
    'andaman and nicobar islands': '35', 'chandigarh': '04',
    'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
    'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34'
  };
  return stateCodeMap[name] || '';
};

interface SupplierAutocompleteProps {
  suppliers: Supplier[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (supplier: Supplier) => void;
}

function SupplierAutocomplete({ suppliers, value, onChange, onSelect }: SupplierAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedSupplier = suppliers.find(s => s.id === value);
  
  useEffect(() => {
    if (selectedSupplier) {
      setQuery(selectedSupplier.name);
    }
  }, [selectedSupplier]);

  const filtered = query === '' 
    ? suppliers 
    : suppliers.filter((s) => 
        s.name.toLowerCase().includes(query.toLowerCase()) || 
        s.phone?.includes(query)
      );

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Search Supplier..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (e.target.value === '') {
              onChange('');
            }
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        />
        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {filtered.map((supplier) => (
            <button
              key={supplier.id}
              type="button"
              className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
              onClick={() => {
                setQuery(supplier.name);
                onChange(supplier.id);
                onSelect(supplier);
                setIsOpen(false);
              }}
            >
              <div className="font-medium">{supplier.name}</div>
              {supplier.phone && (
                <div className="text-xs text-gray-500">{supplier.phone}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface OrderItemRow {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  hsnSac: string;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  total: number;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'purchase_orders',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState(business?.state || '');
  const [billingAddress, setBillingAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  
  const [rows, setRows] = useState<OrderItemRow[]>([
    { itemId: '', name: '', quantity: 1, unit: 'PCS', price: 0, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0, hsnSac: '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 }
  ]);
  
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<'draft' | 'confirmed' | null>(null);

  // Fetch suppliers and next order number
  useEffect(() => {
    if (!business?.id) return;
    
    // Fetch suppliers
    fetch(`/api/suppliers?business_id=${business.id}&user_id=${user?.id}`)
      .then(res => res.json())
      .then(data => setSuppliers(data.suppliers || []))
      .catch(err => console.error(err));

    // Fetch next order number
    fetch(`/api/purchase-orders?business_id=${business.id}`)
      .then(res => res.json())
      .then(data => {
        const existingNumbers = (data.purchaseOrders || []).map((po: any) => po.order_number);
        let nextNum = 1;
        while (existingNumbers.includes(`PO-${String(nextNum).padStart(3, '0')}`)) {
          nextNum++;
        }
        setOrderNumber(`PO-${String(nextNum).padStart(3, '0')}`);
      })
      .catch(err => console.error(err));
  }, [business?.id]);

  // Pre-fill form flag
  const [prefilled, setPrefilled] = useState(false);

  // Fetch supplier details
  useEffect(() => {
    if (!supplierId || !business) {
      setSelectedSupplier(null);
      setBillingAddress('');
      setShippingAddress('');
      setPlaceOfSupply(business?.state || '');
      return;
    }
    
    fetch(`/api/suppliers/${supplierId}`)
      .then(res => res.json())
      .then(data => {
        const s = data.supplier;
        setSelectedSupplier(s);
        setBillingAddress(s.address || '');
        setShippingAddress(s.address || '');
        
        const sState = getStateCode(s.state || '');
        const bState = business.state_code || getStateCode(business.state || '');
        
        if (sState && bState && sState === bState) {
          setPlaceOfSupply(business.state || '');
        } else if (s.state) {
          setPlaceOfSupply(s.state);
        } else {
          setPlaceOfSupply(business.state || '');
        }
      })
      .catch(err => console.error(err));
  }, [supplierId, business]);

  // Calculate row totals
  const calculateRow = useCallback((row: OrderItemRow): OrderItemRow => {
    const subtotal = row.quantity * row.price;
    let discAmt = (subtotal * row.discountPercent) / 100;
    if (discAmt > subtotal) discAmt = subtotal;
    
    const taxableAmount = subtotal - discAmt;
    const businessStateCode = business?.state_code || getStateCode(business?.state || '');
    const posStateCode = getStateCode(placeOfSupply || '');
    const sameState = !!businessStateCode && !!posStateCode && businessStateCode === posStateCode;

    let cgst = 0, sgst = 0, igst = 0, taxAmt = 0;
    if (sameState) {
      cgst = taxableAmount * (row.taxPercent / 2) / 100;
      sgst = taxableAmount * (row.taxPercent / 2) / 100;
      taxAmt = cgst + sgst;
    } else {
      igst = taxableAmount * row.taxPercent / 100;
      taxAmt = igst;
    }
    
    return {
      ...row,
      discountAmount: discAmt,
      taxableValue: taxableAmount,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      taxAmount: taxAmt,
      total: taxableAmount + taxAmt
    };
  }, [business, placeOfSupply]);

  useEffect(() => {
    setRows(prev => prev.map(r => calculateRow(r)));
  }, [calculateRow]);

  // Pre-fill form from query parameters (when coming from requests page)
  useEffect(() => {
    if (!searchParams || suppliers.length === 0 || prefilled || !calculateRow) return;
    
    const supplierIdParam = searchParams.get('supplier_id');
    const itemIdParam = searchParams.get('item_id');
    const qtyParam = searchParams.get('qty');
    
    // Pre-fill supplier
    if (supplierIdParam && !supplierId) {
      const supplier = suppliers.find(s => s.id === supplierIdParam);
      if (supplier) {
        setSupplierId(supplierIdParam);
      }
    }
    
    // Pre-fill item and quantity
    if (itemIdParam && qtyParam && business?.id) {
      fetch(`/api/items/${itemIdParam}?business_id=${business.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.item) {
            const item = data.item;
            const quantity = parseFloat(qtyParam) || 1;
            const newRow = calculateRow({
              itemId: item.id,
              name: item.name,
              quantity: quantity,
              unit: item.unit || 'PCS',
              price: Number(item.purchase_price || item.selling_price || 0),
              discountPercent: 0,
              discountAmount: 0,
              taxPercent: Number(item.tax_rate || 0),
              taxAmount: 0,
              hsnSac: item.hsn_sac || '',
              taxableValue: 0,
              cgstAmount: 0,
              sgstAmount: 0,
              igstAmount: 0,
              total: 0
            });
            setRows([newRow]);
            setPrefilled(true);
          }
        })
        .catch(err => console.error('Error fetching item:', err));
    } else if (!itemIdParam && !qtyParam) {
      // No params to pre-fill, mark as done
      setPrefilled(true);
    }
  }, [searchParams, suppliers, supplierId, business?.id, calculateRow, prefilled]);

  const updateRow = (index: number, field: keyof OrderItemRow, value: any) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    if (['quantity', 'price', 'discountPercent', 'taxPercent'].includes(field)) {
      newRows[index] = calculateRow(newRows[index]);
    }
    setRows(newRows);
  };

  const handleItemSelect = (item: any, rowIndex: number) => {
    const newRows = [...rows];
    newRows[rowIndex] = calculateRow({
      ...newRows[rowIndex],
      itemId: item.id,
      name: item.name,
      hsnSac: item.hsn_sac || '',
      price: Number(item.purchase_price || item.selling_price || 0), // Use purchase_price for purchase orders
      taxPercent: Number(item.tax_rate),
      quantity: newRows[rowIndex].quantity || 1
    });
    setRows(newRows);
  };

  const addRow = () => {
    setRows([...rows, { itemId: '', name: '', quantity: 1, unit: 'PCS', price: 0, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0, hsnSac: '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 }]);
  };

  const removeRow = (index: number) => {
    if (rows.length > 1) {
      setRows(rows.filter((_, i) => i !== index));
    }
  };

  // Calculate totals
  const subtotal = rows.reduce((acc, row) => acc + row.taxableValue, 0);
  const totalDiscount = rows.reduce((acc, row) => acc + row.discountAmount, 0);
  const totalTax = rows.reduce((acc, row) => acc + row.taxAmount, 0);
  const grandTotal = subtotal + totalTax;

  // Handle save
  const handleSave = async (targetStatus: 'draft' | 'confirmed') => {
    if (!rows[0] || !rows[0].name) {
      toast.error('Please add at least one item');
      return;
    }

    if (!supplierId) {
      toast.error('Please select a supplier');
      return;
    }

    setLoading(true);
    try {
      const requestId = searchParams?.get('request_id');
      
      const payload = {
        business_id: business?.id,
        supplier_id: supplierId,
        order_number: orderNumber,
        order_date: orderDate,
        expected_delivery_date: expectedDeliveryDate || null,
        items: rows.map(row => ({
          item_id: row.itemId || null,
          item_name: row.name,
          description: '',
          hsn_sac: row.hsnSac || null,
          qty: row.quantity,
          unit: row.unit,
          unit_price: row.price,
          discount_percent: row.discountPercent,
          discount_amount: row.discountAmount,
          tax_rate: row.taxPercent,
          tax_amount: row.taxAmount,
          taxable_value: row.taxableValue,
          cgst_amount: row.cgstAmount,
          sgst_amount: row.sgstAmount,
          igst_amount: row.igstAmount,
          line_total: row.total
        })),
        subtotal: subtotal,
        discount_total: totalDiscount,
        tax_total: totalTax,
        round_off: 0,
        grand_total: grandTotal,
        additional_charges: 0,
        shipping_address: shippingAddress || null,
        billing_address: billingAddress || null,
        place_of_supply_state_code: getStateCode(placeOfSupply) || null,
        notes: notes || null,
        terms: terms || null,
        created_by: user?.id || null,
        status: targetStatus,
        request_id: requestId || null
      };

      const res = await fetch('/api/purchase-orders', {
        method: savedOrderId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedOrderId ? { ...payload, id: savedOrderId } : payload)
      });

      if (res.ok) {
        const data = await res.json();
        setSavedOrderId(data.purchaseOrder?.id || savedOrderId);
        setSavedStatus(targetStatus);
        
        // If created from a request, link it (API handles notification)
        // The API already handles linking and notification, so we just show success
        
        toast.success(`Purchase order ${targetStatus === 'draft' ? 'saved as draft' : 'confirmed'} successfully!`);
        if (targetStatus === 'confirmed') {
          router.push(`/purchase-orders/${data.purchaseOrder.id}`);
        }
      } else {
        const error = await safeJsonParse(res);
        toast.error(getApiErrorMessage(error, 'Failed to save purchase order'));
      }
    } catch (error) {
      console.error('Error saving purchase order:', error);
      toast.error('Failed to save purchase order');
    } finally {
      setLoading(false);
    }
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="purchases"
          action="create"
          details={reason}
          code="PURCHASE_ORDER_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title="New purchase order"
          description="Create a new purchase order"
          trailing={
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => handleSave('draft')} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className="ml-2">Save Draft</span>
              </Button>
              <Button variant="primary" onClick={() => handleSave('confirmed')} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className="ml-2">Confirm Order</span>
              </Button>
            </div>
          }
        />
        <div className="flex md:hidden items-center gap-2">
          <Button variant="secondary" onClick={() => handleSave('draft')} disabled={loading} className="flex-1">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Draft</span>
          </Button>
          <Button variant="primary" onClick={() => handleSave('confirmed')} disabled={loading} className="flex-1">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2">Confirm</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Supplier & Order Info */}
            <Card>
              <div className="p-6 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900">Supplier & Order Details</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                    <SupplierAutocomplete
                      suppliers={suppliers}
                      value={supplierId}
                      onChange={setSupplierId}
                      onSelect={setSelectedSupplier}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Order Number</label>
                    <Input
                      value={orderNumber}
                      onChange={(e) => setOrderNumber(e.target.value)}
                      placeholder="PO-001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Order Date *</label>
                    <Input
                      type="date"
                      value={orderDate}
                      onChange={(e) => setOrderDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery Date</label>
                    <Input
                      type="date"
                      value={expectedDeliveryDate}
                      onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
                    <select
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={placeOfSupply}
                      onChange={(e) => setPlaceOfSupply(e.target.value)}
                    >
                      <option value="">Select State</option>
                      {INDIAN_STATES.map(state => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Billing Address</label>
                    <textarea
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      rows={3}
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      placeholder="Billing address"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Address</label>
                    <textarea
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      rows={3}
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Shipping address"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* Items */}
            <Card>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Items</h2>
                  <Button variant="secondary" onClick={addRow} size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Item</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">HSN/SAC</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Qty</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Unit</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Price</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Disc %</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Tax %</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700">Total</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-700"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index} className="border-b border-gray-100">
                          <td className="py-2 px-3">
                            <ItemAutocomplete
                              value={row.itemId}
                              onChange={(val) => {
                                const newRows = [...rows];
                                newRows[index] = { ...newRows[index], itemId: val };
                                setRows(newRows);
                              }}
                              onSelect={(item) => handleItemSelect(item, index)}
                              placeholder="Search item..."
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              value={row.hsnSac}
                              onChange={(e) => updateRow(index, 'hsnSac', e.target.value)}
                              className="w-24 text-xs"
                              placeholder="HSN/SAC"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              value={row.quantity}
                              onChange={(e) => updateRow(index, 'quantity', parseFloat(e.target.value) || 0)}
                              className="w-20 text-xs"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              value={row.unit}
                              onChange={(e) => updateRow(index, 'unit', e.target.value)}
                              className="w-16 text-xs"
                              placeholder="PCS"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              value={row.price}
                              onChange={(e) => updateRow(index, 'price', parseFloat(e.target.value) || 0)}
                              className="w-24 text-xs"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              value={row.discountPercent}
                              onChange={(e) => updateRow(index, 'discountPercent', parseFloat(e.target.value) || 0)}
                              className="w-20 text-xs"
                              min="0"
                              max="100"
                              step="0.01"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              value={row.taxPercent}
                              onChange={(e) => updateRow(index, 'taxPercent', parseFloat(e.target.value) || 0)}
                              className="w-20 text-xs"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-sm font-medium">₹{row.total.toFixed(2)}</span>
                          </td>
                          <td className="py-2 px-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow(index)}
                              disabled={rows.length === 1}
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Notes & Terms */}
            <Card>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    rows={3}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="Terms and conditions..."
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Summary */}
          <div className="lg:col-span-1">
            <Card>
              <div className="p-6 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900">Order Summary</h2>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-medium">₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Discount</span>
                    <span className="font-medium">₹{totalDiscount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Tax</span>
                    <span className="font-medium">₹{totalTax.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between">
                    <span className="font-semibold text-gray-900">Grand Total</span>
                    <span className="font-bold text-lg text-gray-900">₹{grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    
  );
}

