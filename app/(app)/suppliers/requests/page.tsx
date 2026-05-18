'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

interface RequestRow {
  id: string;
  requester_business_id: string;
  responder_business_id: string;
  item_id: string;
  requested_qty: number;
  confirmed_qty?: number | null;
  status: string;
  notes?: string | null;
  need_by_date?: string | null;
  requester_name?: string | null;
  item_name?: string | null;
  item_code?: string | null;
  purchase_order_id?: string | null;
  sales_order_id?: string | null;
  invoice_id?: string | null;
  purchase_order_number?: string | null;
  sales_order_number?: string | null;
  invoice_number?: string | null;
  responder_item_id?: string | null;
  responder_item_name?: string | null;
  responder_item_code?: string | null;
}

export default function SupplierRequestsPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [confirmInput, setConfirmInput] = useState<{ [k: string]: string }>({});
  const [statusInput, setStatusInput] = useState<{ [k: string]: string }>({});
  const [spawnInput, setSpawnInput] = useState<{ [k: string]: { upstream: string; qty: string } }>({});
  const [linkInput, setLinkInput] = useState<{ [k: string]: { so: string; invoice: string } }>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ requester?: any; responder?: any }>({});
  const [items, setItems] = useState<{ id: string; name: string; code?: string | null }[]>([]);
  const [responderItemPick, setResponderItemPick] = useState<{ [k: string]: string }>({});
  const [mapBusyId, setMapBusyId] = useState<string | null>(null);
  const [upstreamSuppliers, setUpstreamSuppliers] = useState<{ linked_business_id: string; name: string }[]>([]);
  const [soPickerOptions, setSoPickerOptions] = useState<{ id: string; label: string }[]>([]);
  const [invPickerOptions, setInvPickerOptions] = useState<{ id: string; label: string }[]>([]);
  const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});
  const [activityEvents, setActivityEvents] = useState<Record<string, any[]>>({});
  const [activityLoadingId, setActivityLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchRequests();
      fetchSummary();
      fetchItems();
      fetchAuxData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id]);

  const fetchItems = async () => {
    if (!business?.id || !user?.id) return;
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
        limit: '200',
      });
      const res = await fetch(`/api/items?${params.toString()}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAuxData = async () => {
    if (!business?.id || !user?.id) return;
    try {
      const [supRes, soRes, invRes] = await Promise.all([
        fetch(`/api/suppliers?business_id=${business.id}&limit=200&user_id=${user.id}`),
        fetch(`/api/sales-orders?business_id=${business.id}&user_id=${user.id}`),
        fetch(`/api/invoices?business_id=${business.id}&user_id=${user.id}&limit=100`),
      ]);
      const supData = await supRes.json();
      setUpstreamSuppliers(
        (supData.suppliers || [])
          .filter((s: any) => s.linked_business_id)
          .map((s: any) => ({ linked_business_id: s.linked_business_id, name: s.name }))
      );
      const soData = await soRes.json();
      setSoPickerOptions(
        (soData.salesOrders || []).map((so: any) => ({
          id: so.id,
          label: `${so.order_number || String(so.id).slice(0, 8)} · ${String(so.order_date || '').slice(0, 10)}`,
        }))
      );
      const invData = await invRes.json();
      setInvPickerOptions(
        (invData.invoices || []).map((inv: any) => ({
          id: inv.id,
          label: `${inv.invoice_number || String(inv.id).slice(0, 8)} · ${String(inv.invoice_date || '').slice(0, 10)}`,
        }))
      );
    } catch (e) {
      console.error('fetchAuxData', e);
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

  const fetchRequests = async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stock-requests?role=responder`);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (error) {
      console.error('Error fetching responder requests', error);
    } finally {
      setLoading(false);
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
        toast.success('Catalog item mapped.');
        fetchRequests();
      } else {
        toast.error(data.error || 'Failed to save mapping');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to save mapping');
    } finally {
      setMapBusyId(null);
    }
  };

  const handleRespond = async (id: string) => {
    const row = requests.find((r) => r.id === id);
    if (!row || row.status !== 'pending') {
      toast.error('Only pending requests can be responded to.');
      return;
    }
    const status = (statusInput[id] || 'confirmed') as string;
    const reqQty = Number(row.requested_qty);
    let confirmedQty: number | null =
      status === 'declined' ? null : confirmInput[id] ? parseFloat(confirmInput[id]) : reqQty;
    if (status !== 'declined' && (confirmedQty == null || Number.isNaN(confirmedQty))) {
      confirmedQty = reqQty;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/stock-requests/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          confirmed_qty: confirmedQty,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests();
        fetchSummary();
        toast.success('Response recorded.');
      } else {
        toast.error(data.error || data.details || 'Failed to respond');
      }
    } catch (error) {
      console.error('Error responding to request', error);
      toast.error('Failed to respond');
    } finally {
      setBusyId(null);
    }
  };

  const handleSpawn = async (id: string) => {
    const upstream = spawnInput[id]?.upstream;
    const qty = spawnInput[id]?.qty;
    const row = requests.find((r) => r.id === id);
    if (!upstream || !qty) {
      toast.error('Select an upstream supplier and enter quantity.');
      return;
    }
    const catalogId = row?.responder_item_id || null;
    if (!catalogId) {
      toast.error('Map your catalog item on this request before requesting upstream.');
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/stock-requests/${id}/spawn-upstream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upstream_business_id: upstream,
          requested_qty: parseFloat(qty),
          item_id: catalogId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests();
        toast.success('Upstream request created.');
      } else {
        toast.error(data.error || data.details || 'Upstream request failed');
      }
    } catch (error) {
      console.error('Error spawning upstream request', error);
      toast.error('Upstream request failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleLink = async (id: string) => {
    const so = linkInput[id]?.so;
    const invoice = linkInput[id]?.invoice;
    if (!so && !invoice) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/stock-requests/${id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_order_id: so || null,
          invoice_id: invoice || null
        })
      });
      if (res.ok) {
        fetchRequests();
        fetchAuxData();
        setLinkInput((prev) => ({ ...prev, [id]: { so: '', invoice: '' } }));
        toast.success('Documents linked.');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Link failed');
      }
    } catch (error) {
      console.error('Error linking documents', error);
      toast.error('Link failed');
    } finally {
      setBusyId(null);
    }
  };

  const fetchSummary = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/stock-requests/summary`);
      const data = await res.json();
      setSummary(data || {});
    } catch (error) {
      console.error('Error fetching summary', error);
    }
  };

    return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Requests to Fulfill</h1>
            <p className="text-sm text-gray-600">Respond to customer quantity requests and forward shortages upstream.</p>
          </div>
          <Button variant="secondary" onClick={() => router.push('/suppliers')}>
            Back to Suppliers
          </Button>
            </div>

        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.pending || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Confirmed/Partial</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.confirmed || 0}</p>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <p className="text-xs text-gray-500">Backorders</p>
              <p className="text-xl font-semibold text-gray-900">{summary.responder?.backorder || 0}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Incoming Requests</h2>
            <Button variant="ghost" size="sm" onClick={fetchRequests}>
              Refresh
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-gray-500">No incoming requests.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div key={req.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-900">{req.requester_name || 'Customer'}</span>
                      <span className="text-xs text-gray-600">{req.item_name || req.item_code || 'Item'}</span>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 capitalize">
                      {req.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-700">
                    Requested: {req.requested_qty} {req.confirmed_qty != null ? ` | Confirmed: ${req.confirmed_qty}` : ''}
                  </div>
                  {req.notes && <div className="text-xs text-gray-500">Notes: {req.notes}</div>}
                  {req.need_by_date && (
                    <div className="text-xs text-amber-700">Need by: {req.need_by_date}</div>
                  )}

                  <div className="text-xs border border-dashed rounded p-2 space-y-2 bg-gray-50">
                    <p className="font-medium text-gray-800">Your catalog item (required for PO / upstream)</p>
                    {req.responder_item_id ? (
                      <p className="text-green-700">
                        Mapped: {req.responder_item_name || req.responder_item_id}
                        {req.responder_item_code ? ` (${req.responder_item_code})` : ''}
                      </p>
                    ) : (
                      <p className="text-amber-800">Map your SKU to keep inventory and purchase orders correct.</p>
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
                    <div className="text-xs text-purple-600 font-medium mt-1">
                      🧾 Invoice: {req.invoice_number}
                    </div>
                  )}

                  {req.status === 'pending' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="text-xs text-gray-500">Status</label>
                      <select
                        className="w-full border rounded px-2 py-2 text-sm"
                        value={statusInput[req.id] || 'confirmed'}
                        onChange={(e) => setStatusInput((prev) => ({ ...prev, [req.id]: e.target.value }))}
                      >
                        <option value="confirmed">Confirm full</option>
                        <option value="partial">Partial</option>
                        <option value="backorder">Backorder</option>
                        <option value="declined">Decline</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Confirmed Qty</label>
                      <Input
                        type="number"
                        min="0"
                        value={confirmInput[req.id] || ''}
                        onChange={(e) => setConfirmInput((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        placeholder={`Max ${req.requested_qty}`}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => handleRespond(req.id)}
                        disabled={busyId === req.id}
                      >
                        {busyId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Response'}
                      </Button>
                    </div>
                  </div>
                  )}

                  <div className="border-t pt-2 grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="text-xs text-gray-500">Request from supplier</label>
                      <select
                        className="w-full border rounded px-2 py-2 text-sm"
                        value={spawnInput[req.id]?.upstream || ''}
                        onChange={(e) =>
                          setSpawnInput((prev) => ({
                            ...prev,
                            [req.id]: { upstream: e.target.value, qty: prev[req.id]?.qty || '' },
                          }))
                        }
                      >
                        <option value="">Select linked supplier…</option>
                        {upstreamSuppliers.map((s) => (
                          <option key={s.linked_business_id} value={s.linked_business_id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Request Qty Upstream</label>
                      <Input
                        type="number"
                        min="0"
                        value={spawnInput[req.id]?.qty || ''}
                        onChange={(e) =>
                          setSpawnInput((prev) => ({
                            ...prev,
                            [req.id]: { upstream: prev[req.id]?.upstream || '', qty: e.target.value }
                          }))
                        }
                        placeholder="e.g. shortage qty"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSpawn(req.id)}
                        disabled={busyId === req.id}
                      >
                        {busyId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Request Upstream'}
                      </Button>
            </div>
          </div>

                  {/* Actions for confirmed requests with Purchase Order */}
                  {req.status === 'confirmed' && req.purchase_order_number && !req.sales_order_number && !req.invoice_number && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Create Sales Document:</p>
                      <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                          variant="secondary"
                          onClick={async () => {
                            // Find customer by matching name (since customers don't have linked_business_id)
                            try {
                              const customerRes = await fetch(`/api/customers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const customerData = await customerRes.json();
                              // Match by requester_name
                              const customer = customerData.customers?.find((c: any) => 
                                c.name === req.requester_name || 
                                c.name?.toLowerCase() === req.requester_name?.toLowerCase()
                              );
                              
                              if (!customer) {
                                toast.error(`Customer "${req.requester_name}" not found. Please create this customer first in your Customers list.`);
                                return;
                              }
                              
                              // Navigate to new sales order with pre-filled data
                              if (!req.responder_item_id) {
                                toast.error('Map your catalog item before creating a sales order.');
                                return;
                              }
                              const params = new URLSearchParams({
                                customer_id: customer.id,
                                item_id: req.responder_item_id,
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
                            // Find customer by matching name (since customers don't have linked_business_id)
                            try {
                              const customerRes = await fetch(`/api/customers?business_id=${business?.id}&limit=200&user_id=${user?.id}`);
                              const customerData = await customerRes.json();
                              // Match by requester_name
                              const customer = customerData.customers?.find((c: any) => 
                                c.name === req.requester_name || 
                                c.name?.toLowerCase() === req.requester_name?.toLowerCase()
                              );
                              
                              if (!customer) {
                                toast.error(`Customer "${req.requester_name}" not found. Please create this customer first in your Customers list.`);
                                return;
                              }
                              
                              // Navigate to new invoice with pre-filled data
                              if (!req.responder_item_id) {
                                toast.error('Map your catalog item before creating an invoice.');
                                return;
                              }
                              const params = new URLSearchParams({
                                customer_id: customer.id,
                                item_id: req.responder_item_id,
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
                      </div>
            </div>
          )}
                  
                  {/* Link existing documents */}
                  <div className="border-t pt-2 flex flex-col gap-2">
                    <p className="text-xs font-semibold text-gray-700">Link sales documents</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                        value={linkInput[req.id]?.so || ''}
                        onChange={(e) =>
                          setLinkInput((prev) => ({
                            ...prev,
                            [req.id]: { so: e.target.value, invoice: prev[req.id]?.invoice || '' },
                          }))
                        }
                      >
                        <option value="">Sales order…</option>
                        {soPickerOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                        value={linkInput[req.id]?.invoice || ''}
                        onChange={(e) =>
                          setLinkInput((prev) => ({
                            ...prev,
                            [req.id]: { so: prev[req.id]?.so || '', invoice: e.target.value },
                          }))
                        }
                      >
                        <option value="">Invoice…</option>
                        {invPickerOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleLink(req.id)}
                        disabled={busyId === req.id}
                      >
                        {busyId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Link'}
                      </Button>
                    </div>
                  </div>
          </div>
              ))}
          </div>
        )}
        </Card>
      </div>
    
  );
}

