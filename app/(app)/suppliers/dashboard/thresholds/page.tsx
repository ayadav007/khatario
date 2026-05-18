'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Save, Loader2, AlertTriangle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

interface Threshold {
  id: string;
  customer_business_id: string;
  item_id: string;
  low_stock_threshold: number;
  customer_name: string;
  customer_phone?: string;
  customer_city?: string;
  customer_state?: string;
  item_name: string;
  item_code?: string;
  current_stock: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  city?: string;
  state?: string;
}

interface Item {
  id: string;
  name: string;
  code?: string;
  current_stock: number;
}

export default function ThresholdsManagementPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newThreshold, setNewThreshold] = useState({
    customer_business_id: '',
    item_id: '',
    low_stock_threshold: ''
  });

  useEffect(() => {
    fetchData();
  }, [business?.id]);

  const fetchData = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      // Fetch thresholds
      const thresholdsRes = await fetch(`/api/suppliers/thresholds?supplier_business_id=${business.id}`);
      if (thresholdsRes.ok) {
        const data = await thresholdsRes.json();
        setThresholds(data.thresholds || []);
      }

      // Fetch approved suppliers (they are our customers in the supplier relationship)
      const suppliersRes = await fetch(`/api/suppliers/requests?business_id=${business.id}&type=received`);
      if (suppliersRes.ok) {
        const data = await suppliersRes.json();
        const approvedCustomers = data.requests.received
          .filter((r: any) => r.approval_status === 'approved')
          .map((r: any) => ({
            id: r.requester_id,
            name: r.requester_name,
            phone: r.requester_phone
          }));
        setCustomers(approvedCustomers);
      }

      // Fetch items
      const itemsRes = await fetch(`/api/items?business_id=${business.id}&is_active=true&user_id=${user?.id}`);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddThreshold = async () => {
    if (!business?.id) return;

    if (!newThreshold.customer_business_id || !newThreshold.item_id || !newThreshold.low_stock_threshold) {
      toast.warning('Please fill all fields');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/suppliers/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_business_id: business.id,
          ...newThreshold,
          low_stock_threshold: parseFloat(newThreshold.low_stock_threshold)
        })
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message || 'Threshold saved successfully');
        setNewThreshold({ customer_business_id: '', item_id: '', low_stock_threshold: '' });
        setShowAddForm(false);
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save threshold');
      }
    } catch (error) {
      console.error('Error saving threshold:', error);
      toast.error('Failed to save threshold');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteThreshold = async (thresholdId: string) => {
    if (!confirm('Are you sure you want to delete this threshold?')) return;

    try {
      const res = await fetch(`/api/suppliers/thresholds?id=${thresholdId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        toast.success('Threshold deleted successfully');
        fetchData();
      } else {
        toast.error('Failed to delete threshold');
      }
    } catch (error) {
      console.error('Error deleting threshold:', error);
      toast.error('Failed to delete threshold');
    }
  };

  return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Low Stock Thresholds</h1>
            <p className="text-sm text-gray-600 mt-1">
              Set stock thresholds for your customers to receive alerts when their inventory is running low
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Threshold
          </Button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <Card padding="md">
            <h3 className="font-semibold text-gray-900 mb-4">New Threshold</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
                <select
                  value={newThreshold.customer_business_id}
                  onChange={(e) => setNewThreshold(prev => ({ ...prev, customer_business_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} {customer.phone && `(${customer.phone})`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Item</label>
                <select
                  value={newThreshold.item_id}
                  onChange={(e) => setNewThreshold(prev => ({ ...prev, item_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Item</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.code && `(${item.code})`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Threshold Quantity</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newThreshold.low_stock_threshold}
                  onChange={(e) => setNewThreshold(prev => ({ ...prev, low_stock_threshold: e.target.value }))}
                  placeholder="Enter threshold"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="primary" onClick={handleAddThreshold} isLoading={saving}>
                <Save className="w-4 h-4 mr-2" />
                Save Threshold
              </Button>
              <Button variant="secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* Thresholds List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : thresholds.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <AlertTriangle className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No thresholds set yet</p>
              <p className="text-sm mt-1">Add a threshold to start monitoring your customers' inventory</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {thresholds.map((threshold) => {
              const isLowStock = threshold.current_stock <= threshold.low_stock_threshold;
              return (
                <Card key={threshold.id} padding="md" className={isLowStock ? 'border-l-4 border-l-red-500' : ''}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Customer</p>
                        <p className="font-medium text-gray-900">{threshold.customer_name}</p>
                        <p className="text-xs text-gray-600">{threshold.customer_phone}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Item</p>
                        <p className="font-medium text-gray-900">{threshold.item_name}</p>
                        {threshold.item_code && <p className="text-xs text-gray-600">{threshold.item_code}</p>}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Threshold / Current Stock</p>
                        <p className="font-medium text-gray-900">
                          {threshold.low_stock_threshold} / {threshold.current_stock}
                        </p>
                        {isLowStock && (
                          <p className="text-xs text-red-600 font-medium flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" /> Low Stock Alert
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Location</p>
                        <p className="text-sm text-gray-700">{threshold.customer_city}, {threshold.customer_state}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteThreshold(threshold.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete threshold"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    
  );
}

