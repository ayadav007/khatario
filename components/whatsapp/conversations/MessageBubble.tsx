'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, X, Bot, Megaphone, User, Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { MediaLightbox } from './MediaLightbox';
import { AudioPlayer } from './AudioPlayer';
import { DocumentViewer } from './DocumentViewer';
import { waChat } from '@/lib/whatsapp-chat-typography';

export interface MessageReaction {
  reaction: string;
  sender_jid: string;
}

export interface MessageBubbleProps {
  message: {
    id: string;
    message_text?: string;
    message_type: string;
    media_url?: string;
    buttons?: any; // JSONB array of buttons
    direction: 'incoming' | 'outgoing';
    status?: string;
    created_at: string;
    sender_type?: 'customer' | 'agent' | 'bot' | 'campaign';
    sender_name?: string; // For group messages - name of the sender
    sender_number?: string; // For group messages - phone number of the sender
    reactions?: MessageReaction[];
    quoted_message?: { // Replied/quoted message context
      text: string;
      type: string;
      sender: string;
      messageId?: string;
    };
  };
  isOutgoing: boolean;
  showAvatar?: boolean;
  senderType?: 'customer' | 'agent' | 'bot' | 'campaign';
  isGroup?: boolean; // Whether this is a group message
  allMessages?: Array<any>; // All messages in conversation for media navigation
  /** Re-fetch thread so media_url / status can update from the server */
  onMediaRefresh?: () => void;
}

// Helper function to linkify URLs in text
const linkifyText = (text: string) => {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);
  
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

