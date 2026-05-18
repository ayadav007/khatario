'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';

interface TransferItem {
  id: string;
  item_id: string;
  item_name: string;
  quantity_requested: number;
  quantity_dispatched: number;
  received_qty: number | null;
  unit: string;
}

interface Transfer {
  id: string;
  transfer_number: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  status: string;
}

export default function ReceiveTransferPage() {
  const router = useRouter();
  const params = useParams();
  const transferId = params.id as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { canModify } = usePermissions();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [items, setItems] = useState<TransferItem[]>([]);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (business?.id && user?.id && transferId) {
      fetchTransferData();
    }
  }, [business, user, transferId]);

  async function fetchTransferData() {
    if (!business?.id || !user?.id || !transferId) return;

    try {
      // Fetch transfer
      const transferResponse = await fetch(`/api/stock-transfers?business_id=${business.id}&user_id=${user.id}`);
      
      if (!transferResponse.ok) {
        throw new Error('Failed to fetch transfer');
      }
      
      const transferData = await transferResponse.json();
      const foundTransfer = (transferData.transfers || []).find((t: Transfer) => t.id === transferId);
      
      if (!foundTransfer) {
        toast.error('Transfer not found');
        router.push('/stock-transfers');
        return;
      }

      if (foundTransfer.status !== 'in_transit') {
        toast.warning('Transfer is not in transit. Only in-transit transfers can be received.');
        router.push(`/stock-transfers/${transferId}`);
        return;
      }

      setTransfer(foundTransfer);

      // Fetch transfer items
      const itemsResponse = await fetch(`/api/stock-transfers/${transferId}/items?business_id=${business.id}&user_id=${user.id}`);
      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json();
        const transferItems = itemsData.items || [];
        setItems(transferItems);
        
        // Initialize received quantities with dispatched quantities (default)
        const initialQuantities: Record<string, number> = {};
        transferItems.forEach((item: TransferItem) => {
          initialQuantities[item.id] = item.received_qty || item.quantity_dispatched || item.quantity_requested || 0;
        });
        setReceivedQuantities(initialQuantities);
      }
    } catch (error) {
      console.error('Error fetching transfer data:', error);
      toast.error('Failed to load transfer details');
    } finally {
      setLoading(false);
    }
  }

  function handleQuantityChange(itemId: string, value: number) {
    setReceivedQuantities(prev => ({
      ...prev,
      [itemId]: Math.max(0, value),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business || !user) return;

    // Validate quantities
    for (const item of items) {
      const receivedQty = receivedQuantities[item.id] || 0;
      const dispatchedQty = item.quantity_dispatched || item.quantity_requested || 0;

      if (receivedQty > dispatchedQty) {
        toast.error(`Cannot receive more than dispatched for item "${item.item_name}". Dispatched: ${dispatchedQty}, Received: ${receivedQty}`);
        return;
      }

      if (receivedQty <= 0) {
        toast.error(`Received quantity must be greater than 0 for item "${item.item_name}"`);
        return;
      }
    }

    setSaving(true);

    try {
      const receivedItems = items.map(item => ({
        item_id: item.item_id,
        received_qty: receivedQuantities[item.id] || 0,
        qty: receivedQuantities[item.id] || 0, // For backward compatibility
      }));

      const response = await fetch(`/api/stock-transfers/${transferId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received_items: receivedItems,
          received_by: user.id,
          business_id: business.id,
          notes: notes || null,
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        throw new Error(getApiErrorMessage(errorData, 'Failed to receive transfer'));
      }

      toast.success('Transfer received successfully!');
      router.push(`/stock-transfers/${transferId}`);
    } catch (error: any) {
      console.error('Error receiving transfer:', error);
      toast.error(error.message || 'Failed to receive transfer. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!transfer) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Transfer Not Found</h2>
          <Link href="/stock-transfers" className="text-primary-600 hover:text-primary-700">
            Back to Transfers
          </Link>
        </div>
      </div>
    );
  }

  if (!canModify('warehouse_transfer')) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You do not have permission to receive transfers.</p>
        </div>
      </div>
    );
  }

  return (
    <FormPageContainer className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link
          href={`/stock-transfers/${transferId}`}
          className="p-2 hover:bg-surface rounded-lg transition border border-border"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Receive Transfer</h1>
          <p className="text-text-secondary text-sm mt-1">
            Transfer {transfer.transfer_number} from {transfer.from_warehouse_name} to {transfer.to_warehouse_name}
          </p>
        </div>
      </div>

      <FormCard>
      <form onSubmit={handleSubmit}>
      <div className="form-page-shell">
        <FormSection title="How receipt works" description="Confirm what actually arrived; shortages are recorded as discrepancies.">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">
              <strong className="text-text-primary">Note:</strong> Enter the actual quantities received. You can receive less than dispatched if there are discrepancies.
              Stock will be added to the destination warehouse upon confirmation.
            </p>
          </div>
        </FormSection>

        <FormSection title="Received quantities" description="Per line, enter received amount; it cannot exceed dispatched.">
          {items.length === 0 ? (
            <p className="text-text-secondary">No items in this transfer</p>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                const dispatchedQty = item.quantity_dispatched || item.quantity_requested || 0;
                const receivedQty = receivedQuantities[item.id] || dispatchedQty;
                const isValid = receivedQty > 0 && receivedQty <= dispatchedQty;

                return (
                  <div key={item.id} className="border border-border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-medium text-text-primary">{item.item_name}</h3>
                        <p className="text-sm text-text-secondary">
                          Dispatched: {dispatchedQty} {item.unit}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">
                          Received Quantity *
                        </label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={receivedQty}
                          onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                          required
                          className={!isValid ? 'border-red-300' : ''}
                        />
                        {receivedQty > dispatchedQty && (
                          <p className="text-xs text-red-600 mt-1">
                            Cannot receive more than dispatched ({dispatchedQty})
                          </p>
                        )}
                        {receivedQty <= 0 && (
                          <p className="text-xs text-red-600 mt-1">
                            Quantity must be greater than 0
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">
                          Unit
                        </label>
                        <Input
                          value={item.unit}
                          disabled
                          className="bg-surface"
                        />
                      </div>
                    </div>
                    {receivedQty < dispatchedQty && (
                      <div className="mt-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2">
                        <p className="text-xs text-amber-900 dark:text-amber-200">
                          <strong>Shortage:</strong> Receiving {dispatchedQty - receivedQty} {item.unit} less than dispatched.
                          This will be recorded as a discrepancy.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>

        <FormSection title="Receipt notes" description="Optional context for damages, shortages, or other receipt details.">
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Notes
          </label>
          <textarea
            className="input w-full"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about the receipt (e.g., damages, shortages, etc.)"
          />
        </FormSection>
      </div>

        <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
          <Button
            type="button"
            onClick={() => router.push(`/stock-transfers/${transferId}`)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || items.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Receiving...
              </>
            ) : (
              'Confirm Receipt'
            )}
          </Button>
        </div>
      </form>
      </FormCard>
    </FormPageContainer>
  );
}
