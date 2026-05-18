'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Calendar, Package, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { format } from 'date-fns';

interface Batch {
  id: string;
  batch_number: string;
  manufacturing_date?: string;
  expiry_date?: string;
  purchase_price: number;
  quantity: number;
  location_name?: string;
  supplier_name?: string;
  purchase_bill_number?: string;
  notes?: string;
  created_at: string;
}

interface BatchManagerProps {
  itemId: string;
  variantId?: string;
  locationId?: string;
}

export function BatchManager({ itemId, variantId, locationId }: BatchManagerProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    batch_number: '',
    manufacturing_date: '',
    expiry_date: '',
    purchase_price: '',
    quantity: '',
    notes: '',
  });

  const fetchBatches = useCallback(async () => {
    if (!business?.id || !itemId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
      });
      if (locationId) {
        params.append('location_id', locationId);
      }

      const res = await fetch(`/api/items/${itemId}/batches?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id, itemId, locationId]);

  useEffect(() => {
    if (business?.id && itemId) {
      fetchBatches();
    }
  }, [business?.id, itemId, fetchBatches]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const url = editingBatch
        ? `/api/items/${itemId}/batches/${editingBatch.id}`
        : `/api/items/${itemId}/batches`;

      const payload = {
        business_id: business.id,
        variant_id: variantId || null,
        batch_number: formData.batch_number,
        manufacturing_date: formData.manufacturing_date || null,
        expiry_date: formData.expiry_date || null,
        purchase_price: Number(formData.purchase_price),
        quantity: Number(formData.quantity),
        location_id: locationId || null,
        notes: formData.notes || null,
      };

      const res = await fetch(url, {
        method: editingBatch ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchBatches();
        resetForm();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save batch');
      }
    } catch (error) {
      console.error('Error saving batch:', error);
      toast.error('Failed to save batch');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (batch: Batch) => {
    setEditingBatch(batch);
    setFormData({
      batch_number: batch.batch_number,
      manufacturing_date: batch.manufacturing_date ? batch.manufacturing_date.split('T')[0] : '',
      expiry_date: batch.expiry_date ? batch.expiry_date.split('T')[0] : '',
      purchase_price: batch.purchase_price.toString(),
      quantity: batch.quantity.toString(),
      notes: batch.notes || '',
    });
    setShowAddForm(true);
  };

  const handleDelete = async (batchId: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this batch? This can only be done if quantity is 0.')) return;

    try {
      const res = await fetch(
        `/api/items/${itemId}/batches/${batchId}?business_id=${business.id}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        await fetchBatches();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete batch');
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      toast.error('Failed to delete batch');
    }
  };

  const resetForm = () => {
    setFormData({
      batch_number: '',
      manufacturing_date: '',
      expiry_date: '',
      purchase_price: '',
      quantity: '',
      notes: '',
    });
    setEditingBatch(null);
    setShowAddForm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-primary">Batches</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            resetForm();
            setShowAddForm(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Batch
        </Button>
      </div>

      {showAddForm && (
        <Card padding="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Batch Number"
                value={formData.batch_number}
                onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                required
                placeholder="BATCH001"
              />
              <Input
                label="Purchase Price"
                type="number"
                inputMode="decimal"
                value={formData.purchase_price}
                onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                required
                placeholder="0.00"
              />
              <Input
                label="Quantity"
                type="number"
                inputMode="decimal"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                required
                placeholder="0"
              />
              <Input
                label="Manufacturing Date"
                type="date"
                value={formData.manufacturing_date}
                onChange={(e) => setFormData({ ...formData, manufacturing_date: e.target.value })}
              />
              <Input
                label="Expiry Date"
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
              />
            </div>
            <Input
              label="Notes (Optional)"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes about this batch"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  editingBatch ? 'Update Batch' : 'Add Batch'
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {batches.length === 0 ? (
        <Card padding="md">
          <div className="text-center py-8 text-text-secondary">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No batches found</p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-border">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Batch Number</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Quantity</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Unit Cost</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Total Value</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Manufacturing</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Expiry</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Location</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-text-primary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const isExpired = batch.expiry_date && new Date(batch.expiry_date) < new Date();
                  const isExpiringSoon = batch.expiry_date && 
                    new Date(batch.expiry_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                  return (
                    <tr key={batch.id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium text-text-primary">{batch.batch_number}</div>
                        {batch.purchase_bill_number && (
                          <div className="text-xs text-text-secondary">From: {batch.purchase_bill_number}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-primary">{batch.quantity}</td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        ₹{Number(batch.purchase_price).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-text-primary">
                        ₹{(Number(batch.quantity) * Number(batch.purchase_price)).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {batch.manufacturing_date ? format(new Date(batch.manufacturing_date), 'dd MMM yyyy') : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {batch.expiry_date ? (
                          <span className={`text-sm ${isExpired ? 'text-red-600 font-semibold' : isExpiringSoon ? 'text-orange-600' : 'text-text-secondary'}`}>
                            {format(new Date(batch.expiry_date), 'dd MMM yyyy')}
                            {isExpired && ' (Expired)'}
                            {isExpiringSoon && !isExpired && ' (Expiring Soon)'}
                          </span>
                        ) : (
                          <span className="text-text-secondary">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {batch.location_name || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(batch)}
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          {Number(batch.quantity) === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(batch.id)}
                              className="text-red-600 hover:text-red-700"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

