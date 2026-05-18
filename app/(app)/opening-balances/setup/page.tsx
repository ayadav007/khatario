'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, ArrowRight, ArrowLeft as ArrowLeftIcon, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Account, Customer, Supplier } from '@/types/database';
import Link from 'next/link';
import { format } from 'date-fns';

interface OpeningBalance {
  entity_type: 'account' | 'customer' | 'supplier';
  entity_id: string;
  entity_name?: string;
  opening_balance: string;
  opening_balance_type: 'debit' | 'credit';
  as_on_date: string;
  notes?: string;
}

export default function OpeningBalanceSetupPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [currentStep, setCurrentStep] = useState(1);
  const [financialYearId, setFinancialYearId] = useState('');
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accountBalances, setAccountBalances] = useState<OpeningBalance[]>([]);
  const [customerBalances, setCustomerBalances] = useState<OpeningBalance[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<OpeningBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  useEffect(() => {
    if (business?.id) {
      fetchAccounts();
      fetchCustomers();
      fetchSuppliers();
    }
  }, [business?.id]);

  const fetchAccounts = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/accounts?business_id=${business.id}&is_active=true&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        // Initialize account balances
        setAccountBalances(
          (data.accounts || []).map((acc: Account) => ({
            entity_type: 'account' as const,
            entity_id: acc.id,
            entity_name: acc.account_name,
            opening_balance: acc.opening_balance?.toString() || '0',
            opening_balance_type: acc.opening_balance_type || 'debit',
            as_on_date: asOnDate,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchCustomers = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/customers?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers || []);
        setCustomerBalances(
          (data.customers || []).map((cust: Customer) => ({
            entity_type: 'customer' as const,
            entity_id: cust.id,
            entity_name: cust.name,
            opening_balance: '0',
            opening_balance_type: 'debit' as const,
            as_on_date: asOnDate,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchSuppliers = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/suppliers?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.suppliers || []);
        setSupplierBalances(
          (data.suppliers || []).map((sup: Supplier) => ({
            entity_type: 'supplier' as const,
            entity_id: sup.id,
            entity_name: sup.name,
            opening_balance: '0',
            opening_balance_type: 'credit' as const,
            as_on_date: asOnDate,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const updateBalance = (
    entityType: 'account' | 'customer' | 'supplier',
    entityId: string,
    field: 'opening_balance' | 'opening_balance_type',
    value: string
  ) => {
    if (entityType === 'account') {
      setAccountBalances((prev) =>
        prev.map((bal) =>
          bal.entity_id === entityId ? { ...bal, [field]: value } : bal
        )
      );
    } else if (entityType === 'customer') {
      setCustomerBalances((prev) =>
        prev.map((bal) =>
          bal.entity_id === entityId ? { ...bal, [field]: value } : bal
        )
      );
    } else {
      setSupplierBalances((prev) =>
        prev.map((bal) =>
          bal.entity_id === entityId ? { ...bal, [field]: value } : bal
        )
      );
    }
  };

  const validateBalances = async () => {
    if (!business?.id) return;

    setValidating(true);
    try {
      const allBalances = [...accountBalances, ...customerBalances, ...supplierBalances];
      const res = await fetch('/api/opening-balances/validate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          financial_year_id: financialYearId || null,
          opening_balances: allBalances
            .filter((bal) => parseFloat(bal.opening_balance) !== 0)
            .map((bal) => ({
              entity_type: bal.entity_type,
              entity_id: bal.entity_id,
              opening_balance: parseFloat(bal.opening_balance) || 0,
              opening_balance_type: bal.opening_balance_type,
            })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setValidationResult(data);
      }
    } catch (error) {
      console.error('Error validating balances:', error);
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const allBalances = [
        ...accountBalances.filter((bal) => parseFloat(bal.opening_balance) !== 0),
        ...customerBalances.filter((bal) => parseFloat(bal.opening_balance) !== 0),
        ...supplierBalances.filter((bal) => parseFloat(bal.opening_balance) !== 0),
      ];

      const res = await fetch('/api/opening-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          financial_year_id: financialYearId || null,
          opening_balances: allBalances.map((bal) => ({
            entity_type: bal.entity_type,
            entity_id: bal.entity_id,
            opening_balance: parseFloat(bal.opening_balance) || 0,
            opening_balance_type: bal.opening_balance_type,
            as_on_date: asOnDate,
            notes: bal.notes || null,
          })),
        }),
      });

      if (res.ok) {
        toast.success('Opening balances set successfully!');
        // Optionally redirect or reset
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to set opening balances');
      }
    } catch (error) {
      console.error('Error setting opening balances:', error);
      toast.error('Failed to set opening balances');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Financial Year (Optional)
              </label>
              <Input
                type="text"
                placeholder="e.g., 2024-2025"
                value={financialYearId}
                onChange={(e) => setFinancialYearId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                As On Date *
              </label>
              <Input
                type="date"
                value={asOnDate}
                onChange={(e) => setAsOnDate(e.target.value)}
                required
              />
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Account Opening Balances</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold text-text-primary">Account</th>
                    <th className="text-right py-2 px-3 font-semibold text-text-primary">Balance</th>
                    <th className="text-center py-2 px-3 font-semibold text-text-primary">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBalances.map((bal) => (
                    <tr key={bal.entity_id} className="border-b border-border">
                      <td className="py-3 px-3">
                        {accounts.find((a) => a.id === bal.entity_id)?.account_name || '-'}
                      </td>
                      <td className="py-3 px-3">
                        <Input
                          type="number"
                          step="0.01"
                          value={bal.opening_balance}
                          onChange={(e) =>
                            updateBalance('account', bal.entity_id, 'opening_balance', e.target.value)
                          }
                          className="text-right"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <select
                          value={bal.opening_balance_type}
                          onChange={(e) =>
                            updateBalance(
                              'account',
                              bal.entity_id,
                              'opening_balance_type',
                              e.target.value as 'debit' | 'credit'
                            )
                          }
                          className="input"
                        >
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Customer Opening Balances</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold text-text-primary">Customer</th>
                    <th className="text-right py-2 px-3 font-semibold text-text-primary">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {customerBalances.map((bal) => (
                    <tr key={bal.entity_id} className="border-b border-border">
                      <td className="py-3 px-3">{bal.entity_name || '-'}</td>
                      <td className="py-3 px-3">
                        <Input
                          type="number"
                          step="0.01"
                          value={bal.opening_balance}
                          onChange={(e) =>
                            updateBalance('customer', bal.entity_id, 'opening_balance', e.target.value)
                          }
                          className="text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Supplier Opening Balances</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold text-text-primary">Supplier</th>
                    <th className="text-right py-2 px-3 font-semibold text-text-primary">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierBalances.map((bal) => (
                    <tr key={bal.entity_id} className="border-b border-border">
                      <td className="py-3 px-3">{bal.entity_name || '-'}</td>
                      <td className="py-3 px-3">
                        <Input
                          type="number"
                          step="0.01"
                          value={bal.opening_balance}
                          onChange={(e) =>
                            updateBalance('supplier', bal.entity_id, 'opening_balance', e.target.value)
                          }
                          className="text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 5:
        const accountBalancesNonZero = accountBalances.filter(
          (bal) => parseFloat(bal.opening_balance) !== 0
        );
        const customerBalancesNonZero = customerBalances.filter(
          (bal) => parseFloat(bal.opening_balance) !== 0
        );
        const supplierBalancesNonZero = supplierBalances.filter(
          (bal) => parseFloat(bal.opening_balance) !== 0
        );

        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Review Opening Balances</h3>
              <p className="text-sm text-text-secondary mb-4">
                Please review all opening balances before submitting.
              </p>
            </div>

            {validationResult && (
              <div
                className={`p-4 rounded-lg ${
                  validationResult.is_valid
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <p className={`font-semibold ${validationResult.is_valid ? 'text-green-800' : 'text-red-800'}`}>
                  {validationResult.message}
                </p>
                {!validationResult.is_valid && (
                  <p className="text-sm text-red-700 mt-1">
                    Total Debit: ₹{validationResult.total_debit?.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                    })}
                    <br />
                    Total Credit: ₹{validationResult.total_credit?.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                    })}
                    <br />
                    Difference: ₹{validationResult.difference?.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                )}
              </div>
            )}

            <div>
              <h4 className="font-semibold text-text-primary mb-2">Summary</h4>
              <div className="space-y-2 text-sm">
                <p>Accounts: {accountBalancesNonZero.length} with balances</p>
                <p>Customers: {customerBalancesNonZero.length} with balances</p>
                <p>Suppliers: {supplierBalancesNonZero.length} with balances</p>
                <p>As On Date: {format(new Date(asOnDate), 'dd MMM yyyy')}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={validateBalances} disabled={validating} variant="secondary">
                {validating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Validate Balances
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/accounts">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Accounts
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-text-primary">Opening Balance Setup</h1>
          <div></div>
        </div>

        <Card>
          {/* Step Indicator */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              {[1, 2, 3, 4, 5].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                      currentStep === step
                        ? 'bg-primary-500 text-white'
                        : currentStep > step
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {currentStep > step ? <Check className="w-4 h-4" /> : step}
                  </div>
                  {step < 5 && (
                    <div
                      className={`flex-1 h-1 mx-2 ${
                        currentStep > step ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-sm text-text-secondary">
              <span>Setup</span>
              <span>Accounts</span>
              <span>Customers</span>
              <span>Suppliers</span>
              <span>Review</span>
            </div>
          </div>

          {/* Step Content */}
          <div className="mb-6">{renderStepContent()}</div>

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-border">
            <Button
              variant="secondary"
              onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
              disabled={currentStep === 1}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>
            {currentStep < 5 ? (
              <Button onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1))}>
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={loading || (validationResult && !validationResult.is_valid)}>
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Submit Opening Balances
              </Button>
            )}
          </div>
        </Card>
      </div>
    
  );
}

