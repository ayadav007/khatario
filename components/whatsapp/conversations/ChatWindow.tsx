'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Send, Loader2, MoreVertical, Archive, Bell, BellOff, Ban, Trash2, ChevronDown, Phone, Video, Search, X, BookOpen } from 'lucide-react';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { MessageBubble } from './MessageBubble';
import { ExportButton } from './ExportButton';
import { SavedRepliesModal } from './SavedRepliesModal';
import { Toast } from '@/components/ui/Toast';

export interface Conversation {
  id: string;
  conversation_id: string;
  from_number: string;
  customer_name?: string;
  customer_phone?: string;
  is_group?: boolean;
  group_name?: string;
  assigned_to?: string | null;
  conversation_status?: string;
  lead_status?: string;
  profile_picture_url?: string | null;
}

export interface Message {
  id: string;
  message_id?: string;
  message_text?: string;
  message_type: string;
  media_url?: string;
  buttons?: any;
  direction: 'incoming' | 'outgoing';
  status?: string;
  created_at: string;
  /** WhatsApp proto time when stored (optional; display uses created_at) */
  source_timestamp?: string | null;
  sender_type?: 'customer' | 'agent' | 'bot' | 'campaign';
  sender_name?: string;
  sender_number?: string;
  reactions?: Array<{ reaction: string; sender_jid: string }>;
}

/** Stable order when created_at matches (e.g. same-second inserts). */
function sortMessagesChronological(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.message_id || a.id || '').localeCompare(String(b.message_id || b.id || ''));
  });
}

interface ChatWindowProps {
  conversation: Conversation | null;
  messages: Message[];
  onSendMessage: (text: string, type?: string, buttons?: any[], media?: File) => Promise<void>;
  onUpdateConversation?: (updates: { assigned_to?: string | null; conversation_status?: string }) => Promise<void>;
  loading?: boolean;
  businessId: string;
  error?: string | null;
  onRetry?: () => void;
  onLoadOlderMessages?: () => void;
  loadingOlderMessages?: boolean;
  hasMoreMessages?: boolean;
  /** Re-fetch current thread from DB (e.g. after media_url is populated) */
  onRefreshMessages?: () => void;
}

interface GroupedMessageItem {
  type: 'date' | 'message';
  id: string;
  dateKey?: string;
  dateLabel?: string;
  message?: Message;
  showTime?: boolean;
  prevMessage?: Message | null;
}

// Memoized MessageBubble component
const MemoizedMessageBubble = memo(MessageBubble);

// Debounce utility
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

