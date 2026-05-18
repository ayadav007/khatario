'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, UploadCloud, X, Receipt } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { uploadImage } from '@/lib/image-upload';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface ExpenseCategory {
  id: string;
  category_name: string;
}

interface Employee {
  id: string;
  name: string;
  employee_code: string;
}

export default function NewExpensePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'expenses',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [uploading, setUploading] = useState(false);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    employee_id: '',
    expense_category_id: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    currency: 'INR',
    description: '',
    payment_mode: '',
    vendor_name: '',
    receipt_url: '',
    is_billable: false,
    billable_to_customer_id: '',
    billable_to_project: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (business?.id) {
      fetchCategories();
      fetchEmployees();
    }
  }, [business?.id]);

  const fetchCategories = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/expense-categories?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchEmployees = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/employees?business_id=${business.id}&status=active&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees.map((emp: any) => ({
          id: emp.id,
          name: emp.user_name || emp.employee_code,
          employee_code: emp.employee_code,
        })));
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !business?.id) return;

    setUploading(true);
    try {
      const imageUrl = await uploadImage(file, business.id, 'expense_receipts');
      setFormData(prev => ({ ...prev, receipt_url: imageUrl }));
      setReceiptPreview(imageUrl);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      toast.error('Failed to upload receipt. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.employee_id) newErrors.employee_id = 'Employee is required';
    if (!formData.expense_date) newErrors.expense_date = 'Expense date is required';
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      newErrors.amount = 'Valid amount is required';
    }
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !validateForm()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          amount: parseFloat(formData.amount),
          expense_category_id: formData.expense_category_id || null,
          billable_to_customer_id: formData.billable_to_customer_id || null,
          created_by: user?.id, // Required for authorization
        }),
      });

      if (res.ok) {
        router.push('/employees/expenses');
        router.refresh();
      } else {
        const errorData = await safeJsonParse(res);
        setErrors({ general: getApiErrorMessage(errorData, 'Failed to submit expense') });
        toast.error(getApiErrorMessage(errorData, 'Failed to submit expense'));
      }
    } catch (error) {
      console.error('Error submitting expense:', error);
      setErrors({ general: 'An unexpected error occurred' });
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="expenses"
          action="create"
          details={reason}
          code="EXPENSE_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <Link href="/employees/expenses">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Expenses
          </Button>
        </Link>

        <Card padding="md">
          <h1 className="text-2xl font-bold text-text-primary mb-6">Submit Expense</h1>

          {errors.general && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Employee *
                </label>
                <select
                  value={formData.employee_id}
                  onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                  className={`input ${errors.employee_id ? 'border-red-500' : ''}`}
                  required
                >
                  <option value="">Select Employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
                {errors.employee_id && (
                  <p className="text-xs text-red-500 mt-1">{errors.employee_id}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Category (Optional)
                </label>
                <select
                  value={formData.expense_category_id}
                  onChange={(e) => setFormData({ ...formData, expense_category_id: e.target.value })}
                  className="input"
                >
                  <option value="">Select Category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.category_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Expense Date *
                </label>
                <Input
                  type="date"
                  value={formData.expense_date}
                  onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                  required
                  error={errors.expense_date}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Amount (₹) *
                </label>
                <Input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                  min="0.01"
                  step="0.01"
                  error={errors.amount}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Payment Mode
                </label>
                <select
                  value={formData.payment_mode}
                  onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })}
                  className="input"
                >
                  <option value="">Select Payment Mode</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Vendor Name (Optional)
                </label>
                <Input
                  type="text"
                  value={formData.vendor_name}
                  onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                  placeholder="Enter vendor name"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Description *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={`input ${errors.description ? 'border-red-500' : ''}`}
                rows={4}
                placeholder="Enter expense description..."
                required
              />
              {errors.description && (
                <p className="text-xs text-red-500 mt-1">{errors.description}</p>
              )}
            </div>

            {/* Receipt Upload */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Receipt (Optional)
              </label>
              {receiptPreview ? (
                <div className="relative inline-block">
                  <img
                    src={receiptPreview}
                    alt="Receipt preview"
                    className="max-w-xs max-h-48 rounded-lg border border-border"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 bg-black bg-opacity-50 text-white hover:bg-opacity-75"
                    onClick={() => {
                      setReceiptPreview(null);
                      setFormData(prev => ({ ...prev, receipt_url: '' }));
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                  {uploading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                  ) : (
                    <>
                      <UploadCloud className="w-6 h-6 text-primary-500 mb-2" />
                      <span className="text-sm text-text-secondary">Click to upload receipt</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={handleReceiptUpload}
                    disabled={uploading}
                  />
                </label>
              )}
              <p className="text-xs text-text-secondary mt-2">JPG, PNG, PDF (Max 5MB)</p>
            </div>

            {/* Billable Options */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="is_billable"
                  checked={formData.is_billable}
                  onChange={(e) => setFormData({ ...formData, is_billable: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="is_billable" className="text-sm font-medium text-text-primary">
                  This expense is billable to customer/project
                </label>
              </div>
              {formData.is_billable && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                  <Input
                    label="Billable to Customer ID (Optional)"
                    type="text"
                    value={formData.billable_to_customer_id}
                    onChange={(e) => setFormData({ ...formData, billable_to_customer_id: e.target.value })}
                    placeholder="Customer ID"
                  />
                  <Input
                    label="Billable to Project (Optional)"
                    type="text"
                    value={formData.billable_to_project}
                    onChange={(e) => setFormData({ ...formData, billable_to_project: e.target.value })}
                    placeholder="Project name"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-4">
              <Link href="/employees/expenses">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Expense
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

