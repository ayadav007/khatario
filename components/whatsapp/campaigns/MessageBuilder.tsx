'use client';

import { useState, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Type, Image as ImageIcon, MousePointerClick, X, Upload, Phone, Link as LinkIcon, Plus, Trash2, FolderOpen } from 'lucide-react';
import { WhatsAppPreview } from './WhatsAppPreview';
import { MediaLibraryModal } from './MediaLibraryModal';

export type MessageType = 'text' | 'image' | 'button';

export type ActionType = 'none' | 'quick_replies' | 'call_to_actions';

export interface MessageContent {
  type: MessageType;
  text: string;
  mediaUrl?: string; // Media library URL (base64 data URL)
  actionType?: ActionType; // 'none' | 'quick_replies' | 'call_to_actions'
  quickReplies?: string[]; // Array of button titles (max 3, 20 chars each)
  callToActions?: {
    phone?: { title: string; phone: string };
    url?: { title: string; url: string };
  };
  footer?: string;
}

interface MessageBuilderProps {
  value: MessageContent;
  onChange: (content: MessageContent) => void;
  errors?: {
    text?: string;
    image?: string;
    buttons?: string;
  };
}

// Helper to auto-generate button ID from title
function generateButtonId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'button';
}

export function MessageBuilder({ value, onChange, errors }: MessageBuilderProps) {
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const quickReplies = value.quickReplies || [];
  const callToActions = value.callToActions || {};

  const handleTypeChange = useCallback((type: MessageType) => {
    onChange({
      type,
      text: value.text,
      // Keep media URL when switching to button type (buttons can have images)
      mediaUrl: (type === 'image' || type === 'button') ? value.mediaUrl : undefined,
      // When button type is selected, initialize with empty arrays/objects (no actionType needed)
      quickReplies: type === 'button' ? (value.quickReplies || []) : undefined,
      callToActions: type === 'button' ? (value.callToActions || {}) : undefined,
      footer: value.footer,
    });
  }, [value, onChange]);

  const handleTextChange = useCallback((text: string) => {
    onChange({ ...value, text });
  }, [value, onChange]);

  const handleMediaSelect = useCallback((mediaUrl: string) => {
    onChange({
      ...value,
      mediaUrl,
    });
  }, [value, onChange]);

  const handleRemoveImage = useCallback(() => {
    onChange({
      ...value,
      mediaUrl: undefined,
    });
  }, [value, onChange]);

  // Removed handleActionTypeChange - no longer needed since we show both sections

  const handleQuickReplyChange = useCallback((index: number, title: string) => {
    const newQuickReplies = [...quickReplies];
    newQuickReplies[index] = title.slice(0, 20); // Max 20 chars
    onChange({ ...value, quickReplies: newQuickReplies });
  }, [value, onChange, quickReplies]);

  const handleAddQuickReply = useCallback(() => {
    if (quickReplies.length < 3) {
      onChange({ ...value, quickReplies: [...quickReplies, ''] });
    }
  }, [value, onChange, quickReplies]);

  const handleRemoveQuickReply = useCallback((index: number) => {
    const newQuickReplies = quickReplies.filter((_, i) => i !== index);
    onChange({ ...value, quickReplies: newQuickReplies });
  }, [value, onChange, quickReplies]);

  const handleCallToActionChange = useCallback((type: 'phone' | 'url', field: 'title' | 'phone' | 'url', newValue: string) => {
    const newCTAs = { ...callToActions };
    if (type === 'phone') {
      newCTAs.phone = {
        ...(newCTAs.phone || { title: '', phone: '' }),
        [field]: field === 'title' ? newValue.slice(0, 20) : newValue,
      };
    } else {
      newCTAs.url = {
        ...(newCTAs.url || { title: '', url: '' }),
        [field]: field === 'title' ? newValue.slice(0, 20) : newValue,
      };
    }
    onChange({ ...value, callToActions: newCTAs });
  }, [value, onChange, callToActions]);

  const handleRemoveCallToAction = useCallback((type: 'phone' | 'url') => {
    const newCTAs = { ...callToActions };
    if (type === 'phone') {
      delete newCTAs.phone;
    } else {
      delete newCTAs.url;
    }
    onChange({ ...value, callToActions: newCTAs });
  }, [value, onChange, callToActions]);

  const handleFooterChange = useCallback((footer: string) => {
    onChange({ ...value, footer });
  }, [value, onChange]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column: Message Builder */}
      <div className="space-y-6">
        <Card padding="lg" className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Message Content</h3>
            
            {/* Message Type Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleTypeChange('text')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    value.type === 'text'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Type className="w-5 h-5" />
                  <span className="font-medium">Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('image')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    value.type === 'image'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <ImageIcon className="w-5 h-5" />
                  <span className="font-medium">Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('button')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    value.type === 'button'
                      ? 'border-primary-500 bg-slate-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <MousePointerClick className="w-5 h-5" />
                  <span className="font-medium">Buttons</span>
                </button>
              </div>
            </div>

            {/* Message Text / Caption */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {value.type === 'image' ? 'Caption' : 'Message'}
              </label>
              <Textarea
                value={value.text}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder={value.type === 'image' ? 'Enter caption for the image...' : 'Enter your message...'}
                className="min-h-[100px]"
              />
              {errors?.text && <p className="mt-1 text-sm text-red-600">{errors.text}</p>}
            </div>

            {/* Image Upload (for image type and button type) */}
            {(value.type === 'image' || value.type === 'button') && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {value.type === 'image' ? 'Image' : 'Image (Optional Header)'}
                </label>
                {value.type === 'button' && (
                  <p className="text-xs text-gray-500 mb-2">
                    Add an optional image header to display above your buttons
                  </p>
                )}
                {value.mediaUrl ? (
                  <div className="relative">
                    <div className="border-2 border-gray-200 rounded-lg p-2 bg-gray-50">
                      <img
                        src={value.mediaUrl}
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
                  <button
                    type="button"
                    onClick={() => setShowMediaLibrary(true)}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <FolderOpen className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-600">Select from Media Library</span>
                  </button>
                )}
                {errors?.image && <p className="mt-1 text-sm text-red-600">{errors.image}</p>}
              </div>
            )}

            {/* Interactive Actions (for button type) */}
            {value.type === 'button' && (
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
                        onClick={() => handleCallToActionChange('phone', 'title', 'Call Us')}
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
                        onClick={() => handleCallToActionChange('url', 'title', 'Visit Us')}
                        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 pl-6"
                      >
                        <Plus className="w-4 h-4" />
                        Add URL
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Footer (optional) */}
            {(value.type === 'button' || value.type === 'text') && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Footer (optional)
                </label>
                <Input
                  type="text"
                  value={value.footer || ''}
                  onChange={(e) => handleFooterChange(e.target.value)}
                  placeholder="Optional footer text"
                />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Right Column: Preview */}
      <div>
        <WhatsAppPreview message={value} />
      </div>

      {/* Media Library Modal */}
      <MediaLibraryModal
        isOpen={showMediaLibrary}
        onClose={() => setShowMediaLibrary(false)}
        onSelect={handleMediaSelect}
      />
    </div>
  );
}
