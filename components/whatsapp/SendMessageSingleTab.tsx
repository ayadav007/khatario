'use client';

import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Toast, ToastType } from '@/components/ui/Toast';
import { Send, Image as ImageIcon, MousePointerClick, Type, Loader2, X, Upload, Plus, Phone, LinkIcon } from 'lucide-react';

type MessageType = 'text' | 'image' | 'button';

interface CallToAction {
  phone?: { title: string; phone: string };
  url?: { title: string; url: string };
}

export function SendMessageSingleTab() {
  const { business } = useAuth();
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messageText, setMessageText] = useState('Hello from Khatario!');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [callToActions, setCallToActions] = useState<CallToAction>({});
  const [footer, setFooter] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const phoneRegex = /^[1-9]\d{9,14}$/; // 10-15 digits, starting with 1-9

  const validatePhoneNumber = (phone: string): boolean => {
    const cleaned = phone.replace(/[\s\-+]/g, '');
    return phoneRegex.test(cleaned);
  };

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setToast({ message: 'Please select an image file', type: 'error' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setToast({ message: 'Image size should be less than 5MB', type: 'error' });
      return;
    }

    setImageFile(file);
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Quick Reply handlers
  const handleAddQuickReply = useCallback(() => {
    if (quickReplies.length < 3) {
      setQuickReplies([...quickReplies, '']);
    }
  }, [quickReplies]);

  const handleQuickReplyChange = useCallback((index: number, value: string) => {
    const newReplies = [...quickReplies];
    newReplies[index] = value.substring(0, 20); // Max 20 chars
    setQuickReplies(newReplies);
  }, [quickReplies]);

  const handleRemoveQuickReply = useCallback((index: number) => {
    setQuickReplies(quickReplies.filter((_, i) => i !== index));
  }, [quickReplies]);

  // Call to Action handlers
  const handleAddCallToAction = useCallback((type: 'phone' | 'url') => {
    if (type === 'phone') {
      setCallToActions({ ...callToActions, phone: { title: '', phone: '' } });
    } else {
      setCallToActions({ ...callToActions, url: { title: '', url: '' } });
    }
  }, [callToActions]);

  const handleCallToActionChange = useCallback((type: 'phone' | 'url', field: 'title' | 'phone' | 'url', value: string) => {
    if (type === 'phone' && callToActions.phone) {
      setCallToActions({
        ...callToActions,
        phone: {
          ...callToActions.phone,
          [field]: field === 'title' ? value.substring(0, 20) : value
        }
      });
    } else if (type === 'url' && callToActions.url) {
      setCallToActions({
        ...callToActions,
        url: {
          ...callToActions.url,
          [field]: field === 'title' ? value.substring(0, 20) : value
        }
      });
    }
  }, [callToActions]);

  const handleRemoveCallToAction = useCallback((type: 'phone' | 'url') => {
    const newActions = { ...callToActions };
    delete newActions[type];
    setCallToActions(newActions);
  }, [callToActions]);

  const handleSend = useCallback(async () => {
    if (!business?.id) return;

    if (!phoneNumber || !phoneNumber.trim()) {
      setToast({ message: 'Please enter a phone number', type: 'warning' });
      return;
    }

    if (!validatePhoneNumber(phoneNumber)) {
      setToast({ 
        message: 'Invalid phone number. Please enter a valid number with country code (10-15 digits)', 
        type: 'error' 
      });
      return;
    }

    if (messageType === 'text' && !messageText.trim()) {
      setToast({ message: 'Please enter a message', type: 'warning' });
      return;
    }

    if (messageType === 'image') {
      if (!imageFile) {
        setToast({ message: 'Please select an image', type: 'warning' });
        return;
      }
      if (!messageText.trim()) {
        setToast({ message: 'Please enter a caption for the image', type: 'warning' });
        return;
      }
    }

    if (messageType === 'button') {
      if (!messageText.trim()) {
        setToast({ message: 'Please enter the message text', type: 'warning' });
        return;
      }
      const validQuickReplies = quickReplies.filter(r => r.trim());
      const hasValidCallToActions = 
        (callToActions.phone?.title && callToActions.phone?.phone) ||
        (callToActions.url?.title && callToActions.url?.url);
      
      if (validQuickReplies.length === 0 && !hasValidCallToActions) {
        setToast({ message: 'Please add at least one Quick Reply or Call to Action button', type: 'warning' });
        return;
      }

      // Validate phone CTA
      if (callToActions.phone) {
        if (!callToActions.phone.title.trim() || !callToActions.phone.phone.trim()) {
          setToast({ message: 'Phone CTA requires both title and phone number', type: 'warning' });
          return;
        }
      }

      // Validate URL CTA
      if (callToActions.url) {
        if (!callToActions.url.title.trim() || !callToActions.url.url.trim()) {
          setToast({ message: 'URL CTA requires both title and URL', type: 'warning' });
          return;
        }
      }
    }

    setSending(true);
    try {
      const cleanedPhone = phoneNumber.replace(/[\s\-+]/g, '');

      let body: FormData | string;
      let headers: Record<string, string> = {};

      if (messageType === 'image' && imageFile) {
        body = new FormData();
        body.append('business_id', business.id);
        body.append('to', cleanedPhone);
        body.append('message', messageText);
        body.append('message_type', 'image');
        body.append('image', imageFile);
      } else {
        headers['Content-Type'] = 'application/json';
        
        // Build button payload matching bulk campaign format
        const buttonPayload = messageType === 'button' ? {
          quickReplies: quickReplies.filter(r => r.trim()),
          callToActions: {
            ...(callToActions.phone?.title && callToActions.phone?.phone && {
              phone: callToActions.phone
            }),
            ...(callToActions.url?.title && callToActions.url?.url && {
              url: callToActions.url
            })
          },
          footer: footer.trim() || undefined
        } : undefined;

        body = JSON.stringify({
          business_id: business.id,
          to: cleanedPhone,
          message: messageText,
          message_type: messageType,
          ...(buttonPayload && { buttons: buttonPayload })
        });
      }

      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers,
        body,
      });

      const data = await res.json();
      if (data.error) {
        setToast({ message: `Failed to send: ${data.error}`, type: 'error' });
      } else {
        setToast({ message: 'Message sent successfully!', type: 'success' });
        setPhoneNumber('');
        setMessageText('Hello from Khatario!');
        setImageFile(null);
        setImagePreview(null);
        setQuickReplies([]);
        setCallToActions({});
        setFooter('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (err: any) {
      setToast({ message: `Failed to send: ${err.message}`, type: 'error' });
    } finally {
      setSending(false);
    }
  }, [business?.id, phoneNumber, messageText, messageType, imageFile, quickReplies, callToActions, footer]);

  return (
    <div className="space-y-6">
      <Card padding="lg">
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Single Message</h3>
            
            {/* Message Type Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMessageType('text');
                    setImageFile(null);
                    setImagePreview(null);
                    setQuickReplies([]);
                    setCallToActions({});
                    setFooter('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    messageType === 'text'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Type className="w-5 h-5" />
                  <span className="font-medium">Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessageType('image');
                    setQuickReplies([]);
                    setCallToActions({});
                    setFooter('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    messageType === 'image'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <ImageIcon className="w-5 h-5" />
                  <span className="font-medium">Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessageType('button');
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    messageType === 'button'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <MousePointerClick className="w-5 h-5" />
                  <span className="font-medium">Buttons</span>
                </button>
              </div>
            </div>

            {/* Phone Number */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number (with country code)
              </label>
              <Input
                type="text"
                placeholder="919876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Example: 919876543210 (India), 14155552671 (US)
              </p>
            </div>

            {/* Text Message / Caption */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {messageType === 'image' ? 'Caption' : 'Message'}
              </label>
              <Textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={messageType === 'image' ? 'Enter caption for the image...' : 'Enter your message...'}
                className="min-h-[100px]"
              />
            </div>

            {/* Image Upload */}
            {messageType === 'image' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Image
                </label>
                {imagePreview ? (
                  <div className="relative">
                    <div className="border-2 border-gray-200 rounded-lg p-2 bg-gray-50">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="max-w-full h-auto max-h-64 rounded-md mx-auto"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="absolute top-3 right-3 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-slate-50 transition-colors"
                  >
                    <Upload className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600 mb-1">Click to upload image</p>
                    <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>
            )}

            {/* Interactive Actions */}
            {messageType === 'button' && (
              <div className="mb-4 space-y-4">
                <div>
                  <h4 className="text-base font-semibold text-gray-900 mb-2">Interactive Actions</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    In addition to your message, you can send actions with your message. Maximum 20 characters are allowed in CTA button title & Quick Replies.
                    You can add up to 3 Quick Reply buttons and 2 Call to Action buttons (1 Phone + 1 URL) in the same message.
                  </p>
                </div>

                {/* Quick Replies Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Quick Replies (up to 3)
                    </label>
                    {quickReplies.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {quickReplies.filter(r => r.trim()).length}/3
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {quickReplies.map((reply, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="flex-1">
                          <Input
                            type="text"
                            value={reply}
                            onChange={(e) => handleQuickReplyChange(index, e.target.value)}
                            placeholder={`Quick Reply ${index + 1}`}
                            className="text-sm"
                          />
                        </div>
                        <div className="text-xs text-gray-500 min-w-[3rem] text-right">
                          {reply.length}/20
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveQuickReply(index)}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {quickReplies.length < 3 && (
                      <button
                        type="button"
                        onClick={handleAddQuickReply}
                        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add Quick Reply
                      </button>
                    )}
                  </div>
                </div>

                {/* Call to Actions Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">
                      Call to Actions (1 Phone + 1 URL)
                    </label>
                    {(callToActions.phone || callToActions.url) && (
                      <span className="text-xs text-gray-500">
                        {(callToActions.phone ? 1 : 0) + (callToActions.url ? 1 : 0)}/2
                      </span>
                    )}
                  </div>

                  {/* Phone CTA */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        Phone Number
                      </span>
                      {callToActions.phone && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCallToAction('phone')}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {callToActions.phone ? (
                      <div className="space-y-2 pl-6">
                        <Input
                          type="text"
                          value={callToActions.phone.title}
                          onChange={(e) => handleCallToActionChange('phone', 'title', e.target.value)}
                          placeholder="Button Title (e.g., Call Us)"
                          className="text-sm"
                        />
                        <div className="text-xs text-gray-500 text-right">
                          {callToActions.phone.title.length}/20
                        </div>
                        <Input
                          type="tel"
                          value={callToActions.phone.phone}
                          onChange={(e) => handleCallToActionChange('phone', 'phone', e.target.value)}
                          placeholder="Phone Number (e.g., 919876543210)"
                          className="text-sm"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddCallToAction('phone')}
                        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 pl-6"
                      >
                        <Plus className="w-4 h-4" />
                        Add Phone Number
                      </button>
                    )}
                  </div>

                  {/* URL CTA */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 flex items-center gap-2">
                        <LinkIcon className="w-4 h-4" />
                        URL
                      </span>
                      {callToActions.url && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCallToAction('url')}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {callToActions.url ? (
                      <div className="space-y-2 pl-6">
                        <Input
                          type="text"
                          value={callToActions.url.title}
                          onChange={(e) => handleCallToActionChange('url', 'title', e.target.value)}
                          placeholder="Button Title (e.g., Visit Us)"
                          className="text-sm"
                        />
                        <div className="text-xs text-gray-500 text-right">
                          {callToActions.url.title.length}/20
                        </div>
                        <Input
                          type="url"
                          value={callToActions.url.url}
                          onChange={(e) => handleCallToActionChange('url', 'url', e.target.value)}
                          placeholder="URL (e.g., https://example.com)"
                          className="text-sm"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddCallToAction('url')}
                        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 pl-6"
                      >
                        <Plus className="w-4 h-4" />
                        Add URL
                      </button>
                    )}
                  </div>
                </div>

                {/* Footer (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Footer (optional)
                  </label>
                  <Input
                    type="text"
                    value={footer}
                    onChange={(e) => setFooter(e.target.value)}
                    placeholder="Optional footer text"
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Send Button */}
            <Button
              onClick={handleSend}
              disabled={sending}
              className="w-full flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Toast Notification */}
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


