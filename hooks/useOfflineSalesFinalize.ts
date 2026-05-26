'use client';

import { useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOfflineSync } from '@/contexts/OfflineSyncContext';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';
import { canQueueOfflineActions } from '@/lib/offline/connectivity/state-machine';
import {
  generateOfflineInvoiceReference,
  getOfflineDeviceLabel,
} from '@/lib/offline/invoicing/offline-invoice-number';
import { applyStockReservation, checkStockAvailability } from '@/lib/offline/stock/stock-reservation';
import { applyOptimisticCustomerBalance } from '@/lib/offline/customers/customer-balance-cache';
import type { TenantScope } from '@/lib/offline/types';

export interface OfflineSalesFinalizeInput {
  payload: Record<string, unknown>;
  stockLines?: Array<{
    itemId: string;
    quantity: number;
    variantId?: string | null;
    locationId?: string | null;
  }>;
  customerId?: string | null;
  balanceDue?: number;
  allowNegativeStock?: boolean;
}

export interface OfflineSalesFinalizeResult {
  queued: boolean;
  actionId?: string;
  offlineReferenceNumber?: string;
  displayInvoiceNumber?: string;
  stockWarnings?: string[];
}

export function useOfflineSalesFinalize() {
  const { business, user } = useAuth();
  const { connectivity } = useOfflineSync();
  const { mutate } = useOptimisticMutation();
  const idempotencyRef = useRef<string | null>(null);

  const canQueueOffline = canQueueOfflineActions(connectivity.state);

  const queueSalesFinalize = useCallback(
    async (input: OfflineSalesFinalizeInput): Promise<OfflineSalesFinalizeResult> => {
      if (!business?.id || !user?.id) {
        throw new Error('Not authenticated');
      }
      if (!canQueueOffline) {
        return { queued: false };
      }

      const scope: TenantScope = { businessId: business.id, userId: user.id };
      const { offlineReferenceNumber, deviceLabel } =
        await generateOfflineInvoiceReference();
      const deviceId = await getOfflineDeviceLabel();

      const stockWarnings: string[] = [];
      const reservationLines = [];

      for (const line of input.stockLines ?? []) {
        if (!line.itemId || line.quantity <= 0) continue;
        const check = await checkStockAvailability({
          scope,
          itemId: line.itemId,
          quantity: line.quantity,
          variantId: line.variantId,
          locationId: line.locationId,
          allowNegative: input.allowNegativeStock,
        });
        if (check.warning) stockWarnings.push(check.warning);
        reservationLines.push({
          itemId: line.itemId,
          variantId: line.variantId,
          locationId: line.locationId,
          quantity: line.quantity,
          reservedAt: Date.now(),
        });
      }

      if (!idempotencyRef.current) {
        idempotencyRef.current = `sales.finalize:${business.id}:${offlineReferenceNumber}`;
      }

      const payload = {
        ...input.payload,
        status: 'final',
        offline_reference_number: offlineReferenceNumber,
        device_id: deviceId,
        business_id: business.id,
        created_by: user.id,
      };

      const { queued, actionId } = await mutate({
        type: 'sales.finalize',
        payload,
        idempotencyKey: idempotencyRef.current,
      });

      if (queued && reservationLines.length > 0 && actionId) {
        await applyStockReservation({
          scope,
          lines: reservationLines.map((l) => ({ ...l, actionId })),
        });
      }

      if (
        queued &&
        input.customerId &&
        (input.balanceDue ?? 0) > 0
      ) {
        await applyOptimisticCustomerBalance({
          scope,
          customerId: input.customerId,
          balanceDelta: input.balanceDue ?? 0,
          invoiceReference: offlineReferenceNumber,
        });
      }

      return {
        queued,
        actionId,
        offlineReferenceNumber,
        displayInvoiceNumber: offlineReferenceNumber,
        stockWarnings,
      };
    },
    [business?.id, user?.id, canQueueOffline, mutate]
  );

  const resetIdempotency = useCallback(() => {
    idempotencyRef.current = null;
  }, []);

  return {
    canQueueOffline,
    queueSalesFinalize,
    resetIdempotency,
  };
}
