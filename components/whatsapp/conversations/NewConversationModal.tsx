'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2, MessageSquare, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TemplatePickerModal, type TemplateSendInput } from './TemplatePickerModal';
import { fileToDataUrl } from './fileToDataUrl';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (phoneNumber: string, conversationId?: string | null) => void;
  businessId: string;
  initialPhoneNumber?: string;
}

type Mode = 'template' | 'text';

export function NewConversationModal({
  isOpen,
  onClose,
  onSuccess,
  businessId,
  initialPhoneNumber
}: NewConversationModalProps) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber || '');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<'cloud' | 'baileys' | null>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (initialPhoneNumber) {
      setPhoneNumber(initialPhoneNumber);
    }
  }, [initialPhoneNumber]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    fetch('/api/whatsapp/inbox-templates', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const t = data.transport === 'cloud' ? 'cloud' : 'baileys';
        setTransport(t);
        setMode(t === 'cloud' ? 'template' : 'text');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const normalizePhoneNumber = (phone: string): string => {
    let normalized = phone.replace(/[^\d+]/g, '');
    if (!normalized.startsWith('+')) {
      normalized = '+' + normalized;
    }
    return normalized;
  };

  const validPhone = () => {
    if (phoneNumber.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid phone number with country code');
      return false;
    }
    return true;
  };

  const finish = (phone: string, conversationId?: string | null) => {
    onSuccess(phone, conversationId);
    setPhoneNumber('');
    setMessage('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validPhone()) return;

    if (mode === 'template') {
      setShowTemplates(true);
      return;
    }

    if (!message.trim()) {
      setError('Message is required');
      return;
    }

    setLoading(true);
    try {
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: normalizedPhone,
          message: message.trim(),
          message_type: 'text',
          claim_conversation: true
        })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        finish(normalizedPhone, data.conversation_id);
      } else if (data.code === 'WINDOW_CLOSED') {
        setMode('template');
        setError('This customer has not messaged you in the last 24 hours. Send an approved template to start the chat.');
      } else {
        setError(data.error || 'Failed to send message. Please check if WhatsApp is connected.');
      }
    } catch (err: any) {
      console.error('Error starting new conversation:', err);
      setError(err.message || 'Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendTemplate = async (input: TemplateSendInput) => {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const res = await fetch('/api/whatsapp/inbox-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        to: normalizedPhone,
        template_id: input.templateId,
        values: input.values,
        header_media: input.headerFile ? await fileToDataUrl(input.headerFile) : undefined,
        file_name: input.headerFile?.name,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Template was not sent');
    finish(normalizedPhone, data.conversation_id);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-bold text-gray-900">New Conversation</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <Input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+919876543210 (with country code)"
              disabled={loading}
              className="w-full"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter phone number with country code (e.g., +919876543210)
            </p>
          </div>

          {transport === 'cloud' && (
            <div className="flex rounded-lg bg-gray-100 p-1 text-sm" role="tablist">
              {(['template', 'text'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                    mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {m === 'template' ? 'Template' : 'Text message'}
                </button>
              ))}
            </div>
          )}

          {mode === 'template' ? (
            <p className="text-sm text-gray-600">
              WhatsApp only allows free text within 24 hours of the customer&apos;s last message. To start a chat,
              send an approved template.
            </p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                disabled={loading}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
              {transport === 'cloud' && (
                <p className="text-xs text-gray-500 mt-1">
                  Works only if this customer messaged you in the last 24 hours.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !phoneNumber.trim() || (mode === 'text' && !message.trim())}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Sending...
                </>
              ) : mode === 'template' ? (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Choose template
                </>
              ) : (
                <>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      {showTemplates && (
        <div onClick={(e) => e.stopPropagation()}>
          <TemplatePickerModal
            title={`Start chat with ${normalizePhoneNumber(phoneNumber)}`}
            onSend={sendTemplate}
            onClose={() => setShowTemplates(false)}
          />
        </div>
      )}
    </div>
  );
}
