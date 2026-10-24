'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Send, Loader2, MoreVertical, ChevronDown, Search, X, BookOpen, Bot, Pause, Play, Hand, UserCheck, CheckCircle2, ArrowRightLeft, ArrowLeft, Info, FileText, Smile, Clock } from 'lucide-react';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';
import { Textarea } from '@/components/ui/Textarea';
import { MessageBubble } from './MessageBubble';
import { ExportButton } from './ExportButton';
import { SavedRepliesModal } from './SavedRepliesModal';
import { QuickReplyPicker, fillQuickReply, type QuickReply, type QuickReplyPickerHandle } from './QuickReplyPicker';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePickerModal, type TemplateSendInput } from './TemplatePickerModal';
import { waChat } from '@/lib/whatsapp-chat-typography';
import { clsx } from 'clsx';
import { Toast } from '@/components/ui/Toast';
import {
  describeOwnershipEvent,
  INBOX_STATE_LABEL,
  type OwnershipAction,
  type OwnershipEvent,
  type OwnershipView,
  type TeamMember,
} from './inbox';

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
  bot_paused_until?: string | null;
  bot_paused_reason?: string | null;
  handoff_requested_at?: string | null;
}

export type ConversationBotState = Pick<Conversation, 'bot_paused_until' | 'bot_paused_reason' | 'handoff_requested_at'>;

const BOT_PAUSE_REASON: Record<string, string> = {
  staff_reply: 'a team member replied',
  handoff: 'the customer asked for a person',
  manual: 'paused by your team',
};

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
  sent_by?: 'bot' | 'staff' | 'campaign' | null;
  sent_by_name?: string | null;
  sender_name?: string;
  sender_number?: string;
  reactions?: Array<{ reaction: string; sender_jid: string }>;
  /** Set on a failed send kept in the thread so the agent can retry it. */
  local_error?: string;
  local_file?: File;
}

/** Meta's 24-hour customer-service window for the open chat (always open on QR numbers). */
export interface ReplyWindowView {
  transport: 'cloud' | 'baileys';
  last_incoming_at: string | null;
  expires_at: string | null;
  open: boolean;
}

function windowRemaining(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  onBotStateChange?: (conversationId: string, state: ConversationBotState) => void;
  ownership?: OwnershipView | null;
  ownershipEvents?: OwnershipEvent[];
  currentUserId?: string | null;
  teamMembers?: TeamMember[];
  /** Rejects with the server's message (e.g. "Already taken by Ravi") so it can be shown. */
  onOwnershipAction?: (action: OwnershipAction, toUserId?: string) => Promise<void>;
  loading?: boolean;
  businessId: string;
  error?: string | null;
  onRetry?: () => void;
  onLoadOlderMessages?: () => void;
  loadingOlderMessages?: boolean;
  hasMoreMessages?: boolean;
  /** Re-fetch current thread from DB (e.g. after media_url is populated) */
  onRefreshMessages?: () => void;
  replyWindow?: ReplyWindowView | null;
  onSendTemplate?: (input: TemplateSendInput) => Promise<void>;
  onRetryMessage?: (message: Message) => void;
  /** Phones: back to the chat list. */
  onBack?: () => void;
  /** Phones: open the contact panel. */
  onShowContact?: () => void;
  currentUserName?: string | null;
}

interface GroupedMessageItem {
  type: 'date' | 'message' | 'event';
  id: string;
  dateKey?: string;
  dateLabel?: string;
  message?: Message;
  event?: OwnershipEvent;
  showTime?: boolean;
  prevMessage?: Message | null;
}

// Memoized MessageBubble component
const MemoizedMessageBubble = memo(MessageBubble);

