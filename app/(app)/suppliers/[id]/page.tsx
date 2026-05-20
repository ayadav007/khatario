'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { MessageCircle, FileText, Loader2, Edit } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { useAuth } from '@/contexts/AuthContext';
import { useEntityRecord } from '@/hooks/useEntityRecord';
import { useToastContext } from '@/contexts/ToastContext';
import { supplierBalanceCardTitle } from '@/lib/party-balance-ui';
import { DeleteAction } from '@/components/common/DeleteAction';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  opening_balance: number;
  opening_balance_type: string;
  linked_business_id?: string;
  allow_low_stock_access?: boolean;
}

interface Purchase {
  id: string;
  bill_number: string;
  bill_date: string;
  grand_total: number;
  paid_amount: number;
  status: string;
}

interface Payment {
  id: string;
  amount: number;
  payment_mode: string;
  payment_date: string;
  notes?: string;
}

export default function SupplierDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [activeTab, setActiveTab] = useState<'summary' | 'purchases' | 'payments' | 'documents'>('summary');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalPayable, setTotalPayable] = useState(0);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);
  const [updatingAccess, setUpdatingAccess] = useState(false);

  const { data: supplier, loading, refetch } = useEntityRecord<Supplier>({
    recordId: params.id,
    apiUrl: (id) => `/api/suppliers/${id}`,
    responseKey: 'supplier',
  });

  useMobileHeaderTitleOverride(supplier?.name);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/suppliers/${params.id}?user_id=${user?.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.purchases) setPurchases(data.purchases);
        if (data.payments) setPayments(data.payments);
        if (data.totalPayable != null) setTotalPayable(data.totalPayable);
      })
      .catch(() => {});
  }, [params.id, user?.id]);

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!supplier) {
    return (
      
        <div className="p-6 text-center">Supplier not found</div>
      
    );
  }

  const lastPurchase = purchases[0];

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title={supplier.name}
          description={supplier.phone || undefined}
        />

        {/* Supplier Header */}
        <Card padding="md">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-2 hidden md:block">{supplier.name}</h2>
              {supplier.phone && (
                <p className="text-text-secondary flex items-center gap-2">
                  <span>{supplier.phone}</span>
                </p>
              )}
              {supplier.email && (
                <p className="text-text-secondary text-sm mt-1">{supplier.email}</p>
              )}
              <p className="text-text-secondary text-sm mt-1">
                {[supplier.address, supplier.city, supplier.state].filter(Boolean).join(', ')}
              </p>
              {supplier.pincode && (
                <p className="text-text-secondary text-sm mt-1">Pincode: {supplier.pincode}</p>
              )}
              {supplier.gstin && (
                <p className="text-text-secondary text-sm mt-1">GSTIN: {supplier.gstin}</p>
              )}
              {supplier.linked_business_id && (
                <div className="mt-4 p-3 bg-slate-50 border border-primary-200 rounded-lg">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={supplier.allow_low_stock_access || false}
                      onChange={async (e) => {
                        if (!supplier.linked_business_id) {
                          toast.warning('Supplier must be linked to a business account to grant low stock access.');
                          return;
                        }
                        if (!user?.id || !business?.id) {
                          toast.error('You must be signed in to update supplier settings.');
                          return;
                        }
                        setUpdatingAccess(true);
                        try {
                          const res = await fetch(`/api/suppliers/${supplier.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              business_id: business.id,
                              allow_low_stock_access: e.target.checked,
                              updated_by_user_id: user.id,
                            }),
                          });
                          if (res.ok) {
                            refetch();
                          } else {
                            const error = await res.json();
                            toast.error(error.error || 'Failed to update access');
                          }
                        } catch (error) {
                          console.error('Error updating access:', error);
                          toast.error('Failed to update access');
                        } finally {
                          setUpdatingAccess(false);
                        }
                      }}
                      disabled={updatingAccess || !supplier.linked_business_id}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Allow supplier to see low stock</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {supplier.allow_low_stock_access 
                          ? 'Supplier can view your low stock alerts'
                          : 'Enable to allow supplier to view your low stock alerts'}
                      </p>
                      {!supplier.linked_business_id && (
                        <p className="text-xs text-amber-600 mt-1">
                          Link to business account first to enable this feature
                        </p>
                      )}
                    </div>
                  </label>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button 
                variant="secondary"
                onClick={() => {
                  if (!supplier.phone) {
                    toast.warning('Supplier phone number not available');
                    return;
                  }
                  // Navigate to WhatsApp conversations with phone number
                  router.push(`/whatsapp/conversations?phone=${encodeURIComponent(supplier.phone)}`);
                }}
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
              <DeleteAction
                entityName="supplier"
                variant="delete"
                deleteFn={async () => {
                  if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                  const res = await fetch(
                    `/api/suppliers/${supplier.id}?business_id=${business.id}&user_id=${user.id}`,
                    { method: 'DELETE' }
                  );
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data?.error || 'Failed to delete supplier');
                }}
                onSuccess={async () => {
                  router.push('/suppliers');
                }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card
              padding="md"
              className={
                totalPayable < -0.005
                  ? 'bg-emerald-50 border border-emerald-100'
                  : 'bg-warning-50'
              }
            >
              <p className="text-sm text-text-secondary mb-1">{supplierBalanceCardTitle(totalPayable)}</p>
              <p
                className={`text-2xl font-bold ${
                  totalPayable < -0.005 ? 'text-emerald-900' : 'text-text-primary'
                }`}
              >
                ₹ {totalPayable.toLocaleString('en-IN')}
              </p>
              {totalPayable < -0.005 && (
                <p className="text-xs text-text-muted mt-2">
                  Negative balance means you paid more than owed — advance to supplier / prepaid.
                </p>
              )}
              {totalPayable > 0.005 && (
                <p className="text-xs text-text-muted mt-2">Amount you still owe this supplier (net of payments).</p>
              )}
            </Card>
            <Card padding="md" className="bg-accent-50">
              <p className="text-sm text-text-secondary mb-1">Last Purchase Date</p>
              <p className="text-2xl font-bold text-text-primary">
                {lastPurchase ? format(new Date(lastPurchase.bill_date), 'dd MMM yyyy') : 'N/A'}
              </p>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Link href={`/purchases/new?supplier_id=${supplier.id}`}>
              <Button>Create Purchase</Button>
            </Link>
            <Button variant="secondary">Make Payment</Button>
            <Button variant="ghost">
              <FileText className="w-4 h-4 mr-2" />
              Export Statement
            </Button>
          </div>
        </Card>

        {/* Tabs */}
        <Card padding="none">
          <div className="border-b border-border">
            <div className="flex">
              {(['summary', 'purchases', 'payments', 'documents'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? 'text-primary-500 border-b-2 border-primary-500'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'purchases' && (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr className="table-header">
                      <th className="table-cell text-left">Date</th>
                      <th className="table-cell text-left">Bill Number</th>
                      <th className="table-cell text-right">Grand Total</th>
                      <th className="table-cell text-right">Paid</th>
                      <th className="table-cell text-right">Balance</th>
                      <th className="table-cell text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.length > 0 ? (
                      purchases.map((purchase) => (
                        <tr key={purchase.id} className="hover:bg-slate-50 transition-colors">
                          <td className="table-cell text-left">
                            {format(new Date(purchase.bill_date), 'dd MMM yyyy')}
                          </td>
                          <td className="table-cell text-left">{purchase.bill_number}</td>
                          <td className="table-cell text-right font-medium">
                            ₹ {Number(purchase.grand_total).toLocaleString('en-IN')}
                          </td>
                          <td className="table-cell text-right">
                            ₹ {Number(purchase.paid_amount).toLocaleString('en-IN')}
                          </td>
                          <td className="table-cell text-right font-medium">
                            ₹ {(Number(purchase.grand_total) - Number(purchase.paid_amount)).toLocaleString('en-IN')}
                          </td>
                          <td className="table-cell text-left">
                            <Chip variant={purchase.status === 'paid' ? 'success' : purchase.status === 'cancelled' ? 'error' : 'warning'}>
                              {purchase.status.toUpperCase()}
                            </Chip>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-text-secondary">
                          No purchases found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr className="table-header">
                      <th className="table-cell text-left">Date</th>
                      <th className="table-cell text-left">Payment Mode</th>
                      <th className="table-cell text-right">Amount</th>
                      <th className="table-cell text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length > 0 ? (
                      payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                          <td className="table-cell text-left">
                            {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                          </td>
                          <td className="table-cell text-left">{payment.payment_mode}</td>
                          <td className="table-cell text-right font-medium">
                            ₹ {Number(payment.amount).toLocaleString('en-IN')}
                          </td>
                          <td className="table-cell text-left">{payment.notes || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-text-secondary">
                          No payments found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            
            {activeTab === 'summary' && (
              <div className="text-sm text-text-secondary space-y-2">
                <p>Opening Balance: ₹ {Number(supplier.opening_balance || 0).toLocaleString('en-IN')} ({supplier.opening_balance_type})</p>
                <p>Total Purchases: {purchases.length}</p>
                <p>Total Payments: {payments.length}</p>
                <p>
                  {supplierBalanceCardTitle(totalPayable)}: ₹ {totalPayable.toLocaleString('en-IN')}
                </p>
              </div>
            )}

            {activeTab === 'documents' && supplier && business && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-text-primary">KYC Documents</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowDocumentUploader(!showDocumentUploader)}
                  >
                    {showDocumentUploader ? 'Hide Uploader' : 'Add Document'}
                  </Button>
                </div>
                {showDocumentUploader && (
                  <div className="mb-4">
                    <DocumentUploader
                      entityType="supplier"
                      entityId={supplier.id}
                      businessId={business.id}
                      onUploadSuccess={() => {
                        setShowDocumentUploader(false);
                      }}
                    />
                  </div>
                )}
                <DocumentList
                  entityType="supplier"
                  entityId={supplier.id}
                  businessId={business.id}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    
  );
}
