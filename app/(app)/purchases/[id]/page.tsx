'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ArrowLeft, Download, Edit, Loader2, Printer } from 'lucide-react';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { useAuth } from '@/contexts/AuthContext';
import { PurchasePaymentModal } from '@/components/modals/PurchasePaymentModal';
import { PrintLabelsModal } from '@/components/purchases/PrintLabelsModal';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';

function PurchaseDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const purchaseId = params.id as string;
  const { business, user } = useAuth();
  
  const [purchase, setPurchase] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showLabelsModal, setShowLabelsModal] = useState(false);
  const { hasFeature } = useFeatureRegistry();
  const canPrintLabelsFromPurchase = hasFeature('barcode_label_from_purchase');

  useEffect(() => {
    if (purchaseId && business?.id) {
      fetchPurchase();
    }
  }, [purchaseId, business?.id]);

  useEffect(() => {
    // Check if payment modal should be shown
    const action = searchParams?.get('action');
    if (action === 'payment' && purchase) {
      setShowPaymentModal(true);
      // Remove the query param from URL
      router.replace(`/purchases/${purchaseId}`, { scroll: false });
    }
  }, [searchParams, purchase, purchaseId, router]);

  async function fetchPurchase() {
    if (!business?.id) return;
    
    try {
      const res = await fetch(`/api/purchases/${purchaseId}`);
      if (res.ok) {
        const data = await res.json();
        setPurchase(data.purchase); // Fix: API returns { purchase: {...} }
      } else {
        router.push('/purchases');
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
      router.push('/purchases');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!purchase) {
    return (
      
        <div className="text-center py-12">
          <p className="text-gray-500">Purchase bill not found</p>
          <Button variant="ghost" onClick={() => router.push('/purchases')} className="mt-4">
            Back to Purchases
          </Button>
        </div>
      
    );
  }

  return (
    
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push('/purchases')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Purchase Bill {purchase.bill_number}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                <span>{purchase.supplier_name || 'Cash Purchase'}</span>
                <span>•</span>
                <span>{purchase.bill_date ? new Date(purchase.bill_date).toLocaleDateString() : 'No Date'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => router.push(`/purchases/${purchaseId}/edit`)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button variant="secondary" onClick={() => window.open(`/api/purchases/${purchaseId}/pdf?user_id=${user?.id}`, '_blank')}>
              <Download className="w-4 h-4 mr-2" />
              PDF
            </Button>
            {canPrintLabelsFromPurchase && (
              <Button
                variant="secondary"
                onClick={() => setShowLabelsModal(true)}
                disabled={purchase.status !== 'final'}
                title={
                  purchase.status !== 'final'
                    ? 'Finalize the purchase before printing labels'
                    : 'Print barcode labels for received items'
                }
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Labels
              </Button>
            )}
          </div>
        </div>

        {showLabelsModal && business?.id && (
          <PrintLabelsModal
            open={showLabelsModal}
            onClose={() => setShowLabelsModal(false)}
            purchaseId={purchaseId}
            businessId={business.id}
          />
        )}

        {/* Purchase Details */}
        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-sm text-gray-600">Bill Total</p>
              <p className="text-lg font-semibold">₹{Number(purchase.grand_total || 0).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Paid Amount</p>
              <p className="text-lg font-semibold text-green-600">₹{Number(purchase.paid_amount || 0).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Balance</p>
              <p className="text-lg font-semibold text-red-600">₹{Number(purchase.balance_amount || purchase.grand_total || 0).toLocaleString('en-IN')}</p>
            </div>
          </div>
        </Card>

        {/* Purchase Items */}
        {purchase.items && purchase.items.length > 0 && (
          <Card padding="md">
            <h3 className="font-semibold text-gray-900 mb-4">Items</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Item</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Quantity</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Unit Price</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Tax Rate</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.items.map((item: any, index: number) => (
                    <tr key={item.id || index} className="border-b">
                      <td className="py-2 px-3">
                        <div>
                          <p className="font-medium text-gray-900">{item.item_name || 'N/A'}</p>
                          {item.hsn_sac && (
                            <p className="text-xs text-gray-500">HSN: {item.hsn_sac}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right text-gray-700">{Number(item.quantity || 0).toLocaleString('en-IN')}</td>
                      <td className="py-2 px-3 text-right text-gray-700">₹{Number(item.unit_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{Number(item.tax_rate || 0).toFixed(2)}%</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-900">₹{Number(item.line_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={4} className="py-2 px-3 text-right font-medium text-gray-700">Subtotal:</td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900">₹{Number(purchase.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                  {Number(purchase.tax_total || 0) > 0 && (
                    <tr>
                      <td colSpan={4} className="py-2 px-3 text-right font-medium text-gray-700">Tax:</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-900">₹{Number(purchase.tax_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="py-2 px-3 text-right font-semibold text-gray-900">Grand Total:</td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-900">₹{Number(purchase.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {/* Documents */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Documents</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDocumentUploader(!showDocumentUploader)}
            >
              {showDocumentUploader ? 'Hide Uploader' : 'Add Document'}
            </Button>
          </div>
          {showDocumentUploader && purchase && business && (
            <div className="mb-4">
              <DocumentUploader
                entityType="purchase"
                entityId={purchase.id}
                businessId={business.id}
                onUploadSuccess={() => {
                  setShowDocumentUploader(false);
                }}
              />
            </div>
          )}
          {purchase && business && (
            <DocumentList
              entityType="purchase"
              entityId={purchase.id}
              businessId={business.id}
            />
          )}
        </Card>

        {/* Payment Modal */}
        {showPaymentModal && purchase && (
          <PurchasePaymentModal
            purchaseId={purchase.id}
            billNumber={purchase.bill_number || purchase.id.substring(0, 8)}
            grandTotal={Number(purchase.grand_total || 0)}
            paidAmount={Number(purchase.paid_amount || 0)}
            balanceAmount={Number(purchase.balance_amount || purchase.grand_total || 0)}
            onSuccess={() => {
              fetchPurchase(); // Refresh purchase data
              setShowPaymentModal(false);
            }}
            onClose={() => setShowPaymentModal(false)}
          />
        )}
      </div>
  );
}

export default function PurchaseDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <PurchaseDetailContent />
    </Suspense>
  );
}

