'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, Send, Clock, CheckCircle, XCircle, MessageSquare, DollarSign, FileText, Mail, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface LifecycleTimelineEntry {
  id: string;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface ProformaLifecycleManagerProps {
  invoiceId: string;
  currentStatus?: string;
  currentNotes?: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; description: string }> = {
  created: {
    label: 'Created',
    icon: FileText,
    color: 'bg-gray-100 text-gray-700 border-gray-200',
    description: 'Proforma invoice has been created'
  },
  sent: {
    label: 'Sent',
    icon: Mail,
    color: 'bg-purple-100 text-purple-700 border-purple-200',
    description: 'Proforma invoice has been sent to customer'
  },
  waiting_for_response: {
    label: 'Waiting for Response',
    icon: Clock,
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    description: 'Waiting for customer response'
  },
  customer_responded_price_change: {
    label: 'Customer Responded (Price Change)',
    icon: MessageSquare,
    color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    description: 'Customer has responded with a different price'
  },
  agreed_to_customer_price: {
    label: 'Agreed to Customer Price',
    icon: CheckCircle,
    color: 'bg-green-100 text-green-700 border-green-200',
    description: 'Agreed to customer\'s proposed price'
  },
  did_not_agree: {
    label: 'Did Not Agree',
    icon: XCircle,
    color: 'bg-red-100 text-red-700 border-red-200',
    description: 'Did not agree to customer\'s terms'
  },
  sale_made: {
    label: 'Sale Made',
    icon: DollarSign,
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    description: 'Sale has been confirmed'
  },
  converted_to_tax_invoice: {
    label: 'Converted to Tax Invoice',
    icon: CheckCircle,
    color: 'bg-teal-100 text-teal-700 border-teal-200',
    description: 'Converted to tax invoice'
  },
  cancelled: {
    label: 'Cancelled',
    icon: XCircle,
    color: 'bg-gray-100 text-gray-700 border-gray-200',
    description: 'Proforma invoice has been cancelled'
  }
};

export const ProformaLifecycleManager: React.FC<ProformaLifecycleManagerProps> = ({
  invoiceId,
  currentStatus: initialStatus,
  currentNotes: initialNotes
}) => {
  const { user } = useAuth();
  const toast = useToastContext();
  const [currentStatus, setCurrentStatus] = useState<string>(initialStatus || 'created');
  const [currentNotes, setCurrentNotes] = useState<string>(initialNotes || '');
  const [timeline, setTimeline] = useState<LifecycleTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string>(currentStatus);
  const [newNotes, setNewNotes] = useState<string>('');

  useEffect(() => {
    fetchLifecycle();
  }, [invoiceId]);

  const fetchLifecycle = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/invoices/${invoiceId}/proforma-lifecycle`);
      if (res.ok) {
        const data = await res.json();
        setCurrentStatus(data.current_status || 'created');
        setCurrentNotes(data.current_notes || '');
        setTimeline(data.timeline || []);
        setNewStatus(data.current_status || 'created');
      }
    } catch (error) {
      console.error('Error fetching lifecycle:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (newStatus === currentStatus && !newNotes.trim()) {
      return; // No change
    }

    try {
      setUpdating(true);
      const res = await fetch(`/api/invoices/${invoiceId}/proforma-lifecycle`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': user?.id || ''
        },
        body: JSON.stringify({
          status: newStatus,
          notes: newNotes.trim() || null,
          userId: user?.id || null
        })
      });

      if (res.ok) {
        await fetchLifecycle();
        setNewNotes(''); // Clear notes after successful update
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to update lifecycle status');
      }
    } catch (error) {
      console.error('Error updating lifecycle:', error);
      toast.error('Failed to update lifecycle status');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      </Card>
    );
  }

  const statusOptions = Object.entries(STATUS_CONFIG).map(([value, config]) => ({
    value,
    ...config
  }));

  const currentStatusConfig = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.created;
  const CurrentIcon = currentStatusConfig.icon;

  return (
    <Card padding="md" className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Proforma Invoice Lifecycle</h3>
        <p className="text-sm text-gray-600">
          Track the complete lifecycle of this proforma invoice from creation to conversion or cancellation.
        </p>
      </div>

      {/* Current Status */}
      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className={`p-2 rounded-lg ${currentStatusConfig.color}`}>
          <CurrentIcon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{currentStatusConfig.label}</p>
          <p className="text-sm text-gray-600">{currentStatusConfig.description}</p>
        </div>
      </div>

      {/* Update Status Section */}
      <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h4 className="font-semibold text-gray-900">Update Lifecycle Status</h4>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            New Status
          </label>
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes (Optional)
          </label>
          <textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Add notes about this status change..."
            rows={3}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <Button
          onClick={handleUpdateStatus}
          disabled={updating || (newStatus === currentStatus && !newNotes.trim())}
          variant="primary"
          className="w-full"
        >
          {updating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Updating...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Update Status
            </>
          )}
        </Button>
      </div>

      {/* Timeline */}
      {timeline.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-4">Lifecycle Timeline</h4>
          <div className="space-y-4">
            {timeline.map((entry, index) => {
              const config = STATUS_CONFIG[entry.status] || STATUS_CONFIG.created;
              const Icon = config.icon;
              const isLast = index === timeline.length - 1;

              return (
                <div key={entry.id} className="relative pl-8 pb-6">
                  {/* Timeline line */}
                  {!isLast && (
                    <div className="absolute left-3 top-8 bottom-0 w-0.5 bg-gray-200" />
                  )}
                  
                  {/* Timeline dot */}
                  <div className={`absolute left-0 top-1 p-1.5 rounded-full ${config.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Timeline content */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{config.label}</p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(entry.created_at), 'MMM dd, yyyy hh:mm a')}
                          {entry.created_by_name && ` • by ${entry.created_by_name}`}
                        </p>
                      </div>
                    </div>
                    {entry.notes && (
                      <p className="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded border border-gray-100">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

