'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToastContext } from '@/contexts/ToastContext';

export type PaymentMethodFormState = {
  method_type: string;
  method_name: string;
  upi_id: string;
  wallet_provider: string;
  is_active: boolean;
  is_default: boolean;
  priority: number;
  notes: string;
};

const DEFAULT_FORM: PaymentMethodFormState = {
  method_type: 'upi',
  method_name: '',
  upi_id: '',
  wallet_provider: '',
  is_active: true,
  is_default: false,
  priority: 0,
  notes: '',
};

export function usePaymentMethods(args: { businessId?: string | null }) {
  const { businessId } = args;
  const toast = useToastContext();

  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [showPaymentMethodForm, setShowPaymentMethodForm] = useState(false);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<any>(null);
  const [paymentMethodForm, setPaymentMethodForm] =
    useState<PaymentMethodFormState>(DEFAULT_FORM);

  const fetchPaymentMethods = useCallback(async () => {
    if (!businessId) return;

    setLoadingPaymentMethods(true);
    try {
      const res = await fetch(`/api/payment-methods?business_id=${businessId}`);
      const data = await res.json();

      if (res.ok) {
        setPaymentMethods(data.methods || []);
      } else {
        // Keep behavior consistent: do not hard-fail the page.
        console.error('[Payment Methods] Failed to fetch:', data);
      }
    } catch (error) {
      console.error('[Payment Methods] Error fetching:', error);
    } finally {
      setLoadingPaymentMethods(false);
    }
  }, [businessId]);

  useEffect(() => {
    void fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const startCreatePaymentMethod = useCallback(() => {
    setEditingPaymentMethod(null);
    setPaymentMethodForm(DEFAULT_FORM);
    setShowPaymentMethodForm(true);
  }, []);

  const startEditPaymentMethod = useCallback((method: any) => {
    setEditingPaymentMethod(method);
    setPaymentMethodForm({
      method_type: method.method_type || 'upi',
      method_name: method.method_name || '',
      upi_id: method.upi_id || '',
      wallet_provider: method.wallet_provider || '',
      is_active: method.is_active !== false,
      is_default: method.is_default || false,
      priority: method.priority || 0,
      notes: method.notes || '',
    });
    setShowPaymentMethodForm(true);
  }, []);

  const cancelPaymentMethodForm = useCallback(() => {
    setShowPaymentMethodForm(false);
    setEditingPaymentMethod(null);
    setPaymentMethodForm(DEFAULT_FORM);
  }, []);

  const submitPaymentMethod = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!businessId) {
        toast.error('Business ID is missing. Please refresh the page.');
        return;
      }

      if (!paymentMethodForm.method_name) {
        toast.warning('Please enter a payment method name');
        return;
      }

      if (paymentMethodForm.method_type === 'upi' && !paymentMethodForm.upi_id) {
        toast.warning('Please enter UPI ID');
        return;
      }

      try {
        const url = '/api/payment-methods';
        const method = editingPaymentMethod ? 'PUT' : 'POST';
        const body = editingPaymentMethod
          ? { id: editingPaymentMethod.id, business_id: businessId, ...paymentMethodForm }
          : { business_id: businessId, ...paymentMethodForm };

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const responseData = await res.json();
        if (res.ok) {
          toast.success(
            `Payment method ${editingPaymentMethod ? 'updated' : 'added'} successfully!`
          );
          cancelPaymentMethodForm();
          await fetchPaymentMethods();
        } else {
          toast.error(
            `Failed to ${editingPaymentMethod ? 'update' : 'add'} payment method: ${
              responseData.error || 'Unknown error'
            }`
          );
        }
      } catch (error: any) {
        console.error('Error saving payment method:', error);
        toast.error(`Failed to save payment method: ${error.message || 'Network error'}`);
      }
    },
    [
      businessId,
      toast,
      paymentMethodForm,
      editingPaymentMethod,
      fetchPaymentMethods,
      cancelPaymentMethodForm,
    ]
  );

  const deletePaymentMethod = useCallback(
    async (id: string) => {
      if (!businessId) return;
      if (!confirm('Are you sure you want to delete this payment method?')) return;

      try {
        const res = await fetch(`/api/payment-methods?id=${id}&business_id=${businessId}`, {
          method: 'DELETE',
        });

        if (res.ok) {
          toast.success('Payment method deleted successfully!');
          await fetchPaymentMethods();
        } else {
          const data = await res.json();
          toast.error(`Failed to delete payment method: ${data.error}`);
        }
      } catch (error) {
        console.error('Error deleting payment method:', error);
        toast.error('Failed to delete payment method');
      }
    },
    [businessId, toast, fetchPaymentMethods]
  );

  return {
    paymentMethods,
    loadingPaymentMethods,
    showPaymentMethodForm,
    editingPaymentMethod,
    paymentMethodForm,
    setPaymentMethodForm,
    fetchPaymentMethods,
    startCreatePaymentMethod,
    startEditPaymentMethod,
    cancelPaymentMethodForm,
    submitPaymentMethod,
    deletePaymentMethod,
  };
}