function SystemLine({ event, meId }: { event: OwnershipEvent; meId?: string | null }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-md bg-white/80 px-3 py-1 text-xs text-gray-600 shadow-sm">
        {describeOwnershipEvent(event, meId)} · {format(new Date(event.created_at), 'h:mm a')}
      </span>
    </div>
  );
}

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
  onBotStateChange,
  ownership = null,
  ownershipEvents = [],
  currentUserId = null,
  teamMembers = [],
  onOwnershipAction,
  loading = false,
  businessId,
  error,
  onRetry,
  onLoadOlderMessages,
  loadingOlderMessages = false,
  hasMoreMessages = true,
  onRefreshMessages,
  replyWindow = null,
  onSendTemplate,
  onRetryMessage,
  onBack,
  onShowContact,
  currentUserName = null,
}: ChatWindowProps) {
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [ownershipBusy, setOwnershipBusy] = useState<OwnershipAction | null>(null);
  const transferRef = useRef<HTMLDivElement>(null);
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
  const quickReplyRef = useRef<QuickReplyPickerHandle>(null);
  const [quickReplyDismissed, setQuickReplyDismissed] = useState(false);
  const quickReplyQuery = /^\/(\S*)$/.exec(messageText)?.[1] ?? null;
  const showQuickReplies = quickReplyQuery !== null && !quickReplyDismissed;
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [botBusy, setBotBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setSearchTerm('');
    setShowTemplates(false);
    setQuickReplyDismissed(false);
  }, [conversation?.id]);

  const isCloud = replyWindow?.transport === 'cloud' && !conversation?.is_group;
  const windowLeft = isCloud ? windowRemaining(replyWindow?.expires_at ?? null, now) : null;
  const windowClosed = isCloud && !windowLeft;

  const pausedUntil = conversation?.bot_paused_until ? new Date(conversation.bot_paused_until) : null;
  const botPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();

  const setConversationBot = useCallback(
    async (action: 'pause' | 'resume') => {
      if (!conversation?.id || conversation.is_group) return;
      setBotBusy(true);
      try {
        const res = await fetch(
          `/api/whatsapp/conversations/${encodeURIComponent(conversation.id)}/bot?business_id=${encodeURIComponent(businessId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to update AI');
        onBotStateChange?.(conversation.id, {
          bot_paused_until: data.bot_paused_until ?? null,
          bot_paused_reason: data.bot_paused_reason ?? null,
          handoff_requested_at: data.handoff_requested_at ?? null,
        });
        setToast({ message: action === 'pause' ? 'AI paused for this chat' : 'AI resumed for this chat', type: 'success' });
      } catch (e) {
        setToast({ message: e instanceof Error ? e.message : 'Failed to update AI', type: 'error' });
      } finally {
        setBotBusy(false);
      }
    },
    [conversation?.id, conversation?.is_group, businessId, onBotStateChange],
  );

  const runOwnershipAction = useCallback(
    async (action: OwnershipAction, toUserId?: string) => {
      if (!onOwnershipAction) return;
      setOwnershipBusy(action);
      setShowTransfer(false);
      try {
        await onOwnershipAction(action, toUserId);
        if (action === 'resolve') setToast({ message: 'Chat resolved and handed back to the bot', type: 'success' });
        if (action === 'transfer') setToast({ message: 'Chat transferred', type: 'success' });
      } catch (e) {
        setToast({ message: e instanceof Error ? e.message : 'Something went wrong', type: 'error' });
      } finally {
        setOwnershipBusy(null);
      }
    },
    [onOwnershipAction],
  );

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setShowMoreMenu(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
      if (transferRef.current && !transferRef.current.contains(event.target as Node)) {
        setShowTransfer(false);
      }
      if (emojiRef.current && !emojiRef.current.contains(event.target as Node)) {
        setShowEmoji(false);
      }
    }

    if (showMoreMenu || showAttachmentMenu || showTransfer || showEmoji) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMoreMenu, showAttachmentMenu, showTransfer, showEmoji]);

  const visibleMessages = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.message_text || '').toLowerCase().includes(q));
  }, [messages, searchTerm]);

  // Memoized grouped messages (plus ownership system lines) with date separators
  const groupedItems = useMemo<GroupedMessageItem[]>(() => {
    const searching = !!searchTerm.trim();
    if (visibleMessages.length === 0 && (searching || ownershipEvents.length === 0)) return [];

    const items: GroupedMessageItem[] = [];
    type Entry = { at: number; message?: Message; event?: OwnershipEvent };
    const groupedMessages: { [key: string]: Entry[] } = {};
    const ordered = sortMessagesChronological(visibleMessages);
    // Events older than the loaded page would float above unrelated history, so only show those in range.
    const oldestLoaded = hasMoreMessages && ordered.length > 0 ? new Date(ordered[0].created_at).getTime() : -Infinity;

    const push = (at: number, entry: Entry) => {
      const dateKey = format(new Date(at), 'yyyy-MM-dd');
      (groupedMessages[dateKey] ||= []).push(entry);
    };
    ordered.forEach((msg) => push(new Date(msg.created_at).getTime(), { at: new Date(msg.created_at).getTime(), message: msg }));
    if (!searching) {
      ownershipEvents.forEach((ev) => {
        const at = new Date(ev.created_at).getTime();
        if (at >= oldestLoaded) push(at, { at, event: ev });
      });
    }

    // Create flat array with date separators, messages and system lines
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

      // Add messages and system lines for this date (stable sort keeps message order on equal times)
      let prevMsg: Message | null = null;
      groupedMessages[dateKey]
        .sort((a, b) => a.at - b.at)
        .forEach((entry) => {
          if (entry.event) {
            items.push({ type: 'event', id: `event-${entry.event.id}`, event: entry.event });
            return;
          }
          const msg = entry.message!;
          const msgDate = new Date(msg.created_at);
          const prevDate: Date | null = prevMsg ? new Date(prevMsg.created_at) : null;
          const timeGap = prevDate ? msgDate.getTime() - prevDate.getTime() : Infinity;
          const showTime = !prevDate || timeGap > 300000; // 5 minutes

          items.push({
            type: 'message',
            id: msg.id,
            message: msg,
            showTime,
            prevMessage: prevMsg
          });
          prevMsg = msg;
        });
    });

    return items;
  }, [visibleMessages, searchTerm, ownershipEvents, hasMoreMessages]);

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
      const kind = getFileType(file);
      const maxMb = kind === 'image' ? 5 : kind === 'document' ? 25 : 16;
      if (file.size > maxMb * 1024 * 1024) {
        setToast({ message: `WhatsApp allows ${kind === 'document' ? 'files' : `${kind}s`} up to ${maxMb} MB`, type: 'error' });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setSelectedFile(file);
      setShowAttachmentMenu(false);
    }
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setMessageText((t) => t + snippet);
      return;
    }
    const start = el.selectionStart ?? messageText.length;
    const end = el.selectionEnd ?? messageText.length;
    const next = messageText.slice(0, start) + snippet + messageText.slice(end);
    setMessageText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + snippet.length;
    });
  };

  const pickQuickReply = useCallback(
    (reply: QuickReply) => {
      setMessageText(
        fillQuickReply(reply.message, {
          name: conversation?.customer_name,
          phone: conversation?.customer_phone || conversation?.from_number,
          agent: currentUserName,
        }),
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [conversation?.customer_name, conversation?.customer_phone, conversation?.from_number, currentUserName],
  );

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if ((!messageText.trim() && !selectedFile) || sending || !conversation || windowClosed) return;

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
      const errorMessage = error?.message || error?.error || 'Failed to send message';
      // A failed bubble with Retry stays in the thread, so the draft is no longer needed.
      if (error?.kept) {
        setMessageText('');
        setSelectedFile(null);
      }
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showQuickReplies && quickReplyRef.current?.handleKey(e)) {
      e.preventDefault();
      return;
    }
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
      <div className="bg-[#008069] px-2 py-3 sm:px-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="lg:hidden -ml-1 p-2 text-white hover:bg-white/10 rounded-full"
                aria-label="Back to chats"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
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
            <button
              type="button"
              onClick={onShowContact}
              disabled={!onShowContact}
              className="flex-1 min-w-0 text-left disabled:cursor-default"
            >
              <h3 className={clsx(waChat.headerTitle, 'truncate')}>{displayName}</h3>
              {!conversation.is_group && (conversation.customer_phone || conversation.customer_name) && (
                <p className={clsx(waChat.headerSub, 'truncate')}>
                  {conversation.customer_phone ? formatPhoneNumber(conversation.customer_phone) : formatPhoneNumber(conversation.conversation_id || conversation.from_number)}
                </p>
              )}
            </button>
          </div>

          {/* Actions - WhatsApp style icons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
              aria-label="Search in this chat"
              title="Search in this chat"
            >
              <Search className="w-5 h-5" />
            </button>
            {onShowContact && (
              <button
                type="button"
                onClick={onShowContact}
                className="lg:hidden p-2 text-white hover:bg-white/10 rounded-full transition-colors"
                aria-label="Contact details"
              >
                <Info className="w-5 h-5" />
              </button>
            )}
            <div className="relative" ref={moreMenuRef}>
              <button 
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[200px]">
                  {!conversation.is_group && (
                    <button
                      onClick={() => {
                        setShowMoreMenu(false);
                        void setConversationBot(botPaused ? 'resume' : 'pause');
                      }}
                      disabled={botBusy}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      {botPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      {botPaused ? 'Resume AI for this chat' : 'Pause AI for this chat'}
                    </button>
                  )}
                  {conversation?.id && (
                    <div className="px-4 py-2 border-t border-gray-100">
                      <ExportButton
                        businessId={businessId}
                        conversationId={conversation.id}
                        disabled={loading}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {searchOpen && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
          <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false);
                setSearchTerm('');
              }
            }}
            placeholder="Search loaded messages"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
          />
          {searchTerm.trim() && (
            <span className="flex-shrink-0 text-xs text-gray-500">
              {visibleMessages.length} {visibleMessages.length === 1 ? 'match' : 'matches'}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchTerm('');
            }}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {botPaused && !conversation.is_group && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <Bot className="h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            AI paused
            {conversation.bot_paused_reason && BOT_PAUSE_REASON[conversation.bot_paused_reason]
              ? ` because ${BOT_PAUSE_REASON[conversation.bot_paused_reason]}`
              : ''}
            {pausedUntil ? ` · until ${format(pausedUntil, isToday(pausedUntil) ? 'h:mm a' : 'd MMM, h:mm a')}` : ''}
          </span>
          <button
            type="button"
            onClick={() => void setConversationBot('resume')}
            disabled={botBusy}
            className="flex-shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-100 disabled:opacity-60"
          >
            {botBusy ? 'Resuming…' : 'Resume AI'}
          </button>
        </div>
      )}

      {ownership && !ownership.is_group && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 text-sm">
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              ownership.inbox_state === 'requesting' && 'bg-amber-100 text-amber-800',
              ownership.inbox_state === 'intervened' && 'bg-blue-100 text-blue-800',
              ownership.inbox_state === 'active' && 'bg-gray-100 text-gray-700',
            )}
          >
            {INBOX_STATE_LABEL[ownership.inbox_state]}
          </span>
          <span className="min-w-0 flex-1 truncate text-gray-700">
            {ownership.inbox_state === 'intervened'
              ? ownership.assigned_to === currentUserId
                ? "You're handling this chat"
                : `${ownership.owner_name || 'A team member'} is handling this chat`
              : ownership.inbox_state === 'requesting'
                ? 'The customer is waiting for a person'
                : 'The bot is handling this chat'}
          </span>
          {ownership.can_take_over && (
            <button
              type="button"
              onClick={() => void runOwnershipAction('take_over')}
              disabled={!!ownershipBusy}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <UserCheck className="h-3.5 w-3.5" />
              {ownershipBusy === 'take_over' ? 'Taking over…' : 'Take over'}
            </button>
          )}
          {ownership.can_transfer && (
            <div className="relative" ref={transferRef}>
              <button
                type="button"
                onClick={() => setShowTransfer((v) => !v)}
                disabled={!!ownershipBusy}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {ownershipBusy === 'transfer' ? 'Transferring…' : 'Transfer'}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showTransfer && (
                <div className="absolute right-0 top-full z-50 mt-1 max-h-72 min-w-[220px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                  {teamMembers.filter((m) => m.can_receive !== false && m.id !== ownership.assigned_to).length === 0 ? (
                    <p className="px-4 py-2 text-xs text-gray-500">No other team members can receive chats.</p>
                  ) : (
                    teamMembers
                      .filter((m) => m.can_receive !== false && m.id !== ownership.assigned_to)
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => void runOwnershipAction('transfer', m.id)}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <span
                            className={clsx('h-2 w-2 flex-shrink-0 rounded-full', m.online ? 'bg-emerald-500' : 'bg-gray-300')}
                            title={m.online ? 'Online' : 'Offline'}
                          />
                          <span className="flex-1 truncate">{m.id === currentUserId ? `${m.name} (you)` : m.name}</span>
                          <span className="text-[10px] text-gray-400">{m.online ? 'Online' : 'Offline'}</span>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
          {ownership.can_resolve && (
            <button
              type="button"
              onClick={() => void runOwnershipAction('resolve')}
              disabled={!!ownershipBusy}
              className="inline-flex items-center gap-1 rounded-md bg-[#008069] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#006b57] disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {ownershipBusy === 'resolve' ? 'Resolving…' : 'Resolve'}
            </button>
          )}
        </div>
      )}

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
            <div className={clsx(waChat.datePill, 'text-gray-400 bg-gray-100')}>
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
        ) : searchTerm.trim() && visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">No loaded message contains “{searchTerm.trim()}”.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <p className="text-lg mb-2">No messages yet</p>
              <p className="text-sm">
                {isCloud ? 'Send an approved template to start the conversation' : 'Start the conversation by sending a message'}
              </p>
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
                      <span className={waChat.datePill}>
                        {item.dateLabel}
                      </span>
                    </div>
                  );
                }
                if (item.type === 'event' && item.event) {
                  return <SystemLine key={item.id} event={item.event} meId={currentUserId} />;
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
                      onRetry={onRetryMessage}
                      highlight={searchTerm}
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
                        <span className={waChat.datePill}>
                        {item.dateLabel}
                      </span>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'event' && item.event) {
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
                      <SystemLine event={item.event} meId={currentUserId} />
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
                        onRetry={onRetryMessage}
                        highlight={searchTerm}
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

      {ownership && !ownership.can_reply ? (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-3 bg-[#f0f2f5] px-4 py-3 text-sm text-gray-700">
          {ownership.can_intervene ? (
            <>
              <span>
                {ownership.inbox_state === 'requesting'
                  ? 'This customer is waiting. Intervene to take the chat and reply.'
                  : 'The bot is handling this chat. Intervene to take over and reply yourself.'}
              </span>
              <button
                type="button"
                onClick={() => void runOwnershipAction('intervene')}
                disabled={!!ownershipBusy}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#008069] px-4 py-2 text-sm font-medium text-white hover:bg-[#006b57] disabled:opacity-60"
              >
                {ownershipBusy === 'intervene' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
                Intervene
              </button>
            </>
          ) : (
            <span>
              {ownership.owner_name || 'Another team member'} is handling this chat.
              {ownership.can_take_over ? ' Use Take over above to reply yourself.' : ' Only they can reply.'}
            </span>
          )}
        </div>
      ) : windowClosed ? (
        <div className="flex flex-shrink-0 flex-col items-center gap-2 bg-[#f0f2f5] px-4 py-3 text-center text-sm text-gray-700 sm:flex-row sm:justify-center sm:text-left">
          <Clock className="hidden h-4 w-4 flex-shrink-0 text-amber-600 sm:block" />
          <span>
            {replyWindow?.last_incoming_at
              ? 'More than 24 hours have passed since the customer last wrote. WhatsApp only allows an approved template now.'
              : 'This customer has not written to you yet. Start the chat with an approved template.'}
          </span>
          {onSendTemplate && (
            <button
              type="button"
              onClick={() => setShowTemplates(true)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-[#008069] px-4 py-2 text-sm font-medium text-white hover:bg-[#006b57]"
            >
              <FileText className="h-4 w-4" />
              Send template
            </button>
          )}
        </div>
      ) : (
      /* Composer - WhatsApp style */
      <div className="bg-[#f0f2f5] px-2 py-2 sm:px-4 flex-shrink-0">
        {windowLeft && (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-gray-500" title="WhatsApp allows free-form replies for 24 hours after the customer's last message">
            <Clock className="h-3.5 w-3.5" />
            Reply window closes in {windowLeft}
          </div>
        )}
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
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = 'image/jpeg,image/png,video/mp4,video/3gpp';
                      fileInputRef.current.click();
                    }
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
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.amr';
                      fileInputRef.current.click();
                    }
                    setShowAttachmentMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-[#8696a0]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>
                  </svg>
                  <span className="text-sm">Audio</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
                      fileInputRef.current.click();
                    }
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
          <div className="relative flex-1 bg-white rounded-3xl px-4 py-2 border border-gray-200 flex items-center min-w-0">
            {showQuickReplies && (
              <QuickReplyPicker
                ref={quickReplyRef}
                businessId={businessId}
                query={quickReplyQuery ?? ''}
                onPick={pickQuickReply}
                onManage={() => setShowSavedReplies(true)}
                onClose={() => setQuickReplyDismissed(true)}
              />
            )}
            <Textarea
              ref={textareaRef}
              value={messageText}
              onChange={(e) => {
                setMessageText(e.target.value);
                if (!e.target.value.startsWith('/')) setQuickReplyDismissed(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a message, or / for quick replies"
              rows={1}
              className="flex-1 resize-none min-h-[40px] max-h-[200px] border-0 focus:ring-0 focus:outline-none p-0 wa-composer-input"
            />
            <button
              type="button"
              onClick={() => setShowSavedReplies(true)}
              title="Quick replies"
              aria-label="Quick replies"
              className="p-1 text-[#54656f] hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 ml-1"
            >
              <BookOpen className="w-5 h-5" />
            </button>
            {isCloud && onSendTemplate && (
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                title="Send a template"
                aria-label="Send a template"
                className="p-1 text-[#54656f] hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 ml-1"
              >
                <FileText className="w-5 h-5" />
              </button>
            )}
            <div className="relative hidden sm:block" ref={emojiRef}>
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                title="Emoji"
                aria-label="Emoji"
                className="p-1 text-[#54656f] hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 ml-1"
              >
                <Smile className="w-5 h-5" />
              </button>
              {showEmoji && <EmojiPicker onPick={(e) => insertAtCursor(e)} />}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || (!messageText.trim() && !selectedFile)}
            aria-label="Send"
            className="p-2 bg-[#008069] text-white rounded-full hover:bg-[#006b57] transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
      )}
        </>
      )}
      </div>

      {showSavedReplies && (
        <SavedRepliesModal
          businessId={businessId}
          manageMode
          onSelect={(msg) => {
            pickQuickReply({ id: '', title: '', shortcut: null, message: msg });
            setShowSavedReplies(false);
          }}
          onClose={() => setShowSavedReplies(false)}
        />
      )}

      {showTemplates && onSendTemplate && (
        <TemplatePickerModal
          contactName={conversation?.customer_name}
          onSend={onSendTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </>
  );
}
