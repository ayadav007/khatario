'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Search, Upload, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { format } from 'date-fns';

interface Serial {
  id: string;
  serial_number: string;
  batch_number?: string;
  purchase_price: number;
  status: 'available' | 'sold' | 'returned' | 'damaged' | 'scrapped';
  location_name?: string;
  supplier_name?: string;
  customer_name?: string;
  invoice_number?: string;
  sold_at?: string;
  created_at: string;
}

interface SerialManagerProps {
  itemId: string;
  variantId?: string;
  locationId?: string;
}

export function SerialManager({ itemId, variantId, locationId }: SerialManagerProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [serials, setSerials] = useState<Serial[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    serial_number: '',
    purchase_price: '',
  });

  const [bulkData, setBulkData] = useState({
    serials_text: '',
    purchase_price: '',
    delimiter: '\n',
  });

  const fetchSerials = useCallback(async () => {
    if (!business?.id || !itemId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
      });
      if (locationId) {
        params.append('location_id', locationId);
      }
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }

      const res = await fetch(`/api/items/${itemId}/serials?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSerials(data.serials || []);
      }
    } catch (error) {
      console.error('Error fetching serials:', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id, itemId, locationId, statusFilter]);

  useEffect(() => {
    if (business?.id && itemId) {
      fetchSerials();
    }
  }, [business?.id, itemId, fetchSerials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/items/${itemId}/serials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          variant_id: variantId || null,
          serials: [{
            serial_number: formData.serial_number,
            purchase_price: Number(formData.purchase_price),
            location_id: locationId || null,
          }],
        }),
      });

      if (res.ok) {
        await fetchSerials();
        setFormData({ serial_number: '', purchase_price: '' });
        setShowAddForm(false);
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to add serial number');
      }
    } catch (error) {
      console.error('Error adding serial:', error);
      toast.error('Failed to add serial number');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/items/${itemId}/serials/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          variant_id: variantId || null,
          serials_text: bulkData.serials_text,
          purchase_price: Number(bulkData.purchase_price),
          location_id: locationId || null,
          delimiter: bulkData.delimiter,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        await fetchSerials();
        setBulkData({ serials_text: '', purchase_price: '', delimiter: '\n' });
        setShowBulkImport(false);
        
        // Show detailed success/error message
        let message = data.message || `Successfully imported ${data.created} serial number(s).`;
        if (data.errors && data.errors.length > 0) {
          message += '\n\nErrors:\n' + data.errors.slice(0, 5).join('\n');
          if (data.errors.length > 5) {
            message += `\n... and ${data.errors.length - 5} more`;
          }
        }
        if (data.duplicates && data.duplicates > 0) {
          message += `\n\n${data.duplicates} duplicate serial number(s) were skipped.`;
        }
        
        toast.success(message);
      } else {
        const errorData = await res.json();
        let errorMessage = errorData.error || 'Failed to import serial numbers';
        if (errorData.details && Array.isArray(errorData.details)) {
          errorMessage += '\n\n' + errorData.details.slice(0, 10).join('\n');
          if (errorData.details.length > 10) {
            errorMessage += `\n... and ${errorData.details.length - 10} more`;
          }
        }
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error('Error importing serials:', error);
      toast.error('Failed to import serial numbers');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (serialId: string, newStatus: string) => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/items/${itemId}/serials/${serialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          status: newStatus,
        }),
      });

      if (res.ok) {
        await fetchSerials();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to update serial status');
      }
    } catch (error) {
      console.error('Error updating serial status:', error);
      toast.error('Failed to update serial status');
    }
  };

  const handleDelete = async (serialId: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this serial number? This can only be done if status is not "sold".')) return;

    try {
      const res = await fetch(
        `/api/items/${itemId}/serials/${serialId}?business_id=${business.id}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        await fetchSerials();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete serial number');
      }
    } catch (error) {
      console.error('Error deleting serial:', error);
      toast.error('Failed to delete serial number');
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any }> = {
      available: { color: 'bg-green-100 text-green-700', icon: CheckCircle },
      sold: { color: 'bg-slate-100 text-primary-700', icon: CheckCircle },
      returned: { color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
      damaged: { color: 'bg-orange-100 text-orange-700', icon: XCircle },
      scrapped: { color: 'bg-red-100 text-red-700', icon: XCircle },
    };
    return badges[status] || { color: 'bg-gray-100 text-gray-700', icon: AlertCircle };
  };

  const filteredSerials = serials.filter((serial) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      serial.serial_number.toLowerCase().includes(search) ||
      serial.batch_number?.toLowerCase().includes(search) ||
      serial.invoice_number?.toLowerCase().includes(search)
    );
  });

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
        <h3 className="text-lg font-semibold text-text-primary">Serial Numbers</h3>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowBulkImport(true);
              setShowAddForm(false);
            }}
          >
            <Upload className="w-4 h-4 mr-2" />
            Bulk Import
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowAddForm(true);
              setShowBulkImport(false);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Serial
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
          <Input
            placeholder="Search by serial number, batch, or invoice..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
        >
          <option value="all">All Status</option>
          <option value="available">Available</option>
          <option value="sold">Sold</option>
          <option value="returned">Returned</option>
          <option value="damaged">Damaged</option>
          <option value="scrapped">Scrapped</option>
        </select>
      </div>

      {showAddForm && (
        <Card padding="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Serial Number"
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                required
                placeholder="SN001234567"
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
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Serial'
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => {
                setShowAddForm(false);
                setFormData({ serial_number: '', purchase_price: '' });
              }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {showBulkImport && (
        <Card padding="md">
          <form onSubmit={handleBulkImport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Serial Numbers (one per line or comma-separated)
              </label>
              <textarea
                value={bulkData.serials_text}
                onChange={(e) => setBulkData({ ...bulkData, serials_text: e.target.value })}
                className="input"
                rows={6}
                placeholder="SN001&#10;SN002&#10;SN003&#10;...or&#10;SN001,SN002,SN003"
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Purchase Price (for all serials)"
                type="number"
                inputMode="decimal"
                value={bulkData.purchase_price}
                onChange={(e) => setBulkData({ ...bulkData, purchase_price: e.target.value })}
                required
                placeholder="0.00"
              />
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Delimiter
                </label>
                <select
                  value={bulkData.delimiter}
                  onChange={(e) => setBulkData({ ...bulkData, delimiter: e.target.value })}
                  className="input"
                >
                  <option value="\n">Newline</option>
                  <option value=",">Comma</option>
                  <option value=";">Semicolon</option>
                  <option value=" ">Space</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import Serials
                  </>
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => {
                setShowBulkImport(false);
                setBulkData({ serials_text: '', purchase_price: '', delimiter: '\n' });
              }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {filteredSerials.length === 0 ? (
        <Card padding="md">
          <div className="text-center py-8 text-text-secondary">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No serial numbers found</p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-border">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Serial Number</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Purchase Price</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Batch</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Location</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Sold To</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Invoice</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-text-primary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSerials.map((serial) => {
                  const statusBadge = getStatusBadge(serial.status);
                  const StatusIcon = statusBadge.icon;

                  return (
                    <tr key={serial.id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium text-text-primary font-mono">{serial.serial_number}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusBadge.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {serial.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        ₹{Number(serial.purchase_price).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {serial.batch_number || '-'}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {serial.location_name || '-'}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {serial.customer_name || '-'}
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-sm">
                        {serial.invoice_number ? (
                          <a href={`/invoices/${serial.invoice_number}`} className="text-primary-600 hover:underline">
                            {serial.invoice_number}
                          </a>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          {serial.status !== 'sold' && (
                            <select
                              value={serial.status}
                              onChange={(e) => handleStatusChange(serial.id, e.target.value)}
                              className="text-xs border border-border rounded px-2 py-1"
                            >
                              <option value="available">Available</option>
                              <option value="returned">Returned</option>
                              <option value="damaged">Damaged</option>
                              <option value="scrapped">Scrapped</option>
                            </select>
                          )}
                          {serial.status !== 'sold' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(serial.id)}
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

