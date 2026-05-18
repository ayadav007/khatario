'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2, Save, Loader2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Customer, Item } from '@/types/database';
import { useToastContext } from '@/contexts/ToastContext';

interface DeliveryChallanItem {
  id: string;
  item_id: string | null;
  item_name: string;
  description: string;
  hsn_sac: string;
  qty: number;
  unit: string;
}

interface CustomerAutocompleteProps {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
}

function CustomerAutocomplete({ customers, value, onChange, onSelect }: CustomerAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedCustomer = customers.find(c => c.id === value);
  
  useEffect(() => {
    if (selectedCustomer) {
      setQuery(selectedCustomer.name);
    }
  }, [selectedCustomer]);

  const filtered = query === '' 
    ? customers 
    : customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.phone?.includes(query));

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Search Customer..."
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
        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(c.name);
                onChange(c.id);
                onSelect(c);
                setIsOpen(false);
              }}
            >
              <div className="font-medium text-gray-900">{c.name}</div>
              <div className="text-xs text-gray-500">{c.phone || 'No phone'}</div>
            </div>
          ))}
          <div 
            className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-primary-600 border-t"
            onMouseDown={(e) => {
              e.preventDefault();
              window.location.href = '/customers/new';
            }}
          >
            + Add New Customer
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewDeliveryChallanPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    customer_id: '',
    invoice_id: '',
    sales_order_id: '',
    challan_number: '',
    challan_date: new Date().toISOString().split('T')[0],
    delivery_date: '',
    e_way_bill_number: '',
    vehicle_number: '',
    transporter_name: '',
    transporter_gstin: '',
    shipping_address: '',
    billing_address: '',
    place_of_delivery: '',
    dispatch_from_address: '',
    reason_for_transportation: 'supply', // NEW: Default to 'supply'
    notes: '',
    terms: '',
  });

  const [items, setItems] = useState<DeliveryChallanItem[]>([
    { id: Date.now().toString(), item_id: null, item_name: '', description: '', hsn_sac: '', qty: 0, unit: 'PCS' }
  ]);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'invoices',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });

  useEffect(() => {
    if (business?.id) {
      fetchCustomers();
      fetchInvoices();
      fetchSalesOrders();
      fetchNextChallanNumber();
    }
  }, [business]);

  async function fetchCustomers() {
    try {
      const res = await fetch(`/api/customers?business_id=${business!.id}&user_id=${user?.id}`);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  }

  async function fetchInvoices() {
    try {
      const res = await fetch(`/api/invoices?business_id=${business!.id}&status=final&limit=100&user_id=${user?.id}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  }

  async function fetchSalesOrders() {
    try {
      const res = await fetch(`/api/sales-orders?business_id=${business!.id}`);
      const data = await res.json();
      setSalesOrders(data.salesOrders || []);
    } catch (error) {
      console.error('Error fetching sales orders:', error);
    }
  }

  async function fetchNextChallanNumber() {
    try {
      const res = await fetch(`/api/delivery-challans?business_id=${business!.id}`);
      const data = await res.json();
      const existingNumbers = (data.deliveryChallans || []).map((dc: any) => dc.challan_number);
      let nextNum = 1;
      while (existingNumbers.includes(`DC-${String(nextNum).padStart(3, '0')}`)) {
        nextNum++;
      }
      setFormData(prev => ({ ...prev, challan_number: `DC-${String(nextNum).padStart(3, '0')}` }));
    } catch (error) {
      console.error('Error fetching next challan number:', error);
    }
  }

  const addItem = () => {
    setItems([...items, { id: Date.now().toString(), item_id: null, item_name: '', description: '', hsn_sac: '', qty: 0, unit: 'PCS' }]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  const updateItem = (id: string, field: keyof DeliveryChallanItem, value: any) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleSubmit = async (status: string) => {
    if (!business?.id) {
      toast.error('Business not found');
      return;
    }

    if (!formData.challan_number || !formData.challan_date) {
      toast.error('Please fill in challan number and date');
      return;
    }

    const validItems = items.filter(item => item.item_name && item.qty > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        business_id: business.id,
        items: validItems.map(item => ({
          item_id: item.item_id,
          item_name: item.item_name,
          description: item.description,
          hsn_sac: item.hsn_sac,
          qty: item.qty,
          unit: item.unit,
        })),
        created_by: user?.id,
      };

      const res = await fetch('/api/delivery-challans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success('Delivery challan created successfully!');
        router.push('/delivery-challans');
      } else {
        toast.error(data.error || 'Failed to create delivery challan');
      }
    } catch (error: any) {
      console.error('Error creating delivery challan:', error);
      toast.error('Failed to create delivery challan');
    } finally {
      setLoading(false);
    }
  };

  const selectedCustomer = customers.find(c => c.id === formData.customer_id);
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="invoices"
          action="create"
          details={reason}
          code="DELIVERY_CHALLAN_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">New Delivery Challan</h1>
            <p className="text-gray-600 text-sm mt-1">Create a shipping document for goods delivery</p>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Basic Information */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Challan Number *</label>
                <Input
                  type="text"
                  value={formData.challan_number}
                  onChange={(e) => setFormData({ ...formData, challan_number: e.target.value })}
                  placeholder="DC-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Challan Date *</label>
                <Input
                  type="date"
                  value={formData.challan_date}
                  onChange={(e) => setFormData({ ...formData, challan_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Date</label>
                <Input
                  type="date"
                  value={formData.delivery_date}
                  onChange={(e) => setFormData({ ...formData, delivery_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <CustomerAutocomplete
                  customers={customers}
                  value={formData.customer_id}
                  onChange={(id) => {
                    setFormData({ ...formData, customer_id: id });
                    const customer = customers.find(c => c.id === id);
                    if (customer) {
                      setFormData(prev => ({
                        ...prev,
                        shipping_address: customer.address || '',
                        billing_address: customer.address || '',
                      }));
                    }
                  }}
                  onSelect={(customer) => {
                    setFormData(prev => ({
                      ...prev,
                      shipping_address: customer.address || '',
                      billing_address: customer.address || '',
                    }));
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to Invoice (Optional)</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={formData.invoice_id}
                  onChange={(e) => {
                    setFormData({ ...formData, invoice_id: e.target.value, sales_order_id: '' });
                    if (e.target.value) {
                      const invoice = invoices.find(i => i.id === e.target.value);
                      if (invoice && invoice.customer_id && !formData.customer_id) {
                        setFormData(prev => ({ ...prev, customer_id: invoice.customer_id }));
                      }
                    }
                  }}
                >
                  <option value="">Select Invoice</option>
                  {invoices.map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.customer_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to Sales Order (Optional)</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={formData.sales_order_id}
                  onChange={(e) => {
                    setFormData({ ...formData, sales_order_id: e.target.value, invoice_id: '' });
                    if (e.target.value) {
                      const order = salesOrders.find(so => so.id === e.target.value);
                      if (order && order.customer_id && !formData.customer_id) {
                        setFormData(prev => ({ ...prev, customer_id: order.customer_id }));
                      }
                    }
                  }}
                >
                  <option value="">Select Sales Order</option>
                  {salesOrders.map(so => (
                    <option key={so.id} value={so.id}>{so.order_number} - {so.customer_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Transportation Details */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Transportation Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for Transportation <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.reason_for_transportation}
                  onChange={(e) => setFormData({ ...formData, reason_for_transportation: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="supply">Supply (Sale)</option>
                  <option value="export">Export</option>
                  <option value="job_work">Job Work</option>
                  <option value="skd_ckd">SKD/CKD (Semi Knocked Down/Completely Knocked Down)</option>
                  <option value="recipient_not_known">Recipient not known</option>
                  <option value="line_sales">For own use</option>
                  <option value="exhibition">Exhibition or fairs</option>
                  <option value="others">Others</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Required by GST Rule 55. Determines what information must be shown on the delivery challan.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Way Bill Number</label>
                <Input
                  type="text"
                  value={formData.e_way_bill_number}
                  onChange={(e) => setFormData({ ...formData, e_way_bill_number: e.target.value })}
                  placeholder="E-Way Bill #"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
                <Input
                  type="text"
                  value={formData.vehicle_number}
                  onChange={(e) => setFormData({ ...formData, vehicle_number: e.target.value })}
                  placeholder="KA-01-AB-1234"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Transporter Name</label>
                <Input
                  type="text"
                  value={formData.transporter_name}
                  onChange={(e) => setFormData({ ...formData, transporter_name: e.target.value })}
                  placeholder="Transporter Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Transporter GSTIN</label>
                <Input
                  type="text"
                  value={formData.transporter_gstin}
                  onChange={(e) => setFormData({ ...formData, transporter_gstin: e.target.value.toUpperCase() })}
                  placeholder="15-digit GSTIN"
                  maxLength={15}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Place of Delivery</label>
                <Input
                  type="text"
                  value={formData.place_of_delivery}
                  onChange={(e) => setFormData({ ...formData, place_of_delivery: e.target.value })}
                  placeholder="City, State"
                />
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Addresses</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Address</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.shipping_address}
                  onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                  placeholder="Shipping address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Billing Address</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.billing_address}
                  onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })}
                  placeholder="Billing address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch From Address</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.dispatch_from_address}
                  onChange={(e) => setFormData({ ...formData, dispatch_from_address: e.target.value })}
                  placeholder="Address from where goods are dispatched"
                />
              </div>
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Items</h2>
              <Button onClick={addItem} variant="secondary" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Item Name</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">HSN/SAC</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Quantity</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Unit</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="px-3 py-2">
                        <ItemAutocomplete
                          value={item.item_name}
                          onChange={(val) => updateItem(item.id, 'item_name', val)}
                          onSelect={(selectedItem) => {
                            const isBarcodeScan = !item.item_id && item.item_name === '';
                            
                            updateItem(item.id, 'item_id', selectedItem.id);
                            updateItem(item.id, 'item_name', selectedItem.name);
                            updateItem(item.id, 'hsn_sac', selectedItem.hsn_sac || '');
                            updateItem(item.id, 'unit', selectedItem.unit || 'PCS');
                            
                            // Auto-set quantity to 1 if barcode scan on empty row
                            if (isBarcodeScan) {
                              updateItem(item.id, 'qty', 1);
                            }
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="text"
                          value={item.hsn_sac}
                          onChange={(e) => updateItem(item.id, 'hsn_sac', e.target.value)}
                          placeholder="HSN/SAC"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItem(item.id, 'qty', Number(e.target.value))}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                          placeholder="PCS"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeItem(item.id)}
                          disabled={items.length === 1}
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

          {/* Notes */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.terms}
                  onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                  placeholder="Terms and conditions"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              variant="secondary"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleSubmit('draft')}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save as Draft
            </Button>
          </div>
        </div>
      </div>
    
  );
}

