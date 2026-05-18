'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Toast, ToastType } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { 
  ArrowLeft,
  Loader2, 
  Lock, 
  Play, 
  Pause, 
  RotateCcw,
  Download,
  FileText,
  BarChart3,
  Phone,
  Mail,
  Calendar,
  TrendingUp,
  Users,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { WhatsAppPreview } from '@/components/whatsapp/campaigns/WhatsAppPreview';
import { CampaignProgress } from '@/components/whatsapp/campaigns/CampaignProgress';

interface Campaign {
  id: string;
  business_id: string;
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
  delay_between_messages: number;
  random_delay_jitter: number;
  batch_size: number;
  pause_between_batches: number;
  daily_send_limit?: number;
  started_at?: string;
  completed_at?: string;
  paused_at?: string;
  last_sent_at?: string;
  created_at: string;
  updated_at: string;
}

interface Recipient {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  error_message?: string;
  message_id?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  response_text?: string;
  response_id?: string;
  responded_at?: string;
  created_at: string;
}

interface ButtonAnalytics {
  buttonId: string;
  buttonTitle: string;
  clickCount: number;
  uniqueClicks: number;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { business } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscriptionCheck(business?.id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'recipients' | 'analytics'>('overview');

  const campaignId = params?.id as string;
  const hasAccess = hasFeature('whatsapp_bot');

  useEffect(() => {
    if (hasAccess && campaignId) {
      fetchCampaignData();
    }
  }, [hasAccess, campaignId]);

  const fetchCampaignData = async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${campaignId}`);
      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
      } else {
        setCampaign(data.campaign);
        setRecipients(data.recipients || []);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to load campaign', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCampaignAction = async (action: 'start' | 'pause' | 'resume') => {
    if (!campaignId) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
      } else {
        setToast({ 
          message: `Campaign ${action === 'start' ? 'started' : action === 'pause' ? 'paused' : 'resumed'} successfully`, 
          type: 'success' 
        });
        await fetchCampaignData();
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update campaign', type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const exportRecipientsCSV = () => {
    if (recipients.length === 0) return;
    
    const headers = ['Phone', 'Name', 'Status', 'Error Message', 'Sent At', 'Delivered At', 'Read At', 'Response Text', 'Response ID'];
    const rows = recipients.map(r => [
      r.phone,
      r.name || '',
      r.status,
      r.error_message || '',
      r.sent_at ? format(new Date(r.sent_at), 'yyyy-MM-dd HH:mm:ss') : '',
      r.delivered_at ? format(new Date(r.delivered_at), 'yyyy-MM-dd HH:mm:ss') : '',
      r.read_at ? format(new Date(r.read_at), 'yyyy-MM-dd HH:mm:ss') : '',
      r.response_text || '',
      r.response_id || '',
    ]);

    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `campaign-${campaignId}-recipients-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const calculateButtonAnalytics = (): ButtonAnalytics[] => {
    if (!campaign?.buttons || !Array.isArray(campaign.buttons)) return [];
    
    const analytics: Record<string, ButtonAnalytics> = {};
    
    campaign.buttons.forEach((btn: any) => {
      if (!btn.id) return;
      analytics[btn.id] = {
        buttonId: btn.id,
        buttonTitle: btn.title || btn.id,
        clickCount: 0,
        uniqueClicks: 0,
      };
    });

    const clickedButtons = new Set<string>();
    recipients.forEach(r => {
      if (r.response_id && analytics[r.response_id]) {
        analytics[r.response_id].clickCount++;
        clickedButtons.add(`${r.phone}-${r.response_id}`);
      }
    });

    Object.values(analytics).forEach(btn => {
      btn.uniqueClicks = Array.from(clickedButtons).filter(b => b.endsWith(`-${btn.buttonId}`)).length;
    });

    return Object.values(analytics);
  };

  const buttonAnalytics = calculateButtonAnalytics();
  const successRate = campaign && campaign.total_recipients > 0
    ? Math.round(((campaign.sent_count) / campaign.total_recipients) * 100) 
    : 0;

  if (subscriptionLoading || loading) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading campaign...</p>
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
              Upgrade to unlock WhatsApp Campaigns and advanced automation features.
            </p>
            <Button onClick={() => router.push('/settings')}>
              View Subscription
            </Button>
          </Card>
        </div>
      
    );
  }

  if (!campaign) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Campaign not found</p>
            <Button onClick={() => router.push('/whatsapp/campaigns')} className="mt-4">
              Back to Campaigns
            </Button>
          </div>
        </div>
      
    );
  }

  const previewMessage = {
    type: campaign.message_type,
    text: campaign.message_text,
    imagePreview: campaign.media_url,
    quickReplies: campaign.buttons?.filter((b: any) => b.type === 'quick_reply').map((b: any) => b.title) || [],
    callToActions: {
      phone: campaign.buttons?.find((b: any) => b.type === 'call') ? {
        title: campaign.buttons.find((b: any) => b.type === 'call').title,
        phone: campaign.buttons.find((b: any) => b.type === 'call').phone,
      } : undefined,
      url: campaign.buttons?.find((b: any) => b.type === 'url') ? {
        title: campaign.buttons.find((b: any) => b.type === 'url').title,
        url: campaign.buttons.find((b: any) => b.type === 'url').url,
      } : undefined,
    },
    footer: campaign.footer,
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push('/whatsapp/campaigns')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
              <p className="text-gray-600 text-sm mt-1">
                Created {format(new Date(campaign.created_at), 'dd MMM yyyy, HH:mm')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Chip variant={
              campaign.status === 'running' ? 'success' :
              campaign.status === 'completed' ? 'default' :
              campaign.status === 'paused' ? 'warning' :
              campaign.status === 'failed' ? 'error' : 'default'
            } className="capitalize">
              {campaign.status}
            </Chip>
            {campaign.status === 'draft' && (
              <Button onClick={() => handleCampaignAction('start')} disabled={processing}>
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start Campaign
              </Button>
            )}
            {campaign.status === 'running' && (
              <Button onClick={() => handleCampaignAction('pause')} disabled={processing}>
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                Pause
              </Button>
            )}
            {campaign.status === 'paused' && (
              <>
                <Button onClick={() => handleCampaignAction('resume')} disabled={processing}>
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Resume
                </Button>
                <Button onClick={() => handleCampaignAction('start')} disabled={processing}>
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Restart
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Recipients</p>
                <p className="text-2xl font-bold text-gray-900">{campaign.total_recipients}</p>
              </div>
              <Users className="w-8 h-8 text-primary-600" />
            </div>
          </Card>
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Sent</p>
                <p className="text-2xl font-bold text-green-600">{campaign.sent_count}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
          </Card>
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Failed</p>
                <p className="text-2xl font-bold text-red-600">{campaign.failed_count}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
          </Card>
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Success Rate</p>
                <p className="text-2xl font-bold text-gray-900">{successRate}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-primary-600" />
            </div>
          </Card>
        </div>

        {/* Campaign Progress (Real-time) */}
        <CampaignProgress 
          campaignId={campaignId} 
          autoRefresh={campaign.status === 'running'}
          refreshInterval={5000}
          onStatusChange={(newStatus) => {
            if (newStatus !== campaign.status) {
              fetchCampaignData();
            }
          }}
        />

        {/* Tabs */}
        <Card padding="none">
          <div className="border-b border-gray-200">
            <div className="flex">
              {[
                { id: 'overview', label: 'Overview', icon: FileText },
                { id: 'recipients', label: 'Recipients', icon: Users },
                { id: 'analytics', label: 'Analytics', icon: BarChart3 },
              ].map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === tab.id
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Message Preview */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Message Preview</h3>
                  <WhatsAppPreview message={previewMessage} />
                </div>

                {/* Campaign Settings */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Settings</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Message Type</p>
                      <p className="text-sm font-medium capitalize">{campaign.message_type}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Delay Between Messages</p>
                      <p className="text-sm font-medium">{campaign.delay_between_messages}s</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Random Jitter</p>
                      <p className="text-sm font-medium">±{campaign.random_delay_jitter}s</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Batch Size</p>
                      <p className="text-sm font-medium">{campaign.batch_size}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Pause Between Batches</p>
                      <p className="text-sm font-medium">{campaign.pause_between_batches / 60} mins</p>
                    </div>
                    {campaign.daily_send_limit && (
                      <div>
                        <p className="text-sm text-gray-600">Daily Send Limit</p>
                        <p className="text-sm font-medium">{campaign.daily_send_limit}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium">Created</p>
                        <p className="text-xs text-gray-600">
                          {format(new Date(campaign.created_at), 'dd MMM yyyy, HH:mm')}
                        </p>
                      </div>
                    </div>
                    {campaign.started_at && (
                      <div className="flex items-center gap-3">
                        <Play className="w-5 h-5 text-green-600" />
                        <div>
                          <p className="text-sm font-medium">Started</p>
                          <p className="text-xs text-gray-600">
                            {format(new Date(campaign.started_at), 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    )}
                    {campaign.paused_at && (
                      <div className="flex items-center gap-3">
                        <Pause className="w-5 h-5 text-yellow-600" />
                        <div>
                          <p className="text-sm font-medium">Paused</p>
                          <p className="text-xs text-gray-600">
                            {format(new Date(campaign.paused_at), 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    )}
                    {campaign.completed_at && (
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-primary-600" />
                        <div>
                          <p className="text-sm font-medium">Completed</p>
                          <p className="text-xs text-gray-600">
                            {format(new Date(campaign.completed_at), 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    )}
                    {campaign.last_sent_at && (
                      <div className="flex items-center gap-3">
                        <Clock className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium">Last Sent</p>
                          <p className="text-xs text-gray-600">
                            {format(new Date(campaign.last_sent_at), 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'recipients' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Recipients ({recipients.length})</h3>
                  <Button onClick={exportRecipientsCSV} size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr className="table-header">
                        <th className="table-cell text-left">Phone</th>
                        <th className="table-cell text-left">Name</th>
                        <th className="table-cell text-left">Status</th>
                        <th className="table-cell text-left">Error</th>
                        <th className="table-cell text-left">Sent At</th>
                        <th className="table-cell text-left">Response</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((recipient) => (
                        <tr key={recipient.id}>
                          <td className="table-cell font-mono text-sm">{recipient.phone}</td>
                          <td className="table-cell">{recipient.name || '-'}</td>
                          <td className="table-cell">
                            <Chip
                              variant={
                                recipient.status === 'sent' || recipient.status === 'delivered' || recipient.status === 'read'
                                  ? 'success'
                                  : recipient.status === 'failed'
                                  ? 'error'
                                  : 'default'
                              }
                              className="text-xs capitalize"
                            >
                              {recipient.status}
                            </Chip>
                          </td>
                          <td className="table-cell text-sm text-red-600">
                            {recipient.error_message || '-'}
                          </td>
                          <td className="table-cell text-sm text-gray-600">
                            {recipient.sent_at ? format(new Date(recipient.sent_at), 'dd MMM yyyy, HH:mm') : '-'}
                          </td>
                          <td className="table-cell text-sm">
                            {recipient.response_text ? (
                              <div>
                                <p className="font-medium">{recipient.response_id}</p>
                                <p className="text-gray-600 text-xs">{recipient.response_text}</p>
                              </div>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Button Analytics</h3>
                  {buttonAnalytics.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr className="table-header">
                            <th className="table-cell text-left">Button ID</th>
                            <th className="table-cell text-left">Title</th>
                            <th className="table-cell text-right">Total Clicks</th>
                            <th className="table-cell text-right">Unique Clicks</th>
                            <th className="table-cell text-right">CTR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buttonAnalytics.map((btn) => {
                            const ctr = campaign.total_recipients > 0
                              ? Math.round((btn.uniqueClicks / campaign.total_recipients) * 100 * 100) / 100
                              : 0;
                            return (
                              <tr key={btn.buttonId}>
                                <td className="table-cell font-mono text-sm">{btn.buttonId}</td>
                                <td className="table-cell">{btn.buttonTitle}</td>
                                <td className="table-cell text-right">{btn.clickCount}</td>
                                <td className="table-cell text-right">{btn.uniqueClicks}</td>
                                <td className="table-cell text-right font-medium">{ctr}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-gray-600">No buttons in this campaign</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    
  );
}

