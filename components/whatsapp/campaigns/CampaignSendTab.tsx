'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Toast, ToastType } from '@/components/ui/Toast';
import { MessageBuilder, MessageContent } from './MessageBuilder';
import { RecipientInput, Recipient } from './RecipientInput';
import { AntiBanSettings, AntiBanSettings as AntiBanSettingsType } from './AntiBanSettings';
import { Send, Loader2, AlertCircle } from 'lucide-react';

const DEFAULT_MESSAGE: MessageContent = {
  type: 'text',
  text: '',
};

const DEFAULT_ANTI_BAN: AntiBanSettingsType = {
  delayBetweenMessages: 2,
  randomDelayJitter: 2,
  batchSize: 20,
  pauseBetweenBatches: 120,
  dailySendLimit: undefined,
};

export function CampaignSendTab() {
  const router = useRouter();
  const { business } = useAuth();
  const [campaignName, setCampaignName] = useState('');
  const [message, setMessage] = useState<MessageContent>(DEFAULT_MESSAGE);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [antiBanSettings, setAntiBanSettings] = useState<AntiBanSettingsType>(DEFAULT_ANTI_BAN);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<{ status: string } | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false); // false = start now, true = schedule
  const [scheduledDateTime, setScheduledDateTime] = useState('');

  useEffect(() => {
    if (business?.id) {
      fetchWhatsAppStatus();
    }
  }, [business?.id]);

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

  // Validation
  const hasQuickReplies = message.type === 'button' && message.quickReplies && message.quickReplies.some(r => r.trim());
  const hasCallToActions = message.type === 'button' && message.callToActions && 
    ((message.callToActions.phone?.phone?.trim() && message.callToActions.phone?.title?.trim()) ||
     (message.callToActions.url?.url?.trim() && message.callToActions.url?.title?.trim()));
  const hasActions = hasQuickReplies || hasCallToActions;
  
  const errors = {
    name: campaignName.trim() ? '' : 'Campaign name is required',
    text: message.text.trim() ? '' : 'Message text is required',
    image: message.type === 'image' && !message.mediaUrl ? 'Please select an image' : '',
    buttons: message.type === 'button' && !hasActions
      ? 'Please add at least one quick reply or call-to-action' : '',
    recipients: recipients.length === 0 ? 'Please add at least one recipient' : '',
  };

  const hasErrors = Object.values(errors).some(e => e);

  const handleCreateCampaign = useCallback(async () => {
    if (!business?.id) return;
    if (hasErrors) {
      setToast({ message: 'Please fix all errors before creating campaign', type: 'error' });
      return;
    }

    setCreating(true);
    try {
      // Prepare form data if image
      let body: any;
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };

      // Prepare buttons for backend
      const buttonsForBackend = message.type === 'button' ? (() => {
        const buttons: Array<{ type: 'quick_reply' | 'call' | 'url'; id: string; title: string; phone?: string; url?: string }> = [];
        
        // Quick Replies
        if (message.quickReplies) {
          message.quickReplies.forEach(title => {
            if (title.trim()) {
              buttons.push({
                type: 'quick_reply',
                id: title.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_') || 'button',
                title: title.trim(),
              });
            }
          });
        }
        
        // Call to Actions
        if (message.callToActions) {
          if (message.callToActions.phone?.phone && message.callToActions.phone?.title) {
            buttons.push({
              type: 'call',
              id: 'call_button',
              title: message.callToActions.phone.title,
              phone: message.callToActions.phone.phone,
            });
          }
          if (message.callToActions.url?.url && message.callToActions.url?.title) {
            buttons.push({
              type: 'url',
              id: 'url_button',
              title: message.callToActions.url.title,
              url: message.callToActions.url.url,
            });
          }
        }
        
        return buttons.length > 0 ? buttons : null;
      })() : null;

      // Prepare request body (always use JSON now, with media_url)
      body = {
        business_id: business.id,
        name: campaignName,
        message_type: message.type,
        message_text: message.text,
        media_url: message.mediaUrl || null,
        buttons: buttonsForBackend,
        footer: message.footer || null,
        recipients,
        delay_between_messages: antiBanSettings.delayBetweenMessages,
        random_delay_jitter: antiBanSettings.randomDelayJitter,
        batch_size: antiBanSettings.batchSize,
        pause_between_batches: antiBanSettings.pauseBetweenBatches,
        daily_send_limit: antiBanSettings.dailySendLimit || null,
        scheduled_at: scheduleMode && scheduledDateTime ? scheduledDateTime : null,
      };

      const res = await fetch('/api/whatsapp/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.error) {
        setToast({ message: `Failed to create campaign: ${data.error}`, type: 'error' });
      } else {
        setToast({ message: `Campaign created successfully! ${data.total_recipients} recipients added.`, type: 'success' });
        // Redirect to campaigns list after 1 second
        setTimeout(() => {
          router.push('/whatsapp/campaigns');
        }, 1000);
      }
    } catch (err: any) {
      setToast({ message: `Failed to create campaign: ${err.message}`, type: 'error' });
    } finally {
      setCreating(false);
    }
  }, [business?.id, campaignName, message, recipients, antiBanSettings, hasErrors, scheduleMode, scheduledDateTime, router]);

  return (
    <div className="space-y-6">
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
                You can create campaigns, but they cannot be started until WhatsApp is connected. Please connect your WhatsApp account via Settings.
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

      {/* Campaign Name */}
      <Card padding="lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Campaign Name <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g., New Product Launch Campaign"
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
        </div>
      </Card>

      {/* Message Builder */}
      <MessageBuilder
        value={message}
        onChange={setMessage}
        errors={errors}
      />


      {/* Recipient Input */}
      <RecipientInput
        recipients={recipients}
        onChange={setRecipients}
        errors={errors}
      />

      {/* Anti-Ban Settings */}
      <AntiBanSettings
        settings={antiBanSettings}
        onChange={setAntiBanSettings}
        recipientCount={recipients.length}
      />

      {/* Schedule/Start Toggle */}
      <Card padding="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Campaign Timing
            </label>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${!scheduleMode ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                Start Now
              </span>
              <button
                type="button"
                onClick={() => setScheduleMode(!scheduleMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  scheduleMode ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    scheduleMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-sm ${scheduleMode ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                Schedule
              </span>
            </div>
          </div>

          {scheduleMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scheduled Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledDateTime}
                onChange={(e) => setScheduledDateTime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="input w-full"
                required={scheduleMode}
              />
              <p className="text-xs text-gray-500 mt-1">
                Select when you want the campaign to start automatically
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Create Campaign Button */}
      <Card padding="lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-gray-900 font-medium mb-1">
              Ready to create campaign?
            </p>
            <p className="text-xs text-gray-600 mb-4">
              {scheduleMode 
                ? `The campaign will be created and scheduled to start automatically at the selected time.`
                : `The campaign will be created in <strong>draft</strong> status. You can review it in the Campaigns page and start sending when ready.`} 
              Messages will be sent according to your anti-ban settings.
            </p>
            <Button
              onClick={handleCreateCampaign}
              disabled={creating || hasErrors || (scheduleMode && !scheduledDateTime)}
              className="w-full sm:w-auto"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating Campaign...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  {scheduleMode ? 'Schedule Campaign' : 'Create Campaign'}
                </>
              )}
            </Button>
          </div>
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

