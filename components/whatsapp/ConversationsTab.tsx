'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationList, Conversation as ConversationType, FilterState } from './conversations/ConversationList';
import { ChatWindow, Conversation, Message } from './conversations/ChatWindow';
import { ContactPanel } from './conversations/ContactPanel';
import { TimelineEvent } from './conversations/AutomationTimeline';
import { SummaryBar } from './conversations/SummaryBar';
import { useWhatsAppSocket, WSEvent } from '@/hooks/useWhatsAppSocket';
import { getDisplayText } from './conversations/messageUtils';
import {
  compareMessagesChronological,
  mergeMessageLists,
  mergeMessageRow
} from './conversations/chatMessageMerge';

interface ConversationsTabProps {
  initialPhoneNumber?: string;
}

const INITIAL_LIMIT = 30;
const LOAD_MORE_LIMIT = 30;
/** DB-backed message page (cursor pagination; default 50 server-side) */
const DB_MSG_PAGE = 50;
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

// Helper functions for localStorage caching
function getConversationsCache(businessId: string): { conversations: ConversationType[], timestamp: number } | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const cacheKey = `whatsapp_convs_${businessId}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const parsed = JSON.parse(cached);
    if (!parsed || !parsed.conversations || !parsed.timestamp) return null;
    
    const age = Date.now() - parsed.timestamp;
    if (age > CACHE_MAX_AGE) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    return {
      conversations: parsed.conversations,
      timestamp: parsed.timestamp
    };
  } catch (error) {
    console.error('Error reading conversations cache:', error);
    return null;
  }
}

function setConversationsCache(businessId: string, convs: ConversationType[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    const cacheKey = `whatsapp_convs_${businessId}`;
    const cacheData = {
      conversations: convs,
      timestamp: Date.now()
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error saving conversations cache:', error);
  }
}

export function ConversationsTab({ initialPhoneNumber }: ConversationsTabProps) {
  const { business, user } = useAuth();
  const [conversations, setConversations] = useState<ConversationType[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  /** Refetch from DB if SSE is still down after WA reconnect (fallback only) */
  const wsConnectedForFallbackRef = useRef(false);
  const selectedConvIdSseRef = useRef<string | null>(null);
  const prevWhatsappForSseResubRef = useRef<boolean | null>(null);
  const SSE_CATCHUP_MSG_LIMIT = 20;
  // Keep a ref for SSE catch-up (avoids stale closure in onSseOpen)
  useEffect(() => {
    selectedConvIdSseRef.current = selectedConversationId;
  }, [selectedConversationId]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contact, setContact] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [leadProfile, setLeadProfile] = useState<any>(null);
  const [filters, setFilters] = useState<FilterState>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingContact, setLoadingContact] = useState(false);
  const [activeSummaryFilter, setActiveSummaryFilter] = useState<'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null>(null);
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  /** For detecting false → true API status=connected (post-reconnect / settings connect) */
  const prevWhatsappStatusConnectedRef = useRef<boolean | null>(null);

  // Pagination state
  const [conversationsOffset, setConversationsOffset] = useState(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  
  // Use ref to always get latest filters (avoid closure issues)
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  
  // AbortController for cancelling deferred fetches
  const deferredFetchesAbortControllerRef = useRef<AbortController | null>(null);
  const fetchConversationsRef = useRef<
    ((silent?: boolean, append?: boolean, offset?: number) => Promise<void>) | null
  >(null);
  const listRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Oldest loaded message (chronologically first in thread) — cursor for loading older */
  const oldestMessageCursorRef = useRef<{ created_at: string; message_id: string } | null>(null);

  // Fetch conversations with pagination
  const fetchConversations = useCallback(async (silent = false, append = false, offset = 0) => {
    if (!business?.id) return;

    if (!silent) {
      if (append) {
        setIsLoadingMore(true);
        isLoadingMoreRef.current = true;
      } else {
        setLoading(true);
        setConversationsOffset(0);
        setHasMoreConversations(true);
      }
    }

    try {
      const limit = append ? LOAD_MORE_LIMIT : INITIAL_LIMIT;
      const currentFilters = filtersRef.current;
      const params = new URLSearchParams({
        business_id: business.id,
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      // Add filters if they exist (explicitly check for truthy values)
      // Use currentFilters from ref to ensure we have the latest value
      if (currentFilters.status) params.set('status', currentFilters.status);
      if (currentFilters.assigned_to) params.set('assigned_to', currentFilters.assigned_to);
      if (currentFilters.lead_status) {
        params.set('lead_status', currentFilters.lead_status);
      }
      if (currentFilters.conversation_status) params.set('conversation_status', currentFilters.conversation_status);
      if (currentFilters.label_id) params.set('label_id', currentFilters.label_id);
      if (activeSummaryFilter === 'unread') params.set('unread_only', 'true');
      if (activeSummaryFilter === 'new') params.set('new_only', 'true');

      params.set('skip_profile_pictures', 'true');

      const res = await fetch(`/api/whatsapp/conversations?${params}`);
      if (res.ok) {
        const data = await res.json();
        const raw = data.conversations || [];
        const moreFromServer = raw.length === limit;
        let fetched = raw;
        
        // Apply client-side filters: search query and summary filters
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          fetched = fetched.filter((conv: ConversationType) => {
            const name = (conv.customer_name || (conv as any).whatsapp_display_name || conv.conversation_id || conv.from_number || '').toLowerCase();
            const phone = (conv.customer_phone || conv.from_number || '').toLowerCase();
            return name.includes(query) || phone.includes(query);
          });
        }

        if (activeSummaryFilter === 'unread') {
          fetched = fetched.filter((conv: ConversationType) => (conv.unread_count || 0) > 0);
        } else if (activeSummaryFilter === 'new') {
          fetched = fetched.filter((conv: ConversationType) => conv.last_message_direction === 'incoming');
        }
        
        // Sort to preserve pinned conversations at top
        const sorted = fetched.sort((a: ConversationType, b: ConversationType) => {
          if (a.is_pinned && !b.is_pinned) return -1;
          if (!a.is_pinned && b.is_pinned) return 1;
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return bTime - aTime;
        });
        
        if (append) {
          setConversations(prev => {
            const existingIds = new Set(prev.map(c => c.id));
            const newConvs = sorted.filter((c: ConversationType) => !existingIds.has(c.id));
            return [...prev, ...newConvs];
          });
          setHasMoreConversations(moreFromServer);
          setConversationsOffset(prev => prev + raw.length);
        } else {
          setConversations(sorted);
          setHasMoreConversations(moreFromServer);
          setConversationsOffset(raw.length);
          
          // Save to cache after successful fetch (only when no filters active to keep cache clean)
          if (business?.id && !append) {
            const hasActiveFilters = Object.keys(currentFilters).length > 0 || searchQuery.trim() || activeSummaryFilter !== null;
            if (!hasActiveFilters) {
              setConversationsCache(business.id, sorted);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      if (!silent) {
        if (append) {
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        } else {
          setLoading(false);
        }
      }
    }
  }, [business?.id, filters, searchQuery, activeSummaryFilter]);

  useEffect(() => {
    fetchConversationsRef.current = fetchConversations;
  }, [fetchConversations]);

  // Load more conversations (infinite scroll)
  const loadMoreConversations = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMoreConversations) return;
    fetchConversations(true, true, conversationsOffset);
  }, [fetchConversations, conversationsOffset, hasMoreConversations]);

  // Handle scroll for infinite loading
  const handleConversationListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    
    // Load more when within 200px of bottom
    if (scrollBottom < 200 && hasMoreConversations && !isLoadingMoreRef.current) {
      loadMoreConversations();
    }
  }, [loadMoreConversations, hasMoreConversations]);

  // Fetch messages from DB (source of truth); SSE appends/updates in real time
  const fetchMessages = useCallback(async (conversationId: string, silent = false, retryAttempt = 0): Promise<void> => {
    if (!business?.id) return;

    if (!silent) {
      setLoadingMessages(true);
      setMessageError(null);
    }

    let leaveLoadingSpinner = false;
    const sp = new URLSearchParams({
      business_id: business.id,
      limit: String(DB_MSG_PAGE)
    });
    const endpoint = `/api/whatsapp/conversations/${encodeURIComponent(
      conversationId
    )}/messages?${sp}`;

    try {
      const res = await fetch(endpoint);

      if (res.ok) {
        const data = await res.json();
        const fetchedMessages = (data.messages || []) as Message[];
        setMessages(fetchedMessages);
        const oc = data.oldest_cursor as { created_at?: string; message_id?: string } | undefined;
        oldestMessageCursorRef.current =
          oc?.created_at && oc?.message_id
            ? { created_at: String(oc.created_at), message_id: String(oc.message_id) }
            : null;
        if (data.has_more !== undefined) {
          setHasMoreMessages(!!data.has_more);
        } else {
          setHasMoreMessages(fetchedMessages.length >= DB_MSG_PAGE);
        }
        setMessageError(null);
        setRetryCount(0);
      } else {
        let errorData: { error?: string } = {};
        const errorText = await res.text();
        try {
          errorData = errorText ? JSON.parse(errorText) : {};
        } catch {
          errorData = { error: errorText || `HTTP ${res.status}` };
        }
        const errorMessage = errorData.error || `HTTP ${res.status}`;

        if ((res.status === 503 || res.status >= 500) && retryAttempt < 2) {
          leaveLoadingSpinner = true;
          const delay = Math.pow(2, retryAttempt) * 500;
          retryTimeoutRef.current = setTimeout(() => {
            fetchMessages(conversationId, silent, retryAttempt + 1);
          }, delay);
          setRetryCount(retryAttempt + 1);
          setMessageError(`Server error. Retrying... (${retryAttempt + 1}/2)`);
          return;
        }
        setMessageError(errorMessage);
        setRetryCount(0);
      }
    } catch (error) {
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch');
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isNetworkError && retryAttempt < 2) {
        leaveLoadingSpinner = true;
        const delay = Math.pow(2, retryAttempt) * 500;
        retryTimeoutRef.current = setTimeout(() => {
          fetchMessages(conversationId, silent, retryAttempt + 1);
        }, delay);
        setRetryCount(retryAttempt + 1);
        setMessageError(`Network error. Retrying... (${retryAttempt + 1}/2)`);
        return;
      }
      setMessageError(isNetworkError ? 'Network error. Please check your connection.' : errorMessage);
      setRetryCount(0);
    } finally {
      if (!silent && !leaveLoadingSpinner) {
        setLoadingMessages(false);
      }
    }
  }, [business?.id]);

  /** After SSE (re)connect: pull last N from DB and merge (missed events safety). */
  const fetchRecentMessagesMerge = useCallback(async (): Promise<void> => {
    const conversationId = selectedConvIdSseRef.current;
    if (!business?.id || !conversationId) return;

    const sp = new URLSearchParams({
      business_id: business.id,
      limit: String(SSE_CATCHUP_MSG_LIMIT)
    });
    const endpoint = `/api/whatsapp/conversations/${encodeURIComponent(
      conversationId
    )}/messages?${sp}`;

    try {
      const res = await fetch(endpoint);
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.messages || []) as Message[];
      if (list.length === 0) return;

      setMessages((prev) => {
        const wasEmpty = prev.length === 0;
        const merged = mergeMessageLists(prev, list);
        console.log('[SSE-UI] message merge (catch-up)', {
          openThread: conversationId,
          fetched: list.length,
          prevCount: prev.length,
          mergedCount: merged.length
        });
        if (wasEmpty) {
          const oc = data.oldest_cursor as { created_at?: string; message_id?: string } | undefined;
          queueMicrotask(() => {
            oldestMessageCursorRef.current =
              oc?.created_at && oc?.message_id
                ? { created_at: String(oc.created_at), message_id: String(oc.message_id) }
                : null;
            if (data.has_more !== undefined) {
              setHasMoreMessages(!!data.has_more);
            } else {
              setHasMoreMessages(list.length >= SSE_CATCHUP_MSG_LIMIT);
            }
          });
        }
        return merged;
      });
    } catch (e) {
      console.warn('[SSE-UI] message merge (catch-up) failed', e);
    }
  }, [business?.id]);

  const onSseOpen = useCallback(() => {
    void fetchRecentMessagesMerge();
    void fetchConversationsRef.current?.(true, false, 0);
  }, [fetchRecentMessagesMerge]);

  // Prepend older pages (cursor: before created_at + message_id)
  const fetchOlderMessages = useCallback(async (conversationId: string): Promise<void> => {
    if (!business?.id || !hasMoreMessages || loadingOlderMessages) {
      return;
    }
    const cursor = oldestMessageCursorRef.current;
    if (!cursor?.created_at || !cursor.message_id) {
      return;
    }

    setLoadingOlderMessages(true);

    try {
      const sp = new URLSearchParams({
        business_id: business.id,
        limit: String(DB_MSG_PAGE),
        before_created_at: cursor.created_at,
        before_message_id: cursor.message_id
      });
      const endpoint = `/api/whatsapp/conversations/${encodeURIComponent(
        conversationId
      )}/messages?${sp}`;

      const res = await fetch(endpoint);

      if (res.ok) {
        const data = await res.json();
        const olderMessages = (data.messages || []) as Message[];
        const hasMore = data.has_more !== undefined ? data.has_more : false;

        setHasMoreMessages(hasMore);

        if (olderMessages.length > 0) {
          setMessages((prev) => {
            const merged = mergeMessageLists(olderMessages, prev);
            const first = merged[0];
            const mid = (first as { message_id?: string })?.message_id;
            if (first?.created_at && mid) {
              oldestMessageCursorRef.current = {
                created_at: first.created_at,
                message_id: mid
              };
            }
            return merged;
          });
        }
      } else {
        const errorText = await res.text();
        console.error('[fetchOlderMessages] failed', { status: res.status, error: errorText });
      }
    } catch (error) {
      console.error('[fetchOlderMessages] error', error);
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [business?.id, hasMoreMessages, loadingOlderMessages]);

  // Fetch contact info
  const fetchContact = useCallback(async (phone: string, conversationId: string, signal?: AbortSignal) => {
    if (!business?.id) {
      console.warn('[ConversationsTab] Skipping fetchContact - missing business');
      return;
    }

    setLoadingContact(true);
    try {
      const encodedPhone = encodeURIComponent(phone);
      const res = await fetch(`/api/whatsapp/contacts/${encodedPhone}?business_id=${business.id}`, { signal });
      if (res.ok) {
        const data = await res.json();
        setContact(data.contact);
        
        // Also fetch lead profile using conversation_id (more reliable than phone lookup)
        const leadProfileUrl = `/api/whatsapp/lead-profiles?business_id=${business.id}&conversation_id=${conversationId}`;
        const leadRes = await fetch(leadProfileUrl, { signal });
        
        if (leadRes.ok) {
          const leadData = await leadRes.json();
          setLeadProfile(leadData.profile || null);
        } else {
          const errorText = await leadRes.text();
          console.warn('[ConversationsTab] Failed to fetch lead profile:', errorText);
          setLeadProfile(null);
        }
      } else {
        console.warn('[ConversationsTab] Contact fetch failed:', res.status);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[ConversationsTab] Error fetching contact:', error);
        setContact(null);
        setLeadProfile(null);
      }
    } finally {
      setLoadingContact(false);
    }
  }, [business?.id]);

  // Fetch notes
  const fetchNotes = useCallback(async (conversationId: string, signal?: AbortSignal) => {
    if (!business?.id) return;

    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/notes?business_id=${business.id}`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching notes:', error);
      }
    }
  }, [business?.id]);

  // Fetch timeline
  const fetchTimeline = useCallback(async (conversationId: string, signal?: AbortSignal) => {
    if (!business?.id) return;

    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/timeline?business_id=${business.id}`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        setTimeline(data.events || []);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching timeline:', error);
      }
    }
  }, [business?.id]);

  // Fetch custom fields
  const fetchCustomFields = useCallback(async (conversationId: string, signal?: AbortSignal) => {
    if (!business?.id) return;

    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/custom-fields?business_id=${business.id}`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        setCustomFields(data.fields || {});
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching custom fields:', error);
      }
    }
  }, [business?.id]);

  // Handle conversation selection with deferred non-critical data fetching
  const handleSelectConversation = useCallback((id: string) => {
    // Reset pagination offset when switching conversations
    oldestMessageCursorRef.current = null;
    setHasMoreMessages(true);
    
    // Cancel any pending deferred fetches
    if (deferredFetchesAbortControllerRef.current) {
      deferredFetchesAbortControllerRef.current.abort();
    }
    
    // Cancel any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Create new AbortController for this conversation
    const abortController = new AbortController();
    deferredFetchesAbortControllerRef.current = abortController;
    
    // Clear messages and error when switching conversations
    
    setMessages([]);
    setMessageError(null);
    setRetryCount(0);
    setHasMoreMessages(true); // Reset for new conversation
    setSelectedConversationId(id);
    const conv =
      conversations.find(c => c.id === id) ||
      (id.includes('@')
        ? conversations.find(
            c => c.conversation_id === id || (c as { group_jid?: string }).group_jid === id
          )
        : undefined);
    if (conv) {
      setSelectedConversation({
        id: conv.id,
        conversation_id: conv.conversation_id,
        from_number: conv.from_number,
        customer_name: conv.customer_name,
        customer_phone: conv.customer_phone,
        is_group: conv.is_group,
        group_name: conv.group_name,
        assigned_to: conv.assigned_to,
        conversation_status: conv.conversation_status,
        lead_status: conv.lead_status,
        profile_picture_url: conv.profile_picture_url,
      });

      // Fetch messages immediately
      fetchMessages(id);

      // Defer non-critical data fetching by 300ms
      const timeoutId = setTimeout(() => {
        // Only fetch if not aborted (removed selectedConversationId check - closure issue)
        if (!abortController.signal.aborted) {
          fetchNotes(id, abortController.signal);
          fetchTimeline(id, abortController.signal);
          fetchCustomFields(id, abortController.signal);

          // Fetch contact info
          if (conv.customer_phone || conv.from_number || conv.conversation_id) {
            fetchContact(conv.customer_phone || conv.from_number || conv.conversation_id, id, abortController.signal);
          }
        }
      }, 300);
      
      // Store timeout ID for cleanup
      (abortController as any)._timeoutId = timeoutId;
    } else {
      setMessageError('Select a chat from the list, or open it from search once it exists in the CRM.');
      setSelectedConversationId(null);
      setSelectedConversation(null);
    }
  }, [conversations, fetchMessages, fetchNotes, fetchTimeline, fetchCustomFields, fetchContact, selectedConversationId]);

  // Cleanup deferred fetches on unmount ONLY (not on selectedConversationId change)
  useEffect(() => {
    return () => {
      if (deferredFetchesAbortControllerRef.current) {
        const controller = deferredFetchesAbortControllerRef.current;
        if ((controller as any)._timeoutId) {
          clearTimeout((controller as any)._timeoutId);
        }
        controller.abort();
      }
    };
  }, []); // Empty deps - only run on unmount

  // Handle send message
  const handleSendMessage = useCallback(async (
    text: string,
    type: string = 'text',
    buttons?: any[],
    media?: File
  ) => {
    if (!selectedConversationId || !business?.id) return;

    // Prepare media URL if needed
    let mediaUrl: string | undefined;
    if (media) {
      const reader = new FileReader();
      mediaUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(media);
      });
    }

    // Create optimistic message
    const optimisticId = `optimistic_${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticMessage: Message = {
      id: optimisticId,
      message_text: text,
      message_type: type,
      media_url: mediaUrl,
      buttons: buttons,
      direction: 'outgoing',
      status: 'pending',
      created_at: now,
    };

    // Immediately add optimistic message to UI
    setMessages(prev => [...prev, optimisticMessage]);

    // Save original conversation state for potential rollback
    const originalConv = conversations.find(c => c.id === selectedConversationId);
    const originalLastMessageAt = originalConv?.last_message_at || '';
    const originalLastMessageText = originalConv?.last_message_text || '';
    const originalLastMessageDirection = originalConv?.last_message_direction || 'incoming';

    // Optimistically update conversation list
    setConversations(prev => {
      const index = prev.findIndex(c => c.id === selectedConversationId);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          last_message_text: getDisplayText({ message_text: text, message_type: type, media_url: mediaUrl }) || text,
          last_message_at: now,
          last_message_direction: 'outgoing' as const
        };
        // Move to top (but preserve pinned status)
        const [moved] = updated.splice(index, 1);
        if (moved.is_pinned) {
          const pinnedIndex = updated.findIndex(c => !c.is_pinned);
          if (pinnedIndex >= 0) {
            updated.splice(pinnedIndex, 0, moved);
          } else {
            updated.push(moved);
          }
        } else {
          updated.unshift(moved);
        }
        return updated;
      }
      return prev;
    });

    try {
      const endpoint = `/api/whatsapp/conversations/${selectedConversationId}/messages?business_id=${business.id}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_text: text,
          message_type: type,
          media_url: mediaUrl,
          buttons: buttons,
        })
      });

      if (res.ok) {
        const messageData = await res.json();
        if (messageData.message) {
          const m = messageData.message as Message;
          const realMessage: Message = {
            ...m,
            id: m.id || (messageData as { message_id?: string }).message_id || optimisticId,
            message_text: m.message_text || text,
            message_type: m.message_type || type,
            media_url: m.media_url || mediaUrl,
            direction: 'outgoing',
            status: m.status || 'sent',
            created_at: m.created_at || now,
            message_id: m.message_id || (messageData as { message_id?: string }).message_id
          };
          setMessages(prev => {
            const optimisticIndex = prev.findIndex(x => x.id === optimisticId);
            if (optimisticIndex >= 0) {
              const u = [...prev];
              u[optimisticIndex] = realMessage;
              return u;
            }
            return [...prev, realMessage];
          });
          setConversations(prev => {
            const index = prev.findIndex(c => c.id === selectedConversationId);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                last_message_text: getDisplayText(messageData.message) || text,
                last_message_at: m.created_at || now,
                last_message_direction: 'outgoing' as const
              };
              return updated.sort((a, b) => {
                if (a.is_pinned && !b.is_pinned) return -1;
                if (!a.is_pinned && b.is_pinned) return 1;
                const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                return bTime - aTime;
              });
            }
            return prev;
          });
        } else if ((messageData as { message_id?: string }).message_id) {
          setMessages(prev => {
            const mid = (messageData as { message_id: string }).message_id;
            return prev
              .map(m =>
                m.id === optimisticId
                  ? {
                      ...m,
                      id: mid,
                      message_id: mid,
                      status: 'sent' as const
                    }
                  : m
              );
          });
        }
      } else {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send message');
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      
      // Revert conversation list update
      if (originalConv) {
        setConversations(prev => {
          const index = prev.findIndex(c => c.id === selectedConversationId);
          if (index >= 0) {
            const updated = [...prev];
            // Restore original values
            updated[index] = {
              ...updated[index],
              last_message_text: originalLastMessageText,
              last_message_at: originalLastMessageAt,
              last_message_direction: originalLastMessageDirection as 'incoming' | 'outgoing'
            };
            // Re-sort to original position
            return updated.sort((a, b) => {
              if (a.is_pinned && !b.is_pinned) return -1;
              if (!a.is_pinned && b.is_pinned) return 1;
              const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bTime - aTime;
            });
          }
          return prev;
        });
      }
      
      throw error;
    }
  }, [selectedConversationId, business?.id, fetchMessages, conversations]);

  // Handle conversation update
  const handleUpdateConversation = useCallback(async (updates: {
    assigned_to?: string | null;
    lead_status?: string;
    conversation_status?: string;
  }) => {
    if (!selectedConversationId || !business?.id) return;

    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${selectedConversationId}?business_id=${business.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        }
      );

      if (res.ok) {
        if (selectedConversation) {
          setSelectedConversation({
            ...selectedConversation,
            ...updates
          });
        }
      }
    } catch (error) {
      console.error('Error updating conversation:', error);
    }
  }, [selectedConversationId, business?.id, selectedConversation]);

  // WebSocket connection for real-time updates
  const { connected: wsConnected, reconnect: reconnectSse } = useWhatsAppSocket({
    businessId: business?.id || null,
    enabled: !!business?.id,
    onSseOpen: onSseOpen,
    onMessage: (event: WSEvent) => {
      if (event.conversationId && event.message) {
        const incomingMid = (event.message as { message_id?: string })?.message_id;
        if (event.conversationId === selectedConversationId) {
          setMessages(prev => {
            const incoming = {
              ...event.message,
              id:
                (event.message as { id?: string })?.id ||
                (event.message as { message_id?: string })?.message_id ||
                `temp-${Date.now()}`
            } as Message;
            const next = mergeMessageLists(prev, [incoming]);
            console.log('[SSE-UI] message merged in state', {
              conversationId: event.conversationId,
              message_id: incomingMid,
              prevCount: prev.length,
              mergedCount: next.length
            });
            return next;
          });
        }
        
        setConversations(prev => {
          const existingIndex = prev.findIndex(conv => conv.id === event.conversationId);
          
          if (existingIndex >= 0) {
            const conv = prev[existingIndex];
            const isPinned = conv.is_pinned || false;
            
            // Update only necessary fields
            const msgAt = (event.message as any)?.created_at
              || (event.message as any)?.createdAt
              || new Date().toISOString();
            const updatedConv: ConversationType = {
              ...conv,
              last_message_text: getDisplayText(event.message || {}) || conv.last_message_text,
              last_message_at: msgAt,
              last_message_direction: (event.message?.direction === 'incoming' ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
              unread_count: event.conversationId === selectedConversationId 
                ? 0 
                : (conv.unread_count || 0) + (event.message?.direction === 'incoming' ? 1 : 0)
            };
            
            // If not pinned, move to front (preserve pinned conversations at top)
            if (!isPinned) {
              const updated = [...prev];
              updated[existingIndex] = updatedConv;
              
              // Find first non-pinned position (after all pinned)
              const firstNonPinnedIndex = updated.findIndex(c => !c.is_pinned);
              if (firstNonPinnedIndex >= 0 && firstNonPinnedIndex !== existingIndex) {
                // Move to first non-pinned position
                const [moved] = updated.splice(existingIndex, 1);
                updated.splice(firstNonPinnedIndex, 0, moved);
                return updated;
              } else if (firstNonPinnedIndex === -1) {
                // All are pinned, move to end
                const [moved] = updated.splice(existingIndex, 1);
                updated.push(moved);
                return updated;
              }
              // Already at first non-pinned position, no move needed
              return updated;
            }
            
            // If pinned, just update in place
            const updated = [...prev];
            updated[existingIndex] = updatedConv;
            return updated;
          }
          // New activity on a chat not in the current list (e.g. first page only) — reload from API
          if (listRefreshDebounceRef.current) {
            clearTimeout(listRefreshDebounceRef.current);
          }
          listRefreshDebounceRef.current = setTimeout(() => {
            fetchConversationsRef.current?.(true, false, 0);
          }, 500);
          return prev;
        });
      }
    },
    onConversationUpdate: (event: WSEvent) => {
      if (event.conversation) {
        setConversations(prev => {
          // In live mode the list is keyed by JID, but SSE events carry the DB UUID
          // as `id` and the JID as `conversation_id`. Match by EITHER so we patch the
          // existing live row and don't inject a duplicate UUID-keyed phantom row.
          const evConvIdRaw = (event.conversation as { conversation_id?: string }).conversation_id;
          const evId = event.conversation?.id;
          const matchKey = (c: ConversationType): boolean => {
            if (evId && c.id === evId) return true;
            if (evConvIdRaw && (c.id === evConvIdRaw || (c as { conversation_id?: string }).conversation_id === evConvIdRaw)) return true;
            return false;
          };
          const index = prev.findIndex(matchKey);
          if (index >= 0) {
            const conv = prev[index];
            const isPinned = conv.is_pinned || false;
            const oldLastMessageAt = conv.last_message_at;
            const newLastMessageAt = event.conversation.last_message_at;
            const lastMessageAtChanged = newLastMessageAt && newLastMessageAt !== oldLastMessageAt;
            
            // Patch fields only — but PRESERVE the existing row's `id` so we don't
            // accidentally rewrite a JID-keyed live row to a UUID-keyed one.
            const updatedConv: ConversationType = { 
              ...conv, 
              ...event.conversation,
              id: conv.id,
              last_message_direction: (event.conversation.last_message_direction || conv.last_message_direction) as 'incoming' | 'outgoing',
              unread_count: event.conversation.unread_count !== undefined 
                ? event.conversation.unread_count 
                : conv.unread_count
            };
            
            // Move to top only if: last_message_at changed AND not pinned AND not already at top
            if (lastMessageAtChanged && !isPinned && index > 0) {
              const updated = [...prev];
              updated[index] = updatedConv;
              
              // Find first non-pinned position (after all pinned)
              const firstNonPinnedIndex = updated.findIndex(c => !c.is_pinned);
              if (firstNonPinnedIndex >= 0 && firstNonPinnedIndex !== index) {
                // Move to first non-pinned position
                const [moved] = updated.splice(index, 1);
                updated.splice(firstNonPinnedIndex, 0, moved);
                return updated;
              } else if (firstNonPinnedIndex === -1) {
                // All are pinned, move to end
                const [moved] = updated.splice(index, 1);
                updated.push(moved);
                return updated;
              }
              // Already at first non-pinned position, no move needed
              return updated;
            }
            
            // If pinned or no change, just update in place
            const updated = [...prev];
            updated[index] = updatedConv;
            return updated;
          } else {
            const updated = [...prev];
            const firstNonPinnedIndex = updated.findIndex(c => !c.is_pinned);
            if (firstNonPinnedIndex >= 0) {
              updated.splice(firstNonPinnedIndex, 0, event.conversation as ConversationType);
            } else {
              updated.unshift(event.conversation as ConversationType);
            }
            return updated;
          }
        });

        if (selectedConversationId === event.conversation.id) {
          setSelectedConversation(prev => prev ? { ...prev, ...event.conversation } : null);
        }
      }
    },
    onSummaryUpdate: (_event: WSEvent) => {
    },
    onReactionUpdate: (event: WSEvent) => {
      if (!event.messageId) return;
      setMessages(prev => {
        const idx = prev.findIndex(
          msg =>
            (msg as { message_id?: string }).message_id === event.messageId || msg.id === event.messageId
        );
        if (idx < 0) return prev;
        const msg = prev[idx];
        type R = { reaction: string; sender_jid: string };
        const reactions: R[] = (msg as { reactions?: R[] }).reactions || [];
        let nextReactions: Array<{ reaction: string; sender_jid: string }>;
        if (event.reaction === '') {
          nextReactions = reactions.filter(r => r.sender_jid !== event.senderJid);
        } else {
          const existing = reactions.findIndex(r => r.sender_jid === event.senderJid);
          if (existing >= 0) {
            nextReactions = [...reactions];
            nextReactions[existing] = { reaction: event.reaction!, sender_jid: event.senderJid! };
          } else {
            nextReactions = [...reactions, { reaction: event.reaction!, sender_jid: event.senderJid! }];
          }
        }
        return mergeMessageLists(prev, [mergeMessageRow(msg, { reactions: nextReactions })]);
      });
    }
  });

  useEffect(() => {
    wsConnectedForFallbackRef.current = wsConnected;
  }, [wsConnected]);

  // When WA API reports connected, force SSE to reconnect (validate / re-subscribe to stream)
  useEffect(() => {
    const wasDisconnected = prevWhatsappForSseResubRef.current === false;
    if (whatsappConnected && wasDisconnected) {
      reconnectSse();
    }
    prevWhatsappForSseResubRef.current = whatsappConnected;
  }, [whatsappConnected, reconnectSse]);

  // Fetch conversations on mount and when filters/search change
  useEffect(() => {
    if (business?.id) {
      const hasActiveFilters =
        Object.keys(filters).length > 0 || searchQuery.trim() || activeSummaryFilter !== null;

      if (!hasActiveFilters) {
        const cached = getConversationsCache(business.id);
        if (cached && cached.conversations.length > 0) {
          setConversations(cached.conversations);
          fetchConversations(true, false, 0);
          return;
        }
      }

      fetchConversations();
    }
  }, [business?.id, filters, searchQuery, activeSummaryFilter, fetchConversations]);

  // Check WhatsApp connection status periodically
  useEffect(() => {
    if (!business?.id) return;

    const checkConnectionStatus = async () => {
      try {
        const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
        if (res.ok) {
          const status = await res.json();
          const isConnected = status.status === 'connected';
          setWhatsappConnected(isConnected);

          // After WA reconnect, primary path is SSE onopen + merge; only refetch if SSE still down (fallback)
          const wasOffline = prevWhatsappStatusConnectedRef.current === false;
          if (isConnected && wasOffline) {
            setTimeout(() => {
              if (!wsConnectedForFallbackRef.current) {
                console.log('[SSE-UI] fallback refetch (SSE not connected 3s after WA reconnect)');
                void fetchConversationsRef.current?.(true, false, 0);
                const cid = selectedConvIdSseRef.current;
                if (cid) {
                  void fetchMessages(cid, true, 0);
                }
              }
            }, 3000);
          }
          prevWhatsappStatusConnectedRef.current = isConnected;
          
          // If connection restored and we have a selected conversation with no messages, retry ONCE
          // Use a ref to prevent infinite retries
          if (isConnected && selectedConversationId && messages.length === 0 && !loadingMessages) {
            const lastRetryKey = `last_retry_${selectedConversationId}`;
            const lastRetry = typeof window !== 'undefined' ? sessionStorage.getItem(lastRetryKey) : null;
            const now = Date.now();
            
            // Only retry if we haven't retried in the last 60 seconds AND there's no persistent error
            const shouldRetry = !lastRetry || now - parseInt(lastRetry) > 60000;

            if (shouldRetry) {
              if (typeof window !== 'undefined') {
                sessionStorage.setItem(lastRetryKey, now.toString());
              }
              fetchMessages(selectedConversationId, false, 0);
            }
          }
        }
      } catch (error) {
        console.error('[ConversationsTab] Error checking connection status:', error);
        setWhatsappConnected(false);
      }
    };

    // Check immediately
    void checkConnectionStatus();

    // Then check every 10 seconds
    const interval = setInterval(() => {
      void checkConnectionStatus();
    }, 10000);

    // Returning from Settings / another tab: pick up "connected" and refetch without waiting for the 10s tick
    const onFocus = () => {
      void checkConnectionStatus();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [business?.id, selectedConversationId, messages.length, loadingMessages, fetchMessages]);

  // Fallback polling when SSE is down only (avoids refetching full chat while realtime works)
  useEffect(() => {
    if (business?.id && !wsConnected) {
      fallbackPollIntervalRef.current = setInterval(() => {
        fetchConversations(true);
        if (selectedConversationId) {
          fetchMessages(selectedConversationId, true);
        }
      }, 60000);

      return () => {
        if (fallbackPollIntervalRef.current) {
          clearInterval(fallbackPollIntervalRef.current);
        }
      };
    } else {
      if (fallbackPollIntervalRef.current) {
        clearInterval(fallbackPollIntervalRef.current);
        fallbackPollIntervalRef.current = null;
      }
    }
  }, [business?.id, wsConnected, selectedConversationId, fetchConversations, fetchMessages]);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (listRefreshDebounceRef.current) {
        clearTimeout(listRefreshDebounceRef.current);
        listRefreshDebounceRef.current = null;
      }
    };
  }, []);

  // Refresh notes when notes change callback
  const handleNoteAdded = useCallback(() => {
    if (selectedConversationId) {
      fetchNotes(selectedConversationId);
    }
  }, [selectedConversationId, fetchNotes]);

  const handleNoteDeleted = useCallback(() => {
    if (selectedConversationId) {
      fetchNotes(selectedConversationId);
    }
  }, [selectedConversationId, fetchNotes]);

  const handleRefreshMessages = useCallback(() => {
    if (selectedConversationId) {
      void fetchMessages(selectedConversationId, true, 0);
    }
  }, [selectedConversationId, fetchMessages]);

  if (!business?.id) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <p className="text-gray-600">Please select a business</p>
      </div>
    );
  }

  const handleSummaryFilterClick = useCallback((filter: 'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null, type?: 'status' | 'label' | 'lead_status') => {
    if (!filter) {
      // Clear all filters
      setActiveSummaryFilter(null);
      setFilters({});
      return;
    }

    // Handle different filter types - IMPORTANT: Check type FIRST
    if (type === 'lead_status') {
      // Lead status filter (AI-based: hot, warm, cold, not_interested)
      // Clear activeSummaryFilter (only used for unread/new), set lead_status filter
      setActiveSummaryFilter(null);
      // Set the filter - useEffect will trigger fetchConversations when filters changes
      const newFilters = { lead_status: filter };
      setFilters(newFilters);
    } else if (type === 'label') {
      // Label filter: clear other filters, set label_id
      setActiveSummaryFilter(null);
      setFilters({ label_id: filter });
    } else if (filter === 'unread' || filter === 'new') {
      // Status filters that use activeSummaryFilter (client-side filtering)
      setActiveSummaryFilter(filter);
      // Clear other filters
      setFilters({});
    } else if (filter === 'open' || filter === 'pending' || filter === 'closed') {
      // Conversation status filter (server-side)
      setActiveSummaryFilter(null);
      setFilters({ conversation_status: filter });
    } else {
      console.warn('[handleSummaryFilterClick] ⚠️ Unknown filter type:', { filter, type });
    }
  }, []);

  // Developer-only: Clear cache handler
  const handleClearCache = useCallback(() => {
    if (!business?.id) return;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`whatsapp_convs_${business.id}`);
      fetchConversations();
    }
  }, [business?.id, fetchConversations]);

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden" style={{ minHeight: 0 }}>
      {/* Summary Bar */}
      {business?.id && (
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
          <div className="flex-1">
            <SummaryBar
              businessId={business.id}
              activeFilter={filters.lead_status || filters.label_id || activeSummaryFilter || null}
              onFilterClick={handleSummaryFilterClick}
            />
          </div>
          <div className="flex items-center flex-wrap justify-end gap-3 ml-4 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5" title="Server-sent events for new messages and list updates">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  wsConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                }`}
              />
              {wsConnected ? 'Live updates' : 'Reconnecting…'}
            </span>
            {whatsappConnected ? (
              <span
                className="inline-flex items-center gap-1.5"
                title="WhatsApp client session (Baileys) on the server"
              >
                <span className="h-2 w-2 rounded-full shrink-0 bg-emerald-500" />
                WhatsApp online
              </span>
            ) : (
              <Link
                href="/settings/whatsapp"
                className="inline-flex items-center gap-1.5 link-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                title="WhatsApp is not connected. Open integration settings to scan the QR code and connect."
              >
                <span className="h-2 w-2 rounded-full shrink-0 bg-gray-400" />
                WhatsApp offline — connect
              </Link>
            )}
            {process.env.NODE_ENV === 'development' && (
              <button
                type="button"
                onClick={handleClearCache}
                className="text-xs text-primary-600 hover:underline"
              >
                Clear cache
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_380px] flex-1 gap-0 overflow-hidden" style={{ minHeight: 0 }}>
        {/* Left Panel: Conversation List */}
        <ConversationList
          conversations={conversations}
          selectedId={selectedConversationId}
          onSelect={handleSelectConversation}
          onSearch={setSearchQuery}
          filters={filters}
          onFilterChange={setFilters}
          loading={loading}
          isLoadingMore={isLoadingMore}
          onScroll={handleConversationListScroll}
          businessId={business.id}
          initialPhoneNumber={initialPhoneNumber}
        />

        {/* Center Panel: Chat Window */}
        <ChatWindow
          conversation={selectedConversation}
          messages={messages}
          onSendMessage={handleSendMessage}
          onUpdateConversation={handleUpdateConversation}
          loading={loadingMessages}
          businessId={business.id}
          error={messageError}
          onRetry={() => {
            if (selectedConversationId) {
              setMessageError(null);
              setRetryCount(0);
              fetchMessages(selectedConversationId, false, 0);
            }
          }}
          onLoadOlderMessages={() => {
            if (selectedConversationId) {
              fetchOlderMessages(selectedConversationId);
            }
          }}
          loadingOlderMessages={loadingOlderMessages}
          hasMoreMessages={hasMoreMessages}
          onRefreshMessages={handleRefreshMessages}
        />

        {/* Right Panel: Contact/CRM Panel */}
        {selectedConversationId ? (
          <ContactPanel
            conversationId={selectedConversationId}
            businessId={business.id}
            currentUserId={user?.id}
            contact={contact}
            notes={notes}
            timeline={timeline}
            customFields={customFields}
            assignedTo={selectedConversation?.assigned_to ?? undefined}
            leadStatus={selectedConversation?.lead_status}
            conversationStatus={selectedConversation?.conversation_status}
            onUpdate={handleUpdateConversation}
            onNoteAdded={handleNoteAdded}
            onNoteDeleted={handleNoteDeleted}
            loading={loadingContact}
            leadProfile={leadProfile}
          />
        ) : (
          <div className="flex items-center justify-center bg-white border-l border-gray-200">
            <div className="text-center text-gray-500 px-4">
              <p className="text-sm">Select a conversation to view contact details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
