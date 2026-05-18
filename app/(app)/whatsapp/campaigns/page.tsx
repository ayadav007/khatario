'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { 
  Send, 
  Loader2, 
  Lock, 
  Search, 
  MoreVertical, 
  Play, 
  Pause, 
  RotateCcw,
  FileText,
  BarChart3,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';

interface Campaign {
  id: string;
  name: string;
  message_type: 'text' | 'image' | 'button';
  message_text: string;
  media_url?: string;
  media_type?: string;
  buttons?: any;
  footer?: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  started_at?: string;
  completed_at?: string;
  paused_at?: string;
  last_sent_at?: string;
  created_at: string;
  updated_at: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const { business } = useAuth();
  const { hasFeature, loading: subscriptionLoading, refreshAddons } = useSubscriptionCheck(business?.id);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [processingCampaignId, setProcessingCampaignId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<{ status: string } | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  const hasAccess = hasFeature('whatsapp_bot');

  useEffect(() => {
    if (!subscriptionLoading && !hasAccess) {
      setShowUpgradeModal(true);
    }
  }, [subscriptionLoading, hasAccess]);

  useEffect(() => {
    if (hasAccess && business?.id) {
      fetchCampaigns();
      fetchWhatsAppStatus();
    }
  }, [hasAccess, business?.id, page, search, statusFilter]);

  const fetchWhatsAppStatus = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
      const data = await res.json();
      setWhatsappStatus(data);
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err);
    }
  };

  // Auto-refresh running campaigns every 5 seconds
  useEffect(() => {
    if (!hasAccess || !business?.id) return;
    
    const hasRunningCampaigns = campaigns.some(c => c.status === 'running');
    if (!hasRunningCampaigns) return;

    const interval = setInterval(() => {
      fetchCampaigns(true); // Silent refresh
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, business?.id, campaigns.map(c => c.id + ':' + c.status).join(',')]); // Depend on campaign statuses to detect changes

  const fetchCampaigns = async (silent = false) => {
    if (!business?.id) return;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        status: statusFilter,
      });
      if (search) params.append('search', search);

      const res = await fetch(`/api/whatsapp/campaigns?${params}`);
      const data = await res.json();
      if (data.error) {
        if (!silent) setToast({ message: data.error, type: 'error' });
      } else {
        const list = data.campaigns || [];
        setCampaigns(list);
        setTotalCount(
          data.total ??
            data.count ??
            (list.length === PAGE_SIZE
              ? page * PAGE_SIZE + 1
              : (page - 1) * PAGE_SIZE + list.length)
        );
      }
    } catch (err: any) {
      if (!silent) setToast({ message: err.message || 'Failed to load campaigns', type: 'error' });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleDeleteCampaign = (campaignId: string) => {
    setOpenDropdownId(null);
    setConfirmDialog({
      title: 'Delete campaign',
      message:
        'Are you sure you want to delete this campaign? This action cannot be undone and will delete all related recipient data.',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          setProcessingCampaignId(campaignId);
          setOpenDropdownId(null);
          try {
            const res = await fetch(`/api/whatsapp/campaigns/${campaignId}?business_id=${business?.id}`, {
              method: 'DELETE',
            });
            const data = await res.json();
            if (data.error) {
              setToast({ message: data.error, type: 'error' });
            } else {
              setToast({ message: 'Campaign deleted successfully', type: 'success' });
              await fetchCampaigns();
            }
          } catch (err: any) {
            setToast({ message: err.message || 'Failed to delete campaign', type: 'error' });
          } finally {
            setProcessingCampaignId(null);
          }
        })();
      },
    });
  };

  const handleCampaignAction = async (campaignId: string, action: 'start' | 'pause' | 'resume') => {
    // Check WhatsApp connection before starting or resuming
    if (action === 'start' || action === 'resume') {
      const statusRes = await fetch(`/api/whatsapp/status?business_id=${business?.id}`);
      const statusData = await statusRes.json();
      if (statusData.status !== 'connected') {
        setToast({ 
          message: 'WhatsApp is not connected. Please connect your WhatsApp account via Settings before starting/resuming a campaign.', 
          type: 'error' 
        });
        await fetchWhatsAppStatus(); // Update state for UI
        return;
      }
    }

    setProcessingCampaignId(campaignId);
    setOpenDropdownId(null);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
        // Refresh WhatsApp status in case it changed
        if (action === 'start') {
          await fetchWhatsAppStatus();
        }
      } else {
        setToast({ 
          message: `Campaign ${action === 'start' ? 'started' : action === 'pause' ? 'paused' : 'resumed'} successfully`, 
          type: 'success' 
        });
        await fetchCampaigns();
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update campaign', type: 'error' });
    } finally {
      setProcessingCampaignId(null);
    }
  };

  const getStatusBadgeVariant = (status: Campaign['status']) => {
    switch (status) {
      case 'running':
        return 'success';
      case 'completed':
        return 'default';
      case 'paused':
        return 'warning';
      case 'failed':
        return 'error';
      case 'draft':
      default:
        return 'default';
    }
  };

  const getProgressPercentage = (campaign: Campaign) => {
    if (campaign.total_recipients === 0) return 0;
    const completed = campaign.sent_count + campaign.failed_count;
    return Math.round((completed / campaign.total_recipients) * 100);
  };

  if (subscriptionLoading) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      
    );
  }

  if (!hasAccess) {
    return (
      
        <div className="max-w-2xl mx-auto py-8">
          <Card className="p-8 text-center">
            <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              WhatsApp Campaigns is Locked
            </h2>
            <p className="text-gray-600 mb-6">
              Upgrade to unlock WhatsApp Campaigns, Bot Rules, and advanced automation features.
            </p>
            <Button onClick={() => setShowUpgradeModal(true)}>
              Unlock WhatsApp Bot Features
            </Button>
          </Card>

          {showUpgradeModal && (
            <WhatsAppAddonModal
              addonType="whatsapp_bot"
              onClose={() => setShowUpgradeModal(false)}
              onPurchaseSuccess={async () => {
                await refreshAddons?.();
                setTimeout(() => {
                  window.location.reload();
                }, 500);
              }}
            />
          )}
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">WhatsApp Campaigns</h1>
            <p className="text-gray-600 text-sm mt-1">
              Create, manage, and track your WhatsApp marketing campaigns
            </p>
          </div>
          <Button onClick={() => router.push('/whatsapp/send-message')}>
            <Send className="w-4 h-4 mr-2" />
            New Campaign
          </Button>
        </div>

        {/* WhatsApp Connection Status Warning */}
        {whatsappStatus && whatsappStatus.status !== 'connected' && (
          <Card padding="md" className="bg-yellow-50 border-yellow-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 mb-1">
                  WhatsApp is not connected
                </h3>
                <p className="text-sm text-yellow-800 mb-3">
                  You need to connect your WhatsApp account before you can start campaigns. Messages will not be sent until WhatsApp is connected.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => router.push('/settings?tab=whatsapp')}
                  className="border-yellow-300 text-yellow-900 hover:bg-yellow-100"
                >
                  Connect WhatsApp
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Filters */}
        <Card padding="md">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="input pl-10 w-full"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="input w-auto"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </Card>

        {/* Campaigns Table */}
        <Card padding="none">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">
                {totalCount === 0
                  ? 'No campaigns yet. Create your first campaign to get started.'
                  : 'No campaigns match your filters.'}
              </p>
              {totalCount === 0 && (
                <Button onClick={() => router.push('/whatsapp/send-message')}>
                  <Send className="w-4 h-4 mr-2" />
                  Create Campaign
                </Button>
              )}
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="table-header">
                    <th className="table-cell text-left">Campaign Name</th>
                    <th className="table-cell text-left">Type</th>
                    <th className="table-cell text-left">Status</th>
                    <th className="table-cell text-left">Progress</th>
                    <th className="table-cell text-right">Sent/Failed/Pending</th>
                    <th className="table-cell text-left">Created</th>
                    <th className="table-cell text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => {
                    const progress = getProgressPercentage(campaign);
                    return (
                      <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                        <td className="table-cell">
                          <div>
                            <div className="font-medium text-gray-900">{campaign.name}</div>
                            <div className="text-xs text-gray-500 truncate max-w-xs">
                              {campaign.message_text?.substring(0, 60)}
                              {campaign.message_text && campaign.message_text.length > 60 ? '...' : ''}
                            </div>
                          </div>
                        </td>
                        <td className="table-cell">
                          <Chip variant="default" className="text-xs capitalize">
                            {campaign.message_type}
                          </Chip>
                        </td>
                        <td className="table-cell">
                          <Chip variant={getStatusBadgeVariant(campaign.status)} className="text-xs capitalize">
                            {campaign.status}
                          </Chip>
                        </td>
                        <td className="table-cell">
                          <div className="w-32">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-600">{progress}%</span>
                              {campaign.status === 'running' && (
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="Live updates active"></div>
                              )}
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-primary-600 h-2 rounded-full transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="table-cell text-right">
                          <div className="text-sm">
                            <span className="text-green-600 font-medium">{campaign.sent_count}</span>
                            <span className="text-gray-400 mx-1">/</span>
                            <span className="text-red-600 font-medium">{campaign.failed_count}</span>
                            <span className="text-gray-400 mx-1">/</span>
                            <span className="text-gray-600">{campaign.pending_count}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Total: {campaign.total_recipients}
                          </div>
                        </td>
                        <td className="table-cell text-sm text-gray-600">
                          {format(new Date(campaign.created_at), 'dd MMM yyyy, HH:mm')}
                        </td>
                        <td className="table-cell text-center">
                          <div className="relative inline-block">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDropdownId(openDropdownId === campaign.id ? null : campaign.id);
                              }}
                              title="Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>

                            {openDropdownId === campaign.id && (
                              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                                <div className="py-1">
                                  <button
                                    onClick={() => {
                                      router.push(`/whatsapp/campaigns/${campaign.id}`);
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                  >
                                    <BarChart3 className="w-4 h-4" />
                                    View Report
                                  </button>
                                  {campaign.status === 'draft' && (
                                    <button
                                      onClick={() => handleCampaignAction(campaign.id, 'start')}
                                      disabled={processingCampaignId === campaign.id}
                                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                                    >
                                      {processingCampaignId === campaign.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Play className="w-4 h-4" />
                                      )}
                                      Start Campaign
                                    </button>
                                  )}
                                  {campaign.status === 'running' && (
                                    <button
                                      onClick={() => handleCampaignAction(campaign.id, 'pause')}
                                      disabled={processingCampaignId === campaign.id}
                                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                                    >
                                      {processingCampaignId === campaign.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Pause className="w-4 h-4" />
                                      )}
                                      Pause Campaign
                                    </button>
                                  )}
                                  {campaign.status === 'paused' && (
                                    <>
                                      <button
                                        onClick={() => handleCampaignAction(campaign.id, 'resume')}
                                        disabled={processingCampaignId === campaign.id}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                                      >
                                        {processingCampaignId === campaign.id ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <RotateCcw className="w-4 h-4" />
                                        )}
                                        Resume Campaign
                                      </button>
                                      <button
                                        onClick={() => handleCampaignAction(campaign.id, 'start')}
                                        disabled={processingCampaignId === campaign.id}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                                      >
                                        {processingCampaignId === campaign.id ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <Play className="w-4 h-4" />
                                        )}
                                        Restart Campaign
                                      </button>
                                    </>
                                  )}
                                  {/* Delete option - show for all statuses except running */}
                                  {campaign.status !== 'running' && (
                                    <>
                                      <div className="border-t border-gray-200 my-1" />
                                      <button
                                        onClick={() => handleDeleteCampaign(campaign.id)}
                                        disabled={processingCampaignId === campaign.id}
                                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
                                      >
                                        {processingCampaignId === campaign.id ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <Trash2 className="w-4 h-4" />
                                        )}
                                        Delete Campaign
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 px-4 pb-4 border-t">
                <p className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </Card>

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title || ''}
          message={confirmDialog?.message || ''}
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => confirmDialog?.onConfirm()}
          onCancel={() => setConfirmDialog(null)}
        />
      </div>
    
  );
}