export function MessageBubble({ 
  message, 
  isOutgoing, 
  showAvatar = false, 
  senderType, 
  isGroup = false,
  allMessages = [],
  onMediaRefresh
}: MessageBubbleProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageLoadState, setImageLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mediaRetrying, setMediaRetrying] = useState(false);
  const [imageRetryNonce, setImageRetryNonce] = useState(0);

  useEffect(() => {
    setImageLoadState('loading');
  }, [message.id, message.media_url]);

  const handleMediaRetry = () => {
    if (!onMediaRefresh) return;
    setMediaRetrying(true);
    setImageLoadState('loading');
    setImageRetryNonce(n => n + 1);
    try {
      onMediaRefresh();
    } finally {
      window.setTimeout(() => setMediaRetrying(false), 400);
    }
  };

  const messageDate = new Date(message.created_at);
  const timeStr = format(messageDate, 'h:mm a').toLowerCase();
  
  // Determine sender type
  const type = senderType || message.sender_type || (isOutgoing ? 'agent' : 'customer');
  
  // Parse buttons if present
  let buttons: Array<{ id: string; title: string; type?: string; phone?: string; url?: string }> = [];
  if (message.buttons) {
    try {
      const parsed = typeof message.buttons === 'string' ? JSON.parse(message.buttons) : message.buttons;
      buttons = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Failed to parse buttons:', e);
    }
  }

  // Render delivery status icon — handles both string and Baileys numeric codes
  const renderStatusIcon = () => {
    if (!isOutgoing || !message.status) return null;
    const s = String(message.status);
    // Baileys numeric: 0=error, 1=pending, 2=server ack, 3=delivery ack, 4=read, 5=played
    if (s === 'sent'     || s === '2') return <Check className={`${waChat.statusIcon} text-gray-500`} />;
    if (s === 'delivered'|| s === '3') return <CheckCheck className={`${waChat.statusIcon} text-gray-500`} />;
    if (s === 'read'     || s === '4') return <CheckCheck className={`${waChat.statusIcon} text-primary-500`} />;
    if (s === '5')                     return <CheckCheck className={`${waChat.statusIcon} text-primary-500`} />;
    if (s === 'failed'   || s === '0') return <X className={`${waChat.statusIcon} text-red-500`} />;
    // 1 = pending/clock — single grey tick
    if (s === '1' || s === 'pending') return <Check className={`${waChat.statusIcon} text-gray-400`} />;
    return null;
  };

  // Render sender type icon
  const renderSenderIcon = () => {
    if (!showAvatar) return null;
    
    switch (type) {
      case 'bot':
        return <Bot className="w-4 h-4 text-primary-600" />;
      case 'campaign':
        return <Megaphone className="w-4 h-4 text-orange-500" />;
      case 'agent':
        return <User className="w-4 h-4 text-primary-600" />;
      default:
        return null;
    }
  };

  return (
    <div className={clsx(
      'flex gap-2 mb-1',
      isOutgoing ? 'justify-end' : 'justify-start'
    )}>
      {/* Avatar (for incoming messages or if showAvatar is true) */}
      {!isOutgoing && showAvatar && (
        <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
          {renderSenderIcon() || message.message_text?.charAt(0)?.toUpperCase() || '?'}
        </div>
      )}

      <div className={clsx(
        'flex flex-col max-w-[75%] md:max-w-[65%]',
        isOutgoing ? 'items-end' : 'items-start'
      )}>
        {/* Sender name for group messages (incoming only) — fall back to phone number */}
        {isGroup && !isOutgoing && (message.sender_name || message.sender_number) && (
          <div className={clsx(waChat.msgMeta, 'px-1 mb-0.5')}>
            {message.sender_name || `+${message.sender_number}`}
          </div>
        )}
        {/* Message bubble - WhatsApp style */}
        <div className={clsx(
          'rounded-lg px-3 py-2 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]',
          isOutgoing 
            ? 'bg-[#d9fdd3] text-[#111b21]' 
            : 'bg-white text-[#111b21] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]'
        )}>
          {/* Quoted/Replied Message - WhatsApp Web style */}
          {message.quoted_message && (
            <div className={clsx(
              'mb-2 px-2 py-1.5 rounded-md border-l-4',
              isOutgoing 
                ? 'bg-[#cfe9ba] border-l-[#06cf9c]'
                : 'bg-[#f0f2f5] border-l-[#06cf9c]'
            )}>
              {/* Sender name - extract from JID */}
              <div className={waChat.msgQuoteName}>
                {message.quoted_message.sender.includes('@') 
                  ? message.quoted_message.sender.split('@')[0]
                  : message.quoted_message.sender}
              </div>
              {/* Quoted message content */}
              <div className={clsx(waChat.msgQuoteBody, 'flex items-center gap-1.5')}>
                {message.quoted_message.type === 'image' && <span>📷</span>}
                {message.quoted_message.type === 'video' && <span>🎥</span>}
                {message.quoted_message.type === 'audio' && <span>🎵</span>}
                {message.quoted_message.type === 'document' && <span>📄</span>}
                <span className="line-clamp-2">{message.quoted_message.text}</span>
              </div>
            </div>
          )}
          
          {['image', 'video', 'document', 'audio', 'sticker'].includes(
            message.message_type || 'text'
          ) &&
            !message.media_url && (
              <div
                className={clsx(waChat.msgSecondary, 'mb-2 p-3 bg-[#f0f2f5] rounded border border-dashed border-gray-300 flex flex-col gap-2')}
              >
                <div className="flex items-center gap-2">
                  <Loader2
                    className="w-6 h-6 shrink-0 text-primary-500 animate-spin"
                    aria-hidden
                  />
                  <span>
                    {message.message_type === 'image' && '📷 '}
                    {message.message_type === 'video' && '🎥 '}
                    {message.message_type === 'audio' && '🎵 '}
                    {message.message_type === 'document' && '📄 '}
                    {message.message_type === 'sticker' && '🎭 '}
                    Preparing media…{message.message_text ? ` — ${message.message_text}` : ''}
                  </span>
                </div>
                {onMediaRefresh && (
                  <button
                    type="button"
                    onClick={handleMediaRetry}
                    disabled={mediaRetrying}
                    className={clsx(waChat.msgTime, 'inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-gray-300 bg-white px-2 py-1 text-[#111b21] hover:bg-gray-50 disabled:opacity-50')}
                  >
                    <RefreshCw className={`w-4 h-4 ${mediaRetrying ? 'animate-spin' : ''}`} />
                    Retry
                  </button>
                )}
              </div>
            )}

          {/* Media (Image, Video, Document, Audio) */}
          {message.media_url && (
            <div className="mb-2 rounded overflow-hidden">
              {(message.message_type === 'image' || !message.message_type) && (
                <div 
                  className={`group relative min-h-[80px] ${imageLoadState === 'error' ? 'cursor-default' : 'cursor-pointer'}`}
                  onClick={() => {
                    if (imageLoadState === 'ready') setIsLightboxOpen(true);
                  }}
                >
                  {imageLoadState === 'loading' && (
                    <div className="absolute inset-0 z-10 flex min-h-[120px] max-h-[300px] items-center justify-center gap-2 bg-[#f0f2f5] text-[#667781]">
                      <Loader2 className="h-7 w-7 animate-spin text-primary-500" aria-hidden />
                      <span className={waChat.msgTime}>Loading…</span>
                    </div>
                  )}
                  {imageLoadState === 'error' && (
                    <div className="flex min-h-[120px] flex-col items-stretch justify-center gap-2 bg-[#f0f2f5] p-3 text-center text-[#667781]">
                      <span className={waChat.msgSecondary}>Couldn’t load image</span>
                      {onMediaRefresh && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleMediaRetry();
                          }}
                          disabled={mediaRetrying}
                          className={clsx(waChat.msgTime, 'inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[#111b21] hover:bg-gray-50 disabled:opacity-50')}
                        >
                          <RefreshCw className={`h-4 w-4 ${mediaRetrying ? 'animate-spin' : ''}`} />
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                  <img 
                    key={`${message.id}-${message.media_url}-${imageRetryNonce}`}
                    src={message.media_url} 
                    alt={message.message_text || 'Message attachment'}
                    className={`max-w-full h-auto max-h-[300px] object-contain group-hover:opacity-90 transition ${
                      imageLoadState === 'ready' ? 'block' : 'sr-only'
                    }`}
                    onLoad={() => setImageLoadState('ready')}
                    onError={() => setImageLoadState('error')}
                    aria-hidden={imageLoadState !== 'ready'}
                  />
                  {imageLoadState === 'ready' && (
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition flex items-center justify-center pointer-events-none">
                      <span className={clsx(waChat.msgTime, 'opacity-0 group-hover:opacity-100 text-white bg-black bg-opacity-50 px-3 py-1 rounded')}>
                        Click to view
                      </span>
                    </div>
                  )}
                </div>
              )}
              
              {message.message_type === 'video' && (
                <div 
                  className="cursor-pointer"
                  onClick={() => setIsLightboxOpen(true)}
                >
                  <video 
                    src={message.media_url} 
                    className="max-w-full h-auto max-h-[300px] object-contain"
                  >
                    Your browser does not support video playback.
                  </video>
                    <div className={clsx(waChat.msgTime, 'text-center text-gray-500 mt-1')}>
                    Click to play in full screen
                  </div>
                </div>
              )}
              
              {message.message_type === 'document' && (
                <DocumentViewer
                  documentUrl={message.media_url}
                  fileName={message.message_text || 'Document'}
                />
              )}
              
              {message.message_type === 'audio' && (
                <AudioPlayer
                  audioUrl={message.media_url}
                  fileName={message.message_text || 'Audio'}
                />
              )}
              
              {!['image', 'video', 'document', 'audio'].includes(message.message_type || 'image') && (
                <div className={clsx(waChat.msgSecondary, 'p-4 bg-gray-50 rounded border border-gray-200')}>
                  <span className="mr-2">
                    {message.message_type === 'sticker' ? '🎭' : '📎'}
                  </span>
                  <a 
                    href={message.media_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline"
                  >
                    {message.message_text || 'View media'}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Text / Caption */}
          {message.message_text && (
            <div className={clsx(waChat.msgText, 'whitespace-pre-wrap break-words')}>
              {linkifyText(message.message_text)}
            </div>
          )}
          
          {/* Fallback for media-only messages without text */}
          {message.media_url && !message.message_text && (
            <div className={waChat.msgCaption}>
              {message.message_type === 'image' ? 'Photo' :
               message.message_type === 'video' ? 'Video' :
               message.message_type === 'document' ? 'Document' :
               'Media'}
            </div>
          )}

          {/* Buttons preview */}
          {buttons.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {buttons.map((btn, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    waChat.msgBtn,
                    'px-3 py-2 rounded border',
                    isOutgoing
                      ? 'bg-white/80 border-white/60 text-[#111b21]'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  )}
                >
                  {btn.title}
                  {btn.type === 'call' && btn.phone && (
                    <span className={clsx(waChat.msgTime, 'ml-1 opacity-75')}>📞 {btn.phone}</span>
                  )}
                  {btn.type === 'url' && btn.url && (
                    <span className={clsx(waChat.msgTime, 'ml-1 opacity-75')}>🔗</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp and status - WhatsApp style */}
        <div className={clsx(
          'flex items-center gap-1 mt-0.5 justify-end',
          isOutgoing ? 'flex-row' : 'flex-row-reverse'
        )}>
          <span className={waChat.msgTime}>{timeStr}</span>
          {isOutgoing && renderStatusIcon()}
        </div>

        {/* Emoji Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className={clsx(
            'flex gap-0.5 mt-1',
            isOutgoing ? 'justify-end' : 'justify-start'
          )}>
            <div className="flex gap-0.5 bg-white border border-gray-200 rounded-full px-2 py-0.5 shadow-sm">
              {[...new Map(message.reactions.map(r => [r.reaction, r])).values()].map(r => (
                <span key={r.reaction} className={waChat.reactionEmoji}>{r.reaction}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Avatar (for outgoing messages if showAvatar is true) */}
      {isOutgoing && showAvatar && type === 'agent' && (
        <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white flex-shrink-0">
          <User className="w-4 h-4" />
        </div>
      )}

      {/* Media Lightbox */}
      {isLightboxOpen && message.media_url && (message.message_type === 'image' || message.message_type === 'video' || !message.message_type) && (
        <MediaLightbox
          media={{
            url: message.media_url,
            type: message.message_type === 'video' ? 'video' : 'image',
            caption: message.message_text,
            timestamp: message.created_at,
            sender: message.sender_name
          }}
          allMedia={allMessages
            .filter(m => m.media_url && (m.message_type === 'image' || m.message_type === 'video' || !m.message_type))
            .map(m => ({
              id: m.id,
              url: m.media_url!,
              type: m.message_type === 'video' ? 'video' : 'image',
              caption: m.message_text,
              timestamp: m.created_at,
              sender: m.sender_name
            }))}
          currentIndex={allMessages
            .filter(m => m.media_url && (m.message_type === 'image' || m.message_type === 'video' || !m.message_type))
            .findIndex(m => m.id === message.id)}
          onClose={() => setIsLightboxOpen(false)}
          onNavigate={(index) => {
            // Keep lightbox open, just update the media
            // The parent will need to handle this
          }}
        />
      )}
    </div>
  );
}

