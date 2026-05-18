'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  AlertTriangle, Package, Users, TrendingUp, Loader2,
  Phone, Mail, MapPin, ExternalLink, X
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

interface LowStockAlert {
  id: string;
  item_id?: string;
  customer_business_id?: string;
  item_name: string;
  item_code?: string;
  current_stock: number;
  threshold: number;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  customer_address?: string;
  customer_city?: string;
  customer_state?: string;
  customer_pincode?: string;
  first_alerted_at: string;
  alert_status: string;
}

interface CustomerGroup {
  customer_business_id?: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  customer_address?: string;
  customer_city?: string;
  customer_state?: string;
  customer_pincode?: string;
  items: {
    item_id?: string;
    item_name: string;
    item_code?: string;
    current_stock: number;
    threshold: number;
    first_alerted_at: string;
  }[];
  items_count: number;
  total_shortage: number;
}

interface DashboardStats {
  active_customers: number;
  low_stock_alerts: number;
  total_thresholds: number;
  pending_requests: number;
}

export default function SupplierDashboardPage() {
  const { business } = useAuth();
  const router = useRouter();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    active_customers: 0,
    low_stock_alerts: 0,
    total_thresholds: 0,
    pending_requests: 0
  });
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerGroup | null>(null);
  const [requestQuantities, setRequestQuantities] = useState<{ [itemId: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [business?.id]);

  const fetchDashboardData = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      // Fetch low stock alerts
      const alertsRes = await fetch(`/api/suppliers/dashboard?supplier_business_id=${business.id}`);
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data.low_stock_alerts || []);
        setStats(data.stats || stats);
        setGroups(data.customer_groups || []);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      const res = await fetch(`/api/suppliers/dashboard/dismiss-alert?alert_id=${alertId}`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error('Error dismissing alert:', error);
    }
  };

  const handleRequestQuantities = async (customer: CustomerGroup) => {
    // If customer_business_id is missing, try to look it up from supplier relationship
    let customerBusinessId = customer.customer_business_id;
    
    if (!customerBusinessId && business?.id && customer.customer_name) {
      try {
        // Look up from supplier relationship: find supplier where linked_business_id = our business_id
        // and business_id (customer's business) matches the customer name
        const lookupRes = await fetch(`/api/suppliers/lookup-customer?supplier_business_id=${business.id}&customer_name=${encodeURIComponent(customer.customer_name)}`);
        if (lookupRes.ok) {
          const data = await lookupRes.json();
          if (data.customer_business_id) {
            customerBusinessId = data.customer_business_id;
          }
        } else {
          // Fallback: try dashboard API
          const dashboardRes = await fetch(`/api/suppliers/dashboard?supplier_business_id=${business.id}`);
          if (dashboardRes.ok) {
            const dashboardData = await dashboardRes.json();
            const matchingGroup = dashboardData.customer_groups?.find((g: any) => 
              g.customer_name === customer.customer_name && g.customer_business_id
            );
            if (matchingGroup?.customer_business_id) {
              customerBusinessId = matchingGroup.customer_business_id;
            }
          }
        }
      } catch (error) {
        console.error('Error looking up customer business ID:', error);
      }
    }
    
    setSelectedCustomer({
      ...customer,
      customer_business_id: customerBusinessId || customer.customer_business_id
    });
    
    // Pre-fill quantities with shortage (threshold - current_stock)
    const quantities: { [itemId: string]: string } = {};
    customer.items.forEach(item => {
      const shortage = Math.max(0, item.threshold - item.current_stock);
      const itemId = item.item_id || `temp-${item.item_name}`;
      quantities[itemId] = shortage.toString();
    });
    setRequestQuantities(quantities);
    setShowRequestModal(true);
  };

  const handleSubmitRequests = async () => {
    if (!selectedCustomer) {
      toast.error('No customer selected. Please try again.');
      return;
    }
    
    if (!business?.id) {
      toast.error('Business information not available. Please refresh the page.');
      return;
    }
    
    // If customer_business_id is missing, try to look it up
    let finalCustomerBusinessId = selectedCustomer.customer_business_id;
    if (!finalCustomerBusinessId && business?.id && selectedCustomer.customer_name) {
      try {
        // First try the dedicated lookup endpoint
        const lookupRes = await fetch(`/api/suppliers/lookup-customer?supplier_business_id=${business.id}&customer_name=${encodeURIComponent(selectedCustomer.customer_name)}`);
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          if (lookupData.customer_business_id) {
            finalCustomerBusinessId = lookupData.customer_business_id;
          }
        }
        
        // Fallback: try dashboard API
        if (!finalCustomerBusinessId) {
          const dashboardRes = await fetch(`/api/suppliers/dashboard?supplier_business_id=${business.id}`);
          if (dashboardRes.ok) {
            const dashboardData = await dashboardRes.json();
            const matchingGroup = dashboardData.customer_groups?.find((g: any) => 
              g.customer_name === selectedCustomer.customer_name
            );
            if (matchingGroup?.customer_business_id) {
              finalCustomerBusinessId = matchingGroup.customer_business_id;
            }
          }
        }
      } catch (error) {
        console.error('Error in final lookup:', error);
      }
    }
    
    if (!finalCustomerBusinessId) {
      console.error('Customer business ID missing after lookup:', selectedCustomer);
      toast.error('Unable to find customer business information. Please ensure the supplier relationship is properly set up.');
      return;
    }

    setSubmitting(true);
    try {
      const requests = selectedCustomer.items
        .filter(item => {
          const itemId = item.item_id || `temp-${item.item_name}`;
          const qty = requestQuantities[itemId];
          // Check if item has item_id and quantity is valid
          if (!item.item_id || !qty) return false;
          const qtyStr = String(qty).trim();
          if (qtyStr === '' || isNaN(parseFloat(qtyStr))) return false;
          const qtyNum = parseFloat(qtyStr);
          return qtyNum > 0;
        })
        .map(item => {
          const itemId = item.item_id || `temp-${item.item_name}`;
          return {
            requester_business_id: business.id, // Supplier is requesting
            responder_business_id: finalCustomerBusinessId!, // Customer will respond
            item_id: item.item_id!,
            requested_qty: parseFloat(requestQuantities[itemId])
          };
        });

      if (requests.length === 0) {
        toast.warning('Please enter quantities for at least one item');
        setSubmitting(false);
        return;
      }

      console.log('Submitting requests:', requests);

      const res = await fetch('/api/stock-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests
        })
      });

      const responseData = await res.json();

      if (res.ok) {
        toast.success(`Successfully sent ${requests.length} quantity request(s) to ${selectedCustomer.customer_name}`);
        setShowRequestModal(false);
        setSelectedCustomer(null);
        setRequestQuantities({});
        fetchDashboardData();
      } else {
        console.error('API error:', responseData);
        toast.error(responseData.error || 'Failed to create requests');
      }
    } catch (error) {
      console.error('Error creating requests:', error);
      toast.error('Failed to create requests. Please check the console for details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Supplier Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">
              Monitor your customers' inventory and track low stock alerts
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => router.push('/suppliers/dashboard/thresholds')}
          >
            Manage Thresholds
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Active Customers</p>
                <p className="text-2xl font-bold text-gray-900">{stats.active_customers}</p>
              </div>
              <div className="bg-slate-100 p-3 rounded-lg">
                <Users className="w-6 h-6 text-primary-600" />
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Low Stock Alerts</p>
                <p className="text-2xl font-bold text-red-600">{stats.low_stock_alerts}</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Monitored Items</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total_thresholds}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <Package className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>

        </div>

        {/* Customer Summary */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Customers with Low Stock</h2>
            <Button variant="ghost" size="sm" onClick={() => router.push('/suppliers/requests')}>
              View Requests
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : groups.length === 0 ? (
            <Card padding="lg">
              <div className="text-center text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No customers with low stock</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <Card key={g.customer_business_id || g.customer_name} padding="md" className="border-l-4 border-l-primary-500">
                  <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                        <p className="text-sm font-semibold text-gray-900">{g.customer_name}</p>
                        <p className="text-xs text-gray-600">
                          Items in low stock: <span className="font-medium">{g.items_count}</span> •
                          Total shortage: <span className="font-medium">{g.total_shortage}</span>
                        </p>
                        <div className="mt-1 text-xs text-gray-600 flex gap-3 flex-wrap">
                          {g.customer_phone && <span>📞 {g.customer_phone}</span>}
                          {g.customer_email && <span>✉️ {g.customer_email}</span>}
                          {(g.customer_city || g.customer_state) && (
                            <span>
                              📍 {g.customer_city}{g.customer_state ? `, ${g.customer_state}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => handleRequestQuantities(g)}>
                          Request Quantities
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      {g.items.map((item) => (
                        <div key={`${item.item_id || item.item_name}`} className="border rounded-lg p-3 bg-gray-50">
                          <p className="text-sm font-semibold text-gray-900">{item.item_name}</p>
                          {item.item_code && <p className="text-xs text-gray-600">{item.item_code}</p>}
                          <p className="text-xs text-gray-600 mt-1">
                            Stock: <span className="font-semibold text-red-600">{item.current_stock}</span> / Threshold: <span className="font-semibold">{item.threshold}</span>
                          </p>
              </div>
                      ))}
              </div>
            </div>
          </Card>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock Alerts (Item list) */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Low Stock Alerts</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : alerts.length === 0 ? (
            <Card padding="lg">
              <div className="text-center text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No low stock alerts</p>
                <p className="text-sm mt-1">
                  {stats.active_customers === 0 
                    ? 'No customers have granted you access to view their low stock alerts yet.'
                    : 'All monitored items are above their thresholds'}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {alerts.map((alert) => (
                <Card key={alert.id} padding="md" className="border-l-4 border-l-red-500">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Item Info */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Item</p>
                        <p className="font-medium text-gray-900">{alert.item_name}</p>
                        {alert.item_code && <p className="text-xs text-gray-600">{alert.item_code}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-sm">Stock: <span className="font-semibold text-red-600">{alert.current_stock}</span></span>
                          <span className="text-xs text-gray-400">/</span>
                          <span className="text-sm">Threshold: <span className="font-semibold">{alert.threshold}</span></span>
                        </div>
                      </div>

                      {/* Customer Info */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Customer</p>
                        <p className="font-medium text-gray-900">{alert.customer_name}</p>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          {alert.customer_phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="w-3 h-3" />
                              <a href={`tel:${alert.customer_phone}`} className="hover:text-primary-600">
                                {alert.customer_phone}
                              </a>
                            </div>
                          )}
                          {alert.customer_email && (
                            <div className="flex items-center gap-2">
                              <Mail className="w-3 h-3" />
                              <a href={`mailto:${alert.customer_email}`} className="hover:text-primary-600">
                                {alert.customer_email}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Location */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Location</p>
                        <div className="flex items-start gap-2 text-sm text-gray-700">
                          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div>
                            {alert.customer_address && <p>{alert.customer_address}</p>}
                            <p>{alert.customer_city}, {alert.customer_state}</p>
                            {alert.customer_pincode && <p>{alert.customer_pincode}</p>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => alert.customer_phone && window.open(`https://wa.me/${alert.customer_phone.replace(/\D/g, '')}`, '_blank')}
                        disabled={!alert.customer_phone}
                      >
                        Contact
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDismissAlert(alert.id)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card padding="md" className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => router.push('/suppliers/dashboard/thresholds')}>
            <h3 className="font-semibold text-gray-900 mb-2">Manage Thresholds</h3>
            <p className="text-sm text-gray-600 mb-2">Set and update low stock thresholds for your customers</p>
            <p className="text-xs text-primary-600 font-medium">Manage Thresholds →</p>
          </Card>

          <Card padding="md" className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => router.push('/suppliers/dashboard/analytics')}>
            <h3 className="font-semibold text-gray-900 mb-2">Location Analytics</h3>
            <p className="text-sm text-gray-600 mb-2">View product performance by region and pincode</p>
            <p className="text-xs text-primary-600 font-medium">View Analytics →</p>
          </Card>
        </div>

        {/* Request Quantities Modal */}
        {showRequestModal && selectedCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Request Quantities</h2>
                  <p className="text-sm text-gray-600 mt-1">Request quantities from {selectedCustomer.customer_name}</p>
                </div>
                <button
                  onClick={() => {
                    setShowRequestModal(false);
                    setSelectedCustomer(null);
                    setRequestQuantities({});
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {selectedCustomer.items.map((item) => {
                  const shortage = Math.max(0, item.threshold - item.current_stock);
                  const itemId = item.item_id || `temp-${item.item_name}`;
                  
                  return (
                    <div key={itemId} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-gray-900">{item.item_name}</p>
                          {item.item_code && <p className="text-xs text-gray-600">{item.item_code}</p>}
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-gray-600">Stock: <span className="font-semibold text-red-600">{item.current_stock}</span></p>
                          <p className="text-gray-600">Threshold: <span className="font-semibold">{item.threshold}</span></p>
                          <p className="text-gray-500 text-xs mt-1">Shortage: {shortage}</p>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Requested Quantity</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={requestQuantities[itemId] || ''}
                          onChange={(e) => setRequestQuantities(prev => ({ ...prev, [itemId]: e.target.value }))}
                          placeholder={`Suggested: ${shortage}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowRequestModal(false);
                    setSelectedCustomer(null);
                    setRequestQuantities({});
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmitRequests}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    'Send Request'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    
  );
}