export function ChatWindow({
  conversation,
  messages,
  onSendMessage,
  onUpdateConversation,
  loading = false,
  businessId,
  error,
  onRetry,
  onLoadOlderMessages,
  loadingOlderMessages = false,
  hasMoreMessages = true,
  onRefreshMessages
}: ChatWindowProps) {
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollPositionRef = useRef<number>(0);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [showSavedReplies, setShowSavedReplies] = useState(false);
  // Quick-search popup triggered by "/" at start of input
  const [savedRepliesQuickSearch, setSavedRepliesQuickSearch] = useState(false);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setShowMoreMenu(false);
        setShowStatusDropdown(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    }

    if (showMoreMenu || showAttachmentMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMoreMenu, showAttachmentMenu]);

  // Memoized grouped messages with date separators
  const groupedItems = useMemo<GroupedMessageItem[]>(() => {
    if (messages.length === 0) return [];

    const items: GroupedMessageItem[] = [];
    const groupedMessages: { [key: string]: Message[] } = {};
    const ordered = sortMessagesChronological(messages);

    // Group messages by date
    ordered.forEach((msg) => {
      const dateKey = format(new Date(msg.created_at), 'yyyy-MM-dd');
      if (!groupedMessages[dateKey]) {
        groupedMessages[dateKey] = [];
      }
      groupedMessages[dateKey].push(msg);
    });

    // Create flat array with date separators and messages
    Object.keys(groupedMessages).sort().forEach((dateKey) => {
      const date = new Date(dateKey);
      const dateLabel = isToday(date)
        ? 'Today'
        : isYesterday(date)
        ? 'Yesterday'
        : format(date, 'MMMM d, yyyy');

      // Add date separator
      items.push({
        type: 'date',
        id: `date-${dateKey}`,
        dateKey,
        dateLabel
      });

      // Add messages for this date
      groupedMessages[dateKey].forEach((msg, idx, arr) => {
        const prevMsg = idx > 0 ? arr[idx - 1] : null;
        const msgDate = new Date(msg.created_at);
        const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;
        const timeGap = prevDate ? msgDate.getTime() - prevDate.getTime() : Infinity;
        const showTime = !prevDate || timeGap > 300000; // 5 minutes

        items.push({
          type: 'message',
          id: msg.id,
          message: msg,
          showTime,
          prevMessage: prevMsg
        });
      });
    });

    return items;
  }, [messages]);

  // Virtualizer setup with dynamic size estimation
  const virtualizer = useVirtualizer({
    count: groupedItems.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: useCallback((index: number) => {
      const item = groupedItems[index];
      return item?.type === 'date' ? 48 : 120; // Taller rows after 2× message font
    }, [groupedItems]),
    overscan: 5, // Render 5 items outside viewport
  });

  // Track scroll position and determine if at bottom or top
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    scrollPositionRef.current = scrollTop;
    setIsAtBottom(distanceFromBottom < 100);
    shouldAutoScrollRef.current = distanceFromBottom < 100;

    // Detect scroll to top for loading older messages (WhatsApp Web behavior)
    if (scrollTop < 100) {
      if (hasMoreMessages && !loadingOlderMessages && onLoadOlderMessages) {
        onLoadOlderMessages();
      }
    }
  }, [hasMoreMessages, loadingOlderMessages, onLoadOlderMessages]);

  // Debounced scroll handler
  const debouncedScrollHandler = useMemo(
    () => debounce(handleScroll, 50),
    [handleScroll]
  );

  // Scroll listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', debouncedScrollHandler, { passive: true });
    return () => container.removeEventListener('scroll', debouncedScrollHandler);
  }, [debouncedScrollHandler]);


  // Professional scroll anchoring with requestAnimationFrame
  useEffect(() => {
    if (messages.length === 0 || !messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const wasAtBottom = shouldAutoScrollRef.current;
    
    if (wasAtBottom) {
      // Double RAF + small delay to ensure virtualizer updates
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - container.clientHeight;
            }
          }, 50);
        });
      });
    }
  }, [messages.length]);
  
  // Initial scroll to bottom when conversation loads
  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      
      // Wait for virtualizer to render all items, then scroll to bottom
      // Use multiple animation frames to ensure DOM is fully updated
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            container.scrollTop = container.scrollHeight;
            shouldAutoScrollRef.current = true;
            setIsAtBottom(true);
          }, 100); // Small delay to ensure virtualizer has measured all items
        });
      });
    }
  }, [conversation?.id]); // Only run when conversation changes

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [messageText]);

  const getFileType = (file: File): string => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 16 * 1024 * 1024; // 16MB
      if (file.size > maxSize) {
        setToast({ message: 'File exceeds 16MB limit', type: 'error' });
        return;
      }
      setSelectedFile(file);
      setShowAttachmentMenu(false);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if ((!messageText.trim() && !selectedFile) || sending || !conversation) return;

    setSending(true);
    try {
      const messageType = selectedFile ? getFileType(selectedFile) : 'text';
      await onSendMessage(messageText.trim() || '', messageType, [], selectedFile || undefined);
      setMessageText('');
      setSelectedFile(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      shouldAutoScrollRef.current = true;
      setIsAtBottom(true);
      // Double RAF + delay for virtualizer
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (messagesContainerRef.current) {
              const container = messagesContainerRef.current;
              container.scrollTop = container.scrollHeight - container.clientHeight;
            }
          }, 50);
        });
      });
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMessage = error?.message || error?.error || 'Failed to send message';
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone) return 'Unknown';
    const clean = phone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (clean.length === 12) {
      return `+${clean.slice(0, 2)} ${clean.slice(2, 7)} ${clean.slice(7)}`;
    }
    if (clean.length === 10) {
      return `${clean.slice(0, 5)} ${clean.slice(5)}`;
    }
    return clean;
  };

  const getDisplayName = (conv: Conversation | null): string => {
    if (!conv) return 'Unknown';
    if (conv.is_group && conv.group_name) return conv.group_name;
    if (conv.customer_name) return conv.customer_name;
    return formatPhoneNumber(conv.conversation_id || conv.from_number);
  };

  const displayName = getDisplayName(conversation);
  const virtualItems = virtualizer.getVirtualItems();


  return (
    <>
      {/* WhatsApp Web-style scrollbar CSS - Always visible when scrolling */}
      <style jsx global>{`
        .scrollbar-visible::-webkit-scrollbar {
          width: 8px !important;
          height: 8px;
        }
        .scrollbar-visible::-webkit-scrollbar-track {
          background: #f0f0f0 !important;
        }
        .scrollbar-visible::-webkit-scrollbar-thumb {
          background: #999 !important;
          border-radius: 4px;
        }
        .scrollbar-visible::-webkit-scrollbar-thumb:hover {
          background: #777 !important;
        }
      `}</style>

      <div className="flex flex-col h-full bg-[#efeae2]" style={{ minHeight: 0, overflow: 'hidden', backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}>
        {!conversation ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-500">
            <p className="text-lg mb-2">Select a conversation</p>
            <p className="text-sm">Choose a conversation from the list to start chatting</p>
          </div>
        </div>
      ) : (
        <>
      {/* Header - WhatsApp style */}
      <div className="bg-[#008069] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Avatar */}
            {conversation.profile_picture_url ? (
              <img
                src={conversation.profile_picture_url}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }
                }}
              />
            ) : null}
            <div
              className={`w-10 h-10 rounded-full bg-[#dfe5e7] flex items-center justify-center text-[#54656f] font-medium text-base flex-shrink-0 avatar-fallback ${conversation.profile_picture_url ? 'hidden' : ''}`}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
            
            {/* Name and phone */}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-white truncate" style={{ fontSize: '32px', lineHeight: '40px' }}>{displayName}</h3>
              {!conversation.is_group && conversation.customer_phone && (
                <p className="text-white/80" style={{ fontSize: '24px', lineHeight: '30px' }}>{formatPhoneNumber(conversation.customer_phone)}</p>
              )}
            </div>
          </div>

          {/* Actions - WhatsApp style icons */}
          <div className="flex items-center gap-1">
            <button className="p-2 text-white hover:bg-white/10 rounded-full transition-colors">
              <Video className="w-5 h-5" />
            </button>
            <button className="p-2 text-white hover:bg-white/10 rounded-full transition-colors">
              <Phone className="w-5 h-5" />
            </button>
            <div className="relative" ref={moreMenuRef}>
              <button 
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[200px]">
                  <button 
                    onClick={() => {
                      setShowMoreMenu(false);
                      setToast({ message: 'Search in messages feature coming soon', type: 'info' });
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Search className="w-4 h-4" />
                    Search in this chat
                  </button>
                  {conversation?.id && (
                    <div className="px-4 py-2 border-t border-gray-100">
                      <ExportButton
                        businessId={businessId}
                        conversationId={conversation.id}
                        disabled={loading}
                      />
                    </div>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowStatusDropdown(!showStatusDropdown);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between"
                    >
                      <span>Conversation Status</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    {showStatusDropdown && (
                      <div className="pl-4 border-l-2 border-gray-100 ml-2">
                        {['open', 'pending', 'closed', 'bot_resolved'].map((status) => (
                          <button
                            key={status}
                            onClick={async () => {
                              await onUpdateConversation?.({ conversation_status: status });
                              setShowStatusDropdown(false);
                              setShowMoreMenu(false);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 capitalize"
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2">
                    <Archive className="w-4 h-4" />
                    Archive
                  </button>
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2">
                    <BellOff className="w-4 h-4" />
                    Mute
                  </button>
                  <button className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages Area - Virtualized */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 scrollbar-visible" 
        style={{ 
          minHeight: 0,
          scrollbarWidth: 'thin', // Firefox
          scrollbarColor: '#999 #f0f0f0', // Firefox
          WebkitOverflowScrolling: 'touch' // Smooth scrolling on iOS
        }}
      >
        {/* Loading indicator for older messages (WhatsApp Web behavior) */}
        {loadingOlderMessages && messages.length > 0 && (
          <div className="flex justify-center py-3">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading older messages...</span>
            </div>
          </div>
        )}
        
        {!hasMoreMessages && messages.length > 0 && (
          <div className="flex justify-center py-3">
            <div className="text-gray-400 bg-gray-100 px-3 py-1 rounded-full" style={{ fontSize: '25.6px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
              Beginning of conversation
            </div>
          </div>
        )}

        {loading && messages.length === 0 ? (
          /* Enhanced Skeletons */
          <div className="flex flex-col gap-3 py-2">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={`skeleton-msg-${idx}`} className="flex items-start gap-2 animate-pulse">
                {conversation.is_group && (
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex-shrink-0" />
                )}
                <div className="flex-1 space-y-2">
                  {conversation.is_group && (
                    <div className="h-3 bg-gray-300 rounded w-20" />
                  )}
                  <div className="max-w-xs rounded-2xl bg-gray-300 py-4 px-4" />
                  <div className="h-2 bg-gray-200 rounded w-16" />
                </div>
              </div>
            ))}
          </div>
          /* END Enhanced Skeletons */
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 px-4 max-w-md">
              <p className="text-lg mb-2 text-red-600 font-medium">Failed to load messages</p>
              <p className="text-sm mb-4 text-gray-600">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <p className="text-lg mb-2">No messages yet</p>
              <p className="text-sm">Start the conversation by sending a message</p>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: virtualItems.length > 0 ? `${virtualizer.getTotalSize()}px` : 'auto',
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.length === 0 || !messagesContainerRef.current ? (
              // Fallback: render all items if virtualizer hasn't calculated yet
          groupedItems.map((item) => {
                if (item.type === 'date') {
                  return (
                    <div key={item.id} className="flex justify-center my-2">
                      <span className="bg-[#ffffffd9] text-[#54656f] px-3 py-1 rounded-full" style={{ fontSize: '25.6px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                        {item.dateLabel}
                      </span>
                    </div>
                  );
                }
                if (item.type === 'message' && item.message) {
                  return (
                    <MemoizedMessageBubble
                      key={item.id}
                      message={item.message}
                      isOutgoing={item.message.direction === 'outgoing'}
                      showAvatar={item.showTime && !conversation.is_group}
                      senderType={item.message.sender_type}
                      isGroup={conversation.is_group}
                      allMessages={messages}
                      onMediaRefresh={onRefreshMessages}
                    />
                  );
                }
                return null;
              })
            ) : (
              virtualItems.map((virtualItem: VirtualItem) => {
                const item = groupedItems[virtualItem.index];
                
                if (!item) return null;
                
                if (item.type === 'date') {
                  return (
                    <div
                      key={item.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="flex justify-center my-2">
                        <span className="bg-[#ffffffd9] text-[#54656f] px-3 py-1 rounded-full" style={{ fontSize: '25.6px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                        {item.dateLabel}
                      </span>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'message' && item.message) {
                  return (
                    <div
                      key={item.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <MemoizedMessageBubble
                        message={item.message}
                        isOutgoing={item.message.direction === 'outgoing'}
                        showAvatar={item.showTime && !conversation.is_group}
                        senderType={item.message.sender_type}
                        isGroup={conversation.is_group}
                        allMessages={messages}
                        onMediaRefresh={onRefreshMessages}
                      />
                    </div>
                  );
                }

                return null;
              })
            )}
          </div>
        )}
      </div>

      {/* Composer - WhatsApp style */}
      <div className="bg-[#f0f2f5] px-4 py-2 flex-shrink-0">
        {/* Selected file preview */}
        {selectedFile && (
          <div className="mb-2 bg-white rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-2xl">
                {selectedFile.type.startsWith('image/') ? '🖼️' :
                 selectedFile.type.startsWith('video/') ? '🎥' :
                 selectedFile.type.startsWith('audio/') ? '🎵' : '📄'}
              </div>
              <div>
                <div className="text-sm font-medium">{selectedFile.name}</div>
                <div className="text-xs text-gray-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            </div>
            <button
              onClick={handleRemoveFile}
              className="text-red-500 hover:text-red-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attachment button with menu */}
          <div className="relative flex-shrink-0" ref={attachmentMenuRef}>
            <button 
              onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
              className="p-2 text-[#54656f] hover:bg-gray-200 rounded-full transition-colors"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
            
            {/* Attachment menu */}
            {showAttachmentMenu && (
              <div className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 py-2 min-w-[200px] z-10">
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowAttachmentMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-[#8696a0]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                  </svg>
                  <span className="text-sm">Photos & Videos</span>
                </button>
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowAttachmentMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-[#8696a0]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
                  </svg>
                  <span className="text-sm">Document</span>
                </button>
              </div>
            )}
            
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
          
          {/* Message input */}
          <div className="flex-1 bg-white rounded-3xl px-4 py-2 border border-gray-200 flex items-center">
            <Textarea
              ref={textareaRef}
              value={messageText}
              onChange={(e) => {
                const val = e.target.value;
                setMessageText(val);
                // Open quick-pick when agent types "/" as the first character
                if (val === '/') setSavedRepliesQuickSearch(true);
                else if (savedRepliesQuickSearch && !val.startsWith('/')) setSavedRepliesQuickSearch(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a message or / for saved replies"
              rows={1}
              className="flex-1 resize-none min-h-[40px] max-h-[200px] border-0 focus:ring-0 focus:outline-none p-0"
              style={{ fontSize: '30px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif', lineHeight: '40px' }}
            />
            {/* Saved replies icon */}
            <button
              onClick={() => setShowSavedReplies(true)}
              title="Saved Replies"
              className="p-1 text-[#54656f] hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 ml-1"
            >
              <BookOpen className="w-5 h-5" />
            </button>
            {/* Emoji button */}
            <button className="p-1 text-[#54656f] hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 ml-1">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </button>
          </div>
          
          {/* Send button or microphone */}
          {messageText.trim() || selectedFile ? (
            <button
              onClick={handleSend}
              disabled={sending}
              className="p-2 bg-[#008069] text-white rounded-full hover:bg-[#006b57] transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          ) : (
            <button className="p-2 text-[#54656f] hover:bg-gray-200 rounded-full transition-colors flex-shrink-0">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
        </>
      )}
      </div>

      {/* Saved replies modal (full picker + manage) */}
      {(showSavedReplies || savedRepliesQuickSearch) && (
        <SavedRepliesModal
          businessId={businessId}
          manageMode={showSavedReplies && !savedRepliesQuickSearch}
          onSelect={(msg) => {
            setMessageText(msg);
            setShowSavedReplies(false);
            setSavedRepliesQuickSearch(false);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
          onClose={() => {
            setShowSavedReplies(false);
            setSavedRepliesQuickSearch(false);
          }}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </>
  );
}
