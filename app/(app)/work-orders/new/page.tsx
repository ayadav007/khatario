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

interface WorkOrderItem {
  id: string;
  item_id: string | null;
  item_name: string;
  description: string;
  hsn_sac: string;
  qty: number;
  unit: string;
  unit_price: number;
  total_cost: number;
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

export default function NewWorkOrderPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'work_orders',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  const [formData, setFormData] = useState({
    customer_id: '',
    work_order_number: '',
    work_order_date: new Date().toISOString().split('T')[0],
    scheduled_start_date: '',
    scheduled_end_date: '',
    work_description: '',
    work_location: '',
    assigned_to: '',
    labor_cost: 0,
    material_cost: 0,
    other_cost: 0,
    total_cost: 0,
    estimated_hours: '',
    priority: 'medium',
    notes: '',
    terms: '',
  });

  const [items, setItems] = useState<WorkOrderItem[]>([]);

  useEffect(() => {
    if (business?.id) {
      fetchCustomers();
      fetchNextWorkOrderNumber();
    }
  }, [business]);

  useEffect(() => {
    calculateTotals();
  }, [items, formData.labor_cost, formData.other_cost]);

  async function fetchCustomers() {
    try {
      const res = await fetch(`/api/customers?business_id=${business!.id}&user_id=${user?.id}`);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  }

  async function fetchNextWorkOrderNumber() {
    try {
      const res = await fetch(`/api/work-orders?business_id=${business!.id}`);
      const data = await res.json();
      const existingNumbers = (data.workOrders || []).map((wo: any) => wo.work_order_number);
      let nextNum = 1;
      while (existingNumbers.includes(`WO-${String(nextNum).padStart(3, '0')}`)) {
        nextNum++;
      }
      setFormData(prev => ({ ...prev, work_order_number: `WO-${String(nextNum).padStart(3, '0')}` }));
    } catch (error) {
      console.error('Error fetching next work order number:', error);
    }
  }

  const calculateTotals = () => {
    const materialCost = items.reduce((sum, item) => sum + item.total_cost, 0);
    const totalCost = Number(formData.labor_cost) + materialCost + Number(formData.other_cost);
    setFormData(prev => ({ ...prev, material_cost: materialCost, total_cost: totalCost }));
  };

  const addItem = () => {
    setItems([...items, { 
      id: Date.now().toString(), 
      item_id: null, 
      item_name: '', 
      description: '', 
      hsn_sac: '', 
      qty: 0, 
      unit: 'PCS',
      unit_price: 0,
      total_cost: 0
    }]);
  };

  const removeItem = (id: string) => {
    if (items.length > 0) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  const updateItem = (id: string, field: keyof WorkOrderItem, value: any) => {
    const updatedItems = items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'qty' || field === 'unit_price') {
          updated.total_cost = updated.qty * updated.unit_price;
        }
        return updated;
      }
      return item;
    });
    setItems(updatedItems);
  };

  const handleSubmit = async () => {
    if (!business?.id) {
      toast.error('Business not found');
      return;
    }

    if (!formData.work_order_number || !formData.work_order_date || !formData.work_description) {
      toast.error('Please fill in work order number, date, and description');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        business_id: business.id,
        items: items.filter(item => item.item_name && item.qty > 0),
        created_by: user?.id,
      };

      const res = await fetch('/api/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success('Work order created successfully!');
        router.push('/work-orders');
      } else {
        toast.error(data.error || 'Failed to create work order');
      }
    } catch (error: any) {
      console.error('Error creating work order:', error);
      toast.error('Failed to create work order');
    } finally {
      setLoading(false);
    }
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="work_orders"
          action="create"
          details={reason}
          code="WORK_ORDER_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">New Work Order</h1>
            <p className="text-gray-600 text-sm mt-1">Create a work order for services/jobs</p>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Basic Information */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Order Number *</label>
                <Input
                  type="text"
                  value={formData.work_order_number}
                  onChange={(e) => setFormData({ ...formData, work_order_number: e.target.value })}
                  placeholder="WO-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Order Date *</label>
                <Input
                  type="date"
                  value={formData.work_order_date}
                  onChange={(e) => setFormData({ ...formData, work_order_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <CustomerAutocomplete
                  customers={customers}
                  value={formData.customer_id}
                  onChange={(id) => setFormData({ ...formData, customer_id: id })}
                  onSelect={(customer) => {
                    // Can auto-populate work location from customer address if needed
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Work Details */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Work Details</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Description *</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={formData.work_description}
                  onChange={(e) => setFormData({ ...formData, work_description: e.target.value })}
                  placeholder="Describe the work to be performed"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Work Location</label>
                  <Input
                    type="text"
                    value={formData.work_location}
                    onChange={(e) => setFormData({ ...formData, work_location: e.target.value })}
                    placeholder="Where will the work be performed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                  <Input
                    type="text"
                    value={formData.assigned_to}
                    onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                    placeholder="Employee/Contractor name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start Date</label>
                  <Input
                    type="date"
                    value={formData.scheduled_start_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled End Date</label>
                  <Input
                    type="date"
                    value={formData.scheduled_end_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_end_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Hours</label>
                  <Input
                    type="number"
                    step="0.5"
                    value={formData.estimated_hours}
                    onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost Breakdown</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Labor Cost</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.labor_cost}
                  onChange={(e) => setFormData({ ...formData, labor_cost: Number(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Cost</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.material_cost.toFixed(2)}
                  disabled
                  className="bg-gray-100"
                  placeholder="Auto-calculated"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Other Costs</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.other_cost}
                  onChange={(e) => setFormData({ ...formData, other_cost: Number(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Cost</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.total_cost.toFixed(2)}
                  disabled
                  className="bg-gray-100 font-semibold"
                  placeholder="Auto-calculated"
                />
              </div>
            </div>
          </div>

          {/* Materials/Items */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Materials Required</h2>
              <Button onClick={addItem} variant="secondary" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Material
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
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Unit Price</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Total Cost</th>
                    <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-gray-500 text-sm">
                        No materials added. Click "Add Material" to add items.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
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
                              updateItem(item.id, 'unit_price', selectedItem.selling_price || 0);
                              
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
                          <Input
                            type="number"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => updateItem(item.id, 'unit_price', Number(e.target.value))}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={item.total_cost.toFixed(2)}
                            disabled
                            className="bg-gray-100"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
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
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save Work Order
            </Button>
          </div>
        </div>
      </div>
    
  );
}

