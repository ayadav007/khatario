/**
 * React Hook for WhatsApp WebSocket/SSE Connection
 * 
 * Provides real-time event subscription for WhatsApp CRM updates.
 * Uses Server-Sent Events (SSE) which works natively with Next.js App Router.
 * 
 * IMPORTANT: This hook creates ONE connection and maintains it until unmount.
 * It does NOT reconnect on every render or state change.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type WSEventType = 'message:new' | 'conversation:update' | 'summary:update' | 'label:update' | 'agent:update' | 'reaction_update';

export interface WSEvent {
  type: WSEventType;
  businessId: string;
  conversationId?: string;
  message?: any;
  conversation?: any;
  summary?: any;
  labels?: any[];
  assignedTo?: string | null;
  // reaction_update fields
  messageId?: string;
  senderJid?: string;
  reaction?: string;
}

interface UseWhatsAppSocketOptions {
  businessId: string | null;
  enabled?: boolean;
  /** Fires every time the EventSource opens (including after manual reconnect) — use to merge catch-up from DB. */
  onSseOpen?: () => void;
  onMessage?: (event: WSEvent) => void;
  onConversationUpdate?: (event: WSEvent) => void;
  onSummaryUpdate?: (event: WSEvent) => void;
  onLabelUpdate?: (event: WSEvent) => void;
  onAgentUpdate?: (event: WSEvent) => void;
  onReactionUpdate?: (event: WSEvent) => void;
}

interface UseWhatsAppSocketReturn {
  connected: boolean;
  reconnect: () => void;
  disconnect: () => void;
}

/**
 * Hook for connecting to WhatsApp real-time events via SSE
 * 
 * CRITICAL: Only creates ONE connection. Reuses it until unmount.
 */
export function useWhatsAppSocket(options: UseWhatsAppSocketOptions): UseWhatsAppSocketReturn {
  const {
    businessId,
    enabled = true,
    onSseOpen,
    onMessage,
    onConversationUpdate,
    onSummaryUpdate,
    onLabelUpdate,
    onAgentUpdate,
    onReactionUpdate
  } = options;

  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const handlersRef = useRef(options);
  const onSseOpenRef = useRef(onSseOpen);
  onSseOpenRef.current = onSseOpen;
  
  // Update handlers ref when they change (without recreating connection)
  useEffect(() => {
    handlersRef.current = {
      businessId: options.businessId,
      onSseOpen,
      onMessage,
      onConversationUpdate,
      onSummaryUpdate,
      onLabelUpdate,
      onAgentUpdate,
      onReactionUpdate
    };
  }, [options.businessId, onSseOpen, onMessage, onConversationUpdate, onSummaryUpdate, onLabelUpdate, onAgentUpdate, onReactionUpdate]);

  const handleEvent = useCallback((event: WSEvent) => {
    const handlers = handlersRef.current;
    console.log('[SSE] event received', { type: event.type, businessId: event.businessId, conversationId: event.conversationId || (event as WSEvent).messageId });
    
    // Route events to appropriate handlers
    switch (event.type) {
      case 'message:new':
        handlers.onMessage?.(event);
        break;
      case 'conversation:update':
        handlers.onConversationUpdate?.(event);
        break;
      case 'summary:update':
        handlers.onSummaryUpdate?.(event);
        break;
      case 'label:update':
        handlers.onLabelUpdate?.(event);
        break;
      case 'agent:update':
        handlers.onAgentUpdate?.(event);
        break;
      case 'reaction_update':
        handlers.onReactionUpdate?.(event);
        break;
    }
  }, []);

  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000; // 3 seconds

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connections
    if (isConnectingRef.current || eventSourceRef.current) {
      return;
    }

    if (!businessId || !enabled) {
      return;
    }

    isConnectingRef.current = true;

    try {
      const url = `/api/whatsapp/conversations/stream?business_id=${encodeURIComponent(businessId)}`;
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        console.log('[SSE] connected', { businessId, url, readyState: eventSource.readyState });
        setConnected(true);
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;
        try {
          onSseOpenRef.current?.();
        } catch (e) {
          console.error('[SSE] onSseOpen callback error', e);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('[SSE] event source error', {
          error,
          readyState: eventSource.readyState,
          businessId
        });
        
        // EventSource will automatically try to reconnect
        // Only mark as disconnected if it's actually closed
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('[SSE] disconnected (EventSource closed)', { businessId });
          setConnected(false);
          isConnectingRef.current = false;

          // Only attempt manual reconnect if auto-reconnect failed
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log(`[SSE] manual reconnect attempt ${reconnectAttemptsRef.current}`, { businessId });
              if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              connect();
            }, reconnectDelay);
          } else {
            console.error('[SSE] max reconnect attempts reached', { businessId });
          }
        }
      };

      // Listen for structured events
      eventSource.addEventListener('message:new', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[SSE] parse error message:new', err, e.data);
        }
      });

      eventSource.addEventListener('conversation:update', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[WS Hook] Error parsing conversation:update event:', err);
        }
      });

      eventSource.addEventListener('summary:update', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[WS Hook] Error parsing summary:update event:', err);
        }
      });

      eventSource.addEventListener('label:update', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[WS Hook] Error parsing label:update event:', err);
        }
      });

      eventSource.addEventListener('agent:update', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[WS Hook] Error parsing agent:update event:', err);
        }
      });

      eventSource.addEventListener('reaction_update', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as WSEvent;
          handleEvent(event);
        } catch (err) {
          console.error('[SSE] parse error reaction_update', err, e.data);
        }
      });

      eventSourceRef.current = eventSource;
    } catch (error) {
      console.error('[WS Hook] Error creating EventSource:', error);
      setConnected(false);
      isConnectingRef.current = false;
    }
  }, [businessId, enabled, handleEvent]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      try {
        console.log('[SSE] disconnect() called (closing EventSource)', { hadSource: true });
        eventSourceRef.current.close();
      } catch (err) {
        // Ignore errors during close
      }
      eventSourceRef.current = null;
    }

    setConnected(false);
    isConnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    // Small delay before reconnecting to ensure cleanup
    setTimeout(() => {
      connect();
    }, 100);
  }, [disconnect, connect]);

  // Main effect: Connect once when enabled and businessId is available
  useEffect(() => {
    if (enabled && businessId) {
      connect();
    }

    // Cleanup: Disconnect on unmount or when dependencies change
    return () => {
      disconnect();
    };
  }, [enabled, businessId]); // Only recreate connection if businessId changes

  return {
    connected,
    reconnect,
    disconnect
  };
}
