'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { ListPageHeader } from '@/components/layout/ListPageHeader';

interface RequestRow {
  id: string;
  requester_business_id: string;
  responder_business_id: string;
  item_id: string;
  requested_qty: number;
  confirmed_qty?: number | null;
  status: string;
  need_by_date?: string | null;
  notes?: string | null;
  responder_name?: string | null;
  requester_name?: string | null;
  item_name?: string | null;
  item_code?: string | null;
  created_at?: string;
  purchase_order_number?: string | null;
  sales_order_number?: string | null;
  invoice_number?: string | null;
  invoice_id?: string | null;
  responder_item_id?: string | null;
  responder_item_name?: string | null;
  responder_item_code?: string | null;
}

interface SupplierOption {
  id: string;
  name: string;
  linked_business_id?: string | null;
}

interface ItemOption {
  id: string;
  name: string;
  code?: string | null;
}

const emptyLinkFields = { purchase_order_id: '', purchase_id: '', invoice_id: '' };

function PurchaseRequestsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [itemId, setItemId] = useState('');
  const [requestedQty, setRequestedQty] = useState('');
  const [notes, setNotes] = useState('');
  const [needByDate, setNeedByDate] = useState('');
  const [mapBusyId, setMapBusyId] = useState<string | null>(null);
  const [responderItemPick, setResponderItemPick] = useState<{ [reqId: string]: string }>({});
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkByReq, setLinkByReq] = useState<
    Record<string, { purchase_order_id: string; purchase_id: string; invoice_id: string }>
  >({});
  const [poPickerOptions, setPoPickerOptions] = useState<{ id: string; label: string }[]>([]);
  const [purchasePickerOptions, setPurchasePickerOptions] = useState<{ id: string; label: string }[]>([]);
  const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});
  const [activityEvents, setActivityEvents] = useState<Record<string, any[]>>({});
  const [activityLoadingId, setActivityLoadingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ requester?: any; responder?: any }>({});
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseInput, setResponseInput] = useState<{ [key: string]: { status: string; qty: string; notes: string } }>({});
  const toast = useToastContext();

  // Authorization guard: Check if user can read purchases (required to view purchase requests)
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: readAuthStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  // Authorization guard: Check if user can create purchases (required for actions like "Convert to Purchase", "Create Purchase Order")
  const { status: createAuthStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'create',
    skipCheck: !user?.id || !business?.id,
  });

  // Derive canCreate from createAuthStatus
  const canCreate = createAuthStatus === 'allowed';

  // Define fetch functions using useCallback (must be before useEffect hooks)
  const fetchRequests = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      // Fetch all requests (both as requester and responder)
      const res = await fetch(`/api/stock-requests?role=all`);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (error) {
      console.error('Error fetching requests', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  const fetchSummary = useCallback(async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/stock-requests/summary`);
      const data = await res.json();
      setSummary(data || {});
    } catch (error) {
      console.error('Error fetching summary', error);
  }
  }, [business?.id]);

  const fetchSuppliers = useCallback(async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/suppliers?business_id=${business.id}&limit=200&user_id=${user?.id}`);
      const data = await res.json();
      const opts = (data.suppliers || []).filter((s: any) => s.linked_business_id);
      setSuppliers(opts);
    } catch (error) {
      console.error('Error fetching suppliers', error);
    }
  }, [business?.id, user?.id]);

  const fetchItems = useCallback(async (search?: string) => {
    if (!business?.id) return;
    try {
      const params = new URLSearchParams();
      params.append('business_id', business.id);
      params.append('user_id', user?.id || ''); // Required for authorization
      params.append('limit', '50');
      if (search) params.append('search', search);
      const res = await fetch(`/api/items?${params.toString()}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (error) {
      console.error('Error fetching items', error);
    }
  }, [business?.id, user?.id]);

  const fetchDocumentPickers = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    try {
      const [poRes, puRes] = await Promise.all([
        fetch(`/api/purchase-orders?business_id=${business.id}`),
        fetch(`/api/purchases?business_id=${business.id}&user_id=${user.id}&limit=100`),
      ]);
      const poData = await poRes.json();
      const puData = await puRes.json();
      setPoPickerOptions(
        (poData.purchaseOrders || []).map((po: any) => ({
          id: po.id,
          label: `${po.order_number || String(po.id).slice(0, 8)} · ${String(po.order_date || '').slice(0, 10)}`,
        }))
      );
      setPurchasePickerOptions(
        (puData.purchases || []).map((p: any) => ({
          id: p.id,
          label: `${p.bill_number || String(p.id).slice(0, 8)} · ${String(p.bill_date || '').slice(0, 10)}`,
        }))
      );
    } catch (e) {
      console.error('Error loading document pickers', e);
    }
  }, [business?.id, user?.id]);

  const patchLinkFields = (reqId: string, patch: Partial<typeof emptyLinkFields>) => {
    setLinkByReq((prev) => ({
      ...prev,
      [reqId]: { ...(prev[reqId] || emptyLinkFields), ...patch },
    }));
  };

  const toggleActivity = async (reqId: string) => {
    if (expandedActivity[reqId]) {
      setExpandedActivity((p) => ({ ...p, [reqId]: false }));
      return;
    }
    setExpandedActivity((p) => ({ ...p, [reqId]: true }));
    setActivityLoadingId(reqId);
    try {
      const res = await fetch(`/api/stock-requests/${reqId}/events`);
      const data = await res.json();
      if (res.ok) {
        setActivityEvents((p) => ({ ...p, [reqId]: data.events || [] }));
      } else {
        toast.error(data.error || 'Could not load activity');
      }
    } catch {
      toast.error('Could not load activity');
    } finally {
      setActivityLoadingId(null);
    }
  };

  const eventTypeLabel = (t: string) => {
    const map: Record<string, string> = {
      created: 'Request created',
      responded: 'Supplier responded',
      mapping_updated: 'Catalog item mapped',
      document_linked: 'Document linked',
      spawn_upstream: 'Upstream request created',
    };
    return map[t] || t;
  };

  // ALL HOOKS MUST BE BEFORE EARLY RETURNS
  useEffect(() => {
    if (business?.id) {
      fetchRequests();
      fetchSuppliers();
      fetchItems();
      fetchSummary();
      fetchDocumentPickers();
    }
  }, [business?.id, fetchRequests, fetchSuppliers, fetchItems, fetchSummary, fetchDocumentPickers]);

  // Handle return from customer creation
  useEffect(() => {
    const customerId = searchParams?.get('customer_id');
    const action = searchParams?.get('action');
    const itemId = searchParams?.get('item_id');
    const qty = searchParams?.get('qty');
    const requestId = searchParams?.get('request_id');
    
    if (customerId && action && itemId && qty) {
      // Remove the params from URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('customer_id');
      newUrl.searchParams.delete('action');
      newUrl.searchParams.delete('item_id');
      newUrl.searchParams.delete('qty');
      newUrl.searchParams.delete('request_id');
      window.history.replaceState({}, '', newUrl.toString());
      
      // Navigate to the appropriate page
      if (action === 'create_sales_order') {
        const params = new URLSearchParams({
          customer_id: customerId,
          item_id: itemId,
          qty: qty,
          request_id: requestId || ''
        });
        router.push(`/sales-orders/new?${params.toString()}`);
      } else if (action === 'create_invoice') {
        const params = new URLSearchParams({
          customer_id: customerId,
          item_id: itemId,
          qty: qty,
          request_id: requestId || ''
        });
        router.push(`/invoices/new?${params.toString()}`);
      }
    }
  }, [searchParams, router]);

  // Show loading while checking authorization (tri-state: 'loading')
  if (readAuthStatus === 'loading' || createAuthStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Show access denied only if check completed and denied (tri-state: 'denied')
  if (readAuthStatus === 'denied') {
    return (
      <AccessDenied module="purchases" action="view" />
    );
  }

  // readAuthStatus === 'allowed' - render page content

  const handleCreate = async () => {
    if (!business?.id || !supplierId || !itemId || !requestedQty) return;
    setLoading(true);
    try {
      const body = {
        requests: [
          {
            requester_business_id: business.id,
            responder_business_id: supplierId,
            item_id: itemId,
            requested_qty: parseFloat(requestedQty),
            notes: notes || null,
            need_by_date: needByDate ? needByDate : null,
          }
        ]
      };
      const res = await fetch('/api/stock-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setRequestedQty('');
        setNotes('');
        setNeedByDate('');
        fetchRequests();
        fetchSummary();
        toast.success('Request sent to supplier.');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || data.details || 'Failed to send request');
      }
    } catch (error) {
      console.error('Error creating request', error);
      toast.error('Failed to send request');
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async (id: string) => {
    const response = responseInput[id];
    if (!response || !response.status) return;
    
    setRespondingId(id);
    try {
      const body: any = {
        status: response.status
      };
      
      if (response.status !== 'declined') {
        const qty = parseFloat(response.qty);
        if (isNaN(qty) || qty < 0) {
          toast.error('Please enter a valid confirmed quantity');
          setRespondingId(null);
          return;
        }
        body.confirmed_qty = qty;
      }
      
      if (response.notes) {
        body.notes = response.notes;
      }
      
      const res = await fetch(`/api/stock-requests/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (res.ok) {
        setResponseInput((prev) => ({ ...prev, [id]: { status: '', qty: '', notes: '' } }));
        fetchRequests();
        fetchSummary();
        toast.success('Response submitted successfully!');
      } else {
        const data = await res.json();
        const errorMsg = data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to respond');
        console.error('Response error:', data);
        toast.error(errorMsg);
      }
    } catch (error) {
      console.error('Error responding to request', error);
      toast.error('Failed to respond to request');
    } finally {
      setRespondingId(null);
    }
  };

  const saveResponderItemMap = async (reqId: string) => {
    const pick = responderItemPick[reqId];
    if (!pick) {
      toast.error('Select your catalog item first.');
      return;
    }
    setMapBusyId(reqId);
    try {
      const res = await fetch(`/api/stock-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responder_item_id: pick }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('Your catalog item is mapped for this request.');
        fetchRequests();
      } else {
        toast.error(data.error || data.details || 'Failed to save mapping');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to save mapping');
    } finally {
      setMapBusyId(null);
    }
  };

  const handleLink = async (id: string) => {
    const l = linkByReq[id] || emptyLinkFields;
    if (!l.invoice_id?.trim() && !l.purchase_id?.trim() && !l.purchase_order_id?.trim()) {
      toast.error('Choose a purchase order, purchase, and/or enter an invoice id.');
      return;
    }
    setLinkingId(id);
    try {
      const res = await fetch(`/api/stock-requests/${id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: l.invoice_id?.trim() || null,
          purchase_id: l.purchase_id?.trim() || null,
          purchase_order_id: l.purchase_order_id?.trim() || null,
        }),
      });
      if (res.ok) {
        patchLinkFields(id, emptyLinkFields);
        fetchRequests();
        fetchDocumentPickers();
        toast.success('Document linked successfully!');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to link document');
      }
    } catch (error) {
      console.error('Error linking documents', error);
      toast.error('Failed to link document');
    } finally {
      setLinkingId(null);
    }
  };

  return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        <ListPageHeader
          title="Purchase requests"
          description="Request quantities from suppliers and link documents."
          actions={
            <Button variant="secondary" onClick={() => router.push('/purchases')}>
              All purchases
            </Button>
          }
          showActionsOnMobile
        />

        <Card padding="md" className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">New Request</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            <div className="col-span-1">
              <label className="text-xs text-gray-500">Supplier (linked business)</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.linked_business_id || ''}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-xs text-gray-500">Item</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                onBlur={() => {
                  // Refresh items with simple search if empty
                  if (!items.length) fetchItems();
                }}
              >
                <option value="">Select item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.code ? ` (${item.code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-xs text-gray-500">Requested Qty</label>
              <Input
                type="number"
                min="0"
                value={requestedQty}
                onChange={(e) => setRequestedQty(e.target.value)}
                placeholder="e.g. 10"
              />
            </div>

            <div className="col-span-1">
              <label className="text-xs text-gray-500">Notes (optional)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Need by next week"
              />
            </div>
            <div className="col-span-1">
              <label className="text-xs text-gray-500">Need by (optional)</label>
              <Input
                type="date"
                value={needByDate}
                onChange={(e) => setNeedByDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={loading || !supplierId || !itemId || !requestedQty}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Request'}
            </Button>
          </div>
        </Card>

        <Card padding="md">
          <p className="text-xs font-semibold text-gray-600 mb-2">As buyer (requests you sent)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Pending Requests</p>
              <p className="text-xl font-semibold text-gray-900">{summary.requester?.pending || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Confirmed/Partial</p>
              <p className="text-xl font-semibold text-gray-900">{summary.requester?.confirmed || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Backorders</p>
              <p className="text-xl font-semibold text-gray-900">{summary.requester?.backorder || 0}</p>
            </div>
          </div>
          <p className="text-xs font-semibold text-gray-600 mb-2">As supplier (requests to fulfill)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg border bg-slate-100/50">
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.pending || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-slate-100/50">
              <p className="text-xs text-gray-500">Confirmed/Partial</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.confirmed || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-slate-100/50">
              <p className="text-xs text-gray-500">Backorders</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.backorder || 0}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">My Requests</h2>
            <Button variant="ghost" size="sm" onClick={fetchRequests}>
              Refresh
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-gray-500">No requests yet.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => {
                const isIncoming = req.responder_business_id === business?.id;
                const otherPartyName = isIncoming ? req.requester_name : req.responder_name;
                const otherPartyLabel = isIncoming ? 'From' : 'To';
                
                return (
                <div key={req.id} className={`border rounded-lg p-3 flex flex-col gap-2 ${isIncoming ? 'border-primary-200 bg-slate-50/30' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500">{otherPartyLabel}: {otherPartyName || (isIncoming ? 'Supplier' : 'Customer')}</span>
                      <span className="text-sm font-semibold text-gray-900">{req.item_name || req.item_code || 'Item'}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 capitalize">
                        {req.status}
                      </span>
                      {isIncoming && <span className="text-xs text-primary-600 font-medium">Incoming</span>}
                    </div>
                  </div>
                  <div className="text-sm text-gray-700">
                    Requested: {req.requested_qty} {req.confirmed_qty != null ? ` | Confirmed: ${req.confirmed_qty}` : ''}
                  </div>
                  {req.notes && <div className="text-xs text-gray-500">Notes: {req.notes}</div>}
                  {req.need_by_date && (
                    <div className="text-xs text-amber-700">Need by: {req.need_by_date}</div>
                  )}

                  <div className="border-t pt-2 mt-1">
                    <Button variant="ghost" size="sm" type="button" onClick={() => toggleActivity(req.id)}>
                      {expandedActivity[req.id] ? '▼' : '▶'} Activity log
                    </Button>
                    {expandedActivity[req.id] && (
                      <div className="mt-2 text-xs space-y-1 max-h-52 overflow-y-auto bg-gray-50 rounded p-2 border border-gray-100">
                        {activityLoadingId === req.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
                        ) : (activityEvents[req.id] || []).length === 0 ? (
                          <p className="text-gray-500">No events yet.</p>
                        ) : (
                          (activityEvents[req.id] || []).map((ev: any) => (
                            <div key={ev.id} className="border-b border-gray-100 pb-1 last:border-0">
                              <div>
                                <span className="font-medium text-gray-800">{eventTypeLabel(ev.event_type)}</span>
                                <span className="text-gray-500 ml-2">
                                  {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}
                                </span>
                              </div>
                              {ev.payload && Object.keys(ev.payload).length > 0 && (
                                <p className="text-[10px] text-gray-600 mt-0.5 break-all font-mono">
                                  {JSON.stringify(ev.payload)}
                                </p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {isIncoming && (
                    <div className="text-xs text-gray-600 border border-dashed rounded p-2 space-y-2 bg-white/60">
                      <p className="font-medium text-gray-800">Your catalog item (required before creating a purchase order)</p>
                      {req.responder_item_id ? (
                        <p className="text-green-700">
                          Mapped: {req.responder_item_name || req.responder_item_id}
                          {req.responder_item_code ? ` (${req.responder_item_code})` : ''}
                        </p>
                      ) : (
                        <p className="text-amber-800">Not mapped yet — map your SKU so stock and PO lines stay correct.</p>
                      )}
                      <div className="flex flex-wrap items-end gap-2">
                        <select
                          className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                          value={responderItemPick[req.id] ?? req.responder_item_id ?? ''}
                          onChange={(e) =>
                            setResponderItemPick((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                        >
                          <option value="">Select your item…</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {item.code ? ` (${item.code})` : ''}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => saveResponderItemMap(req.id)}
                          disabled={mapBusyId === req.id}
                        >
                          {mapBusyId === req.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Save mapping'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Show linked Purchase Order */}
                  {req.purchase_order_number && (
                    <div className="text-xs text-primary-600 font-medium mt-1">
                      📋 Purchase Order: {req.purchase_order_number}
                    </div>
                  )}
                  
                  {/* Show linked Sales Order */}
                  {req.sales_order_number && (
                    <div className="text-xs text-green-600 font-medium mt-1">
                      📦 Sales Order: {req.sales_order_number}
                    </div>
                  )}
                  
                  {/* Show linked Invoice */}
                  {req.invoice_number && (
                    <div className="text-xs text-purple-600 font-medium mt-1 flex items-center gap-2">
                      <span>🧾 Invoice: {req.invoice_number}</span>
                      {req.invoice_id && canCreate && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            if (!confirm('Convert this invoice to a purchase? Stock will be added.')) return;
                            try {
                              const res = await fetch(`/api/invoices/${req.invoice_id}/convert-to-purchase`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ business_id: business?.id, created_by: user?.id })
                              });
                              const data = await res.json();
                              if (res.ok) {
                                toast.success(`Invoice converted to purchase! Purchase created: ${data.purchase.bill_number || data.purchase.id}`);
                                fetchRequests(); // Refresh list
                              } else {
                                toast.error(data.error || 'Failed to convert invoice to purchase');
                              }
                            } catch (err) {
                              console.error('Error converting invoice:', err);
                              toast.error('Error converting invoice to purchase');
                            }
                          }}
                          className="text-xs"
                        >
                          Convert to Purchase
                        </Button>
                      )}
                    </div>
                  )}
                  
                  {/* Actions for confirmed outgoing requests with Purchase Order */}
                  {!isIncoming && req.status === 'confirmed' && req.purchase_order_number && !req.sales_order_number && !req.invoice_number && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Fulfill Purchase Order:</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Find customer by matching responder_name
                            try {
                              const customerRes = await fetch(`/api/customers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const customerData = await customerRes.json();
                              // Match by responder_name (Tandoor Studio)
                              const customer = customerData.customers?.find((c: any) => 
                                c.name === req.responder_name || 
                                c.name?.toLowerCase() === req.responder_name?.toLowerCase()
                              );
                              
                              if (!customer) {
                                // Navigate to new customer page with business details pre-filled
                                // Fetch business details to pre-fill phone, email, GSTIN, address
                                try {
                                  const businessRes = await fetch(`/api/businesses/${req.responder_business_id}`);
                                  if (businessRes.ok) {
                                    const businessData = await businessRes.json();
                                    const biz = businessData.business || businessData;
                                    const returnParams = new URLSearchParams({
                                      item_id: req.item_id,
                                      qty: (req.confirmed_qty || req.requested_qty).toString(),
                                      request_id: req.id,
                                      action: 'create_sales_order'
                                    });
                                    const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                    
                                    // Pre-fill business details including company name (business name)
                                    const params = new URLSearchParams({
                                      return_url: returnUrl
                                    });
                                    // Use business name for both customer name and company name
                                    if (biz.name) {
                                      params.set('name', biz.name);
                                      params.set('company_name', biz.name);
                                    }
                                    if (biz.phone) params.set('phone', biz.phone);
                                    if (biz.email) params.set('email', biz.email);
                                    if (biz.gstin) params.set('gstin', biz.gstin);
                                    if (biz.address || biz.address_line1) params.set('address', biz.address || biz.address_line1);
                                    if (biz.city) params.set('city', biz.city);
                                    if (biz.state) params.set('state', biz.state);
                                    if (biz.pincode) params.set('pincode', biz.pincode);
                                    
                                    router.push(`/customers/new?${params.toString()}`);
                                  } else {
                                    // Fallback if business fetch fails
                                    const returnParams = new URLSearchParams({
                                      item_id: req.item_id,
                                      qty: (req.confirmed_qty || req.requested_qty).toString(),
                                      request_id: req.id,
                                      action: 'create_sales_order'
                                    });
                                    const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                    router.push(`/customers/new?return_url=${returnUrl}`);
                                  }
                                } catch (error) {
                                  console.error('Error fetching business details:', error);
                                  // Fallback
                                  const returnParams = new URLSearchParams({
                                    item_id: req.item_id,
                                    qty: (req.confirmed_qty || req.requested_qty).toString(),
                                    request_id: req.id,
                                    action: 'create_sales_order'
                                  });
                                  const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                  router.push(`/customers/new?return_url=${returnUrl}`);
                                }
                                return;
                              }
                              
                              // Navigate to new sales order with pre-filled data
                              const params = new URLSearchParams({
                                customer_id: customer.id,
                                item_id: req.item_id,
                                item_name: req.item_name || '',
                                qty: (req.confirmed_qty || req.requested_qty).toString(),
                                request_id: req.id
                              });
                              router.push(`/sales-orders/new?${params.toString()}`);
                            } catch (error) {
                              console.error('Error finding customer:', error);
                              toast.error('Failed to find customer. Please try again.');
                            }
                          }}
                        >
                          Create Sales Order
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Find customer by matching responder_name
                            try {
                              const customerRes = await fetch(`/api/customers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const customerData = await customerRes.json();
                              // Match by responder_name (Tandoor Studio)
                              const customer = customerData.customers?.find((c: any) => 
                                c.name === req.responder_name || 
                                c.name?.toLowerCase() === req.responder_name?.toLowerCase()
                              );
                              
                              if (!customer) {
                                // Navigate to new customer page with business details pre-filled
                                // Fetch business details to pre-fill phone, email, GSTIN, address
                                try {
                                  const businessRes = await fetch(`/api/businesses/${req.responder_business_id}`);
                                  if (businessRes.ok) {
                                    const businessData = await businessRes.json();
                                    const biz = businessData.business || businessData;
                                    const returnParams = new URLSearchParams({
                                      item_id: req.item_id,
                                      qty: (req.confirmed_qty || req.requested_qty).toString(),
                                      request_id: req.id,
                                      action: 'create_invoice'
                                    });
                                    const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                    
                                    // Pre-fill business details including company name (business name)
                                    const params = new URLSearchParams({
                                      return_url: returnUrl
                                    });
                                    // Use business name for both customer name and company name
                                    if (biz.name) {
                                      params.set('name', biz.name);
                                      params.set('company_name', biz.name);
                                    }
                                    if (biz.phone) params.set('phone', biz.phone);
                                    if (biz.email) params.set('email', biz.email);
                                    if (biz.gstin) params.set('gstin', biz.gstin);
                                    if (biz.address || biz.address_line1) params.set('address', biz.address || biz.address_line1);
                                    if (biz.city) params.set('city', biz.city);
                                    if (biz.state) params.set('state', biz.state);
                                    if (biz.pincode) params.set('pincode', biz.pincode);
                                    
                                    router.push(`/customers/new?${params.toString()}`);
                                  } else {
                                    // Fallback if business fetch fails
                                    const returnParams = new URLSearchParams({
                                      item_id: req.item_id,
                                      qty: (req.confirmed_qty || req.requested_qty).toString(),
                                      request_id: req.id,
                                      action: 'create_invoice'
                                    });
                                    const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                    router.push(`/customers/new?return_url=${returnUrl}`);
                                  }
                                } catch (error) {
                                  console.error('Error fetching business details:', error);
                                  // Fallback
                                  const returnParams = new URLSearchParams({
                                    item_id: req.item_id,
                                    qty: (req.confirmed_qty || req.requested_qty).toString(),
                                    request_id: req.id,
                                    action: 'create_invoice'
                                  });
                                  const returnUrl = encodeURIComponent(`/purchases/requests?${returnParams.toString()}`);
                                  router.push(`/customers/new?return_url=${returnUrl}`);
                                }
                                return;
                              }
                              
                              // Navigate to new invoice with pre-filled data
                              const params = new URLSearchParams({
                                customer_id: customer.id,
                                item_id: req.item_id,
                                item_name: req.item_name || '',
                                qty: (req.confirmed_qty || req.requested_qty).toString(),
                                request_id: req.id
                              });
                              router.push(`/invoices/new?${params.toString()}`);
                            } catch (error) {
                              console.error('Error finding customer:', error);
                              toast.error('Failed to find customer. Please try again.');
                            }
                          }}
                        >
                          Create Invoice
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Request from upstream supplier if short on stock
                            try {
                              // Check current stock
                              const itemRes = await fetch(`/api/items/${req.item_id}`);
                              const itemData = await itemRes.json();
                              const currentStock = itemData.item?.current_stock || 0;
                              const requiredQty = req.confirmed_qty || req.requested_qty;
                              
                              if (currentStock >= requiredQty) {
                                toast.info(`You have sufficient stock (${currentStock}). No need to request from supplier.`);
                                return;
                              }
                              
                              const shortage = requiredQty - currentStock;
                              // Navigate to supplier dashboard where they can request from their supplier
                              router.push('/suppliers/dashboard');
                            } catch (error) {
                              console.error('Error checking stock:', error);
                              toast.error('Failed to check stock. Please try again.');
                            }
                          }}
                        >
                          Request from Supplier (if short)
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Response section for incoming requests */}
                  {isIncoming && req.status === 'pending' && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Respond to Request:</p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <select
                          className="border rounded px-2 py-1.5 text-sm"
                          value={responseInput[req.id]?.status || ''}
                          onChange={(e) => setResponseInput((prev) => ({
                            ...prev,
                            [req.id]: { ...prev[req.id], status: e.target.value, qty: e.target.value === 'declined' ? '' : (prev[req.id]?.qty || req.requested_qty.toString()) }
                          }))}
                        >
                          <option value="">Select response</option>
                          <option value="confirmed">Confirm Full</option>
                          <option value="partial">Confirm Partial</option>
                          <option value="backorder">Backorder</option>
                          <option value="declined">Decline</option>
                        </select>
                        {responseInput[req.id]?.status && responseInput[req.id].status !== 'declined' && (
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Confirmed qty"
                            value={responseInput[req.id]?.qty || ''}
                            onChange={(e) => setResponseInput((prev) => ({
                              ...prev,
                              [req.id]: { ...prev[req.id], qty: e.target.value }
                            }))}
                          />
                        )}
                        <Input
                          placeholder="Notes (optional)"
                          value={responseInput[req.id]?.notes || ''}
                          onChange={(e) => setResponseInput((prev) => ({
                            ...prev,
                            [req.id]: { ...prev[req.id], notes: e.target.value }
                          }))}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleRespond(req.id)}
                          disabled={respondingId === req.id || !responseInput[req.id]?.status}
                        >
                          {respondingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Respond'}
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Actions for confirmed requests */}
                  {req.status !== 'pending' && isIncoming && canCreate && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Create Purchase Document:</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Find supplier_id from requester_business_id
                            try {
                              const supplierRes = await fetch(`/api/suppliers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const supplierData = await supplierRes.json();
                              const supplier = supplierData.suppliers?.find((s: any) => s.linked_business_id === req.requester_business_id);
                              
                              if (!supplier) {
                                toast.error('Supplier not found. Please ensure the supplier is linked to your business account.');
                                return;
                              }

                              if (!req.responder_item_id) {
                                toast.error('Map your catalog item on this request before creating a purchase order.');
                                return;
                              }
                              
                              // Navigate to new purchase order with pre-filled data
                              const params = new URLSearchParams({
                                supplier_id: supplier.id,
                                item_id: req.responder_item_id,
                                qty: (req.confirmed_qty || req.requested_qty).toString(),
                                request_id: req.id
                              });
                              router.push(`/purchase-orders/new?${params.toString()}`);
                            } catch (error) {
                              console.error('Error finding supplier:', error);
                              toast.error('Failed to find supplier. Please try again.');
                            }
                          }}
                        >
                          Create Purchase Order
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Find supplier_id from requester_business_id
                            try {
                              const supplierRes = await fetch(`/api/suppliers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const supplierData = await supplierRes.json();
                              const supplier = supplierData.suppliers?.find((s: any) => s.linked_business_id === req.requester_business_id);
                              
                              if (!supplier) {
                                toast.error('Supplier not found. Please ensure the supplier is linked to your business account.');
                                return;
                              }

                              if (!req.responder_item_id) {
                                toast.error('Map your catalog item on this request before creating a purchase.');
                                return;
                              }
                              
                              // Navigate to new purchase with pre-filled data
                              const params = new URLSearchParams({
                                supplier_id: supplier.id,
                                item_id: req.responder_item_id,
                                qty: (req.confirmed_qty || req.requested_qty).toString(),
                                request_id: req.id
                              });
                              router.push(`/purchases/new?${params.toString()}`);
                            } catch (error) {
                              console.error('Error finding supplier:', error);
                              toast.error('Failed to find supplier. Please try again.');
                            }
                          }}
                        >
                          Create Purchase
                        </Button>
                      </div>
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs font-semibold text-gray-700 mb-2">Or link existing document</p>
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <select
                              className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                              value={(linkByReq[req.id] || emptyLinkFields).purchase_order_id}
                              onChange={(e) => patchLinkFields(req.id, { purchase_order_id: e.target.value })}
                            >
                              <option value="">Purchase order…</option>
                              {poPickerOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <select
                              className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                              value={(linkByReq[req.id] || emptyLinkFields).purchase_id}
                              onChange={(e) => patchLinkFields(req.id, { purchase_id: e.target.value })}
                            >
                              <option value="">Purchase (GRN)…</option>
                              {purchasePickerOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() => handleLink(req.id)}
                              disabled={linkingId === req.id}
                            >
                              {linkingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Link'}
                            </Button>
                          </div>
                          <Input
                            placeholder="Invoice ID (optional)"
                            className="text-sm max-w-md"
                            value={(linkByReq[req.id] || emptyLinkFields).invoice_id}
                            onChange={(e) => patchLinkFields(req.id, { invoice_id: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Link documents for outgoing requests */}
                  {req.status !== 'pending' && !isIncoming && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Link documents</p>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2 items-center">
                          <select
                            className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                            value={(linkByReq[req.id] || emptyLinkFields).purchase_order_id}
                            onChange={(e) => patchLinkFields(req.id, { purchase_order_id: e.target.value })}
                          >
                            <option value="">Purchase order…</option>
                            {poPickerOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <select
                            className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                            value={(linkByReq[req.id] || emptyLinkFields).purchase_id}
                            onChange={(e) => patchLinkFields(req.id, { purchase_id: e.target.value })}
                          >
                            <option value="">Purchase (GRN)…</option>
                            {purchasePickerOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            onClick={() => handleLink(req.id)}
                            disabled={linkingId === req.id}
                          >
                            {linkingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Link docs'}
                          </Button>
                        </div>
                        <Input
                          placeholder="Invoice ID (optional)"
                          className="text-sm max-w-md"
                          value={(linkByReq[req.id] || emptyLinkFields).invoice_id}
                          onChange={(e) => patchLinkFields(req.id, { invoice_id: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}
        </Card>
      </div>
  );
}

export default function PurchaseRequestsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <PurchaseRequestsContent />
    </Suspense>
  );
}
