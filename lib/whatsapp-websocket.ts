/**
 * WebSocket Server for WhatsApp CRM Real-time Updates
 * 
 * This module provides WebSocket-based real-time communication to replace polling.
 * Uses Socket.io for bidirectional communication with room-based broadcasting.
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { EventEmitter } from 'events';

// WebSocket event types
export type WSEvent =
  | { type: 'message:new'; businessId: string; conversationId: string; message: any }
  | { type: 'conversation:update'; businessId: string; conversation: any }
  | { type: 'summary:update'; businessId: string; summary: any }
  | { type: 'label:update'; businessId: string; conversationId: string; labels: any[] }
  | { type: 'agent:update'; businessId: string; conversationId: string; assignedTo: string | null };

// Global Socket.io server instance
const globalStore = globalThis as any;
let io: SocketIOServer | null = null;

/**
 * Initialize Socket.io server
 * Must be called with HTTP server instance (e.g., in Next.js custom server or API route)
 */
export function initWebSocketServer(httpServer?: HTTPServer): SocketIOServer {
  if (io) {
    return io;
  }

  if (!httpServer) {
    // In Next.js API routes, we can't easily create an HTTP server
    // Instead, we'll use a global event emitter pattern
    console.warn('[WS] HTTP server not provided, using event emitter fallback');
    return null as any;
  }

  io = new SocketIOServer(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    const businessId = socket.handshake.auth?.businessId;
    const userId = socket.handshake.auth?.userId;

    if (!businessId) {
      return next(new Error('businessId is required'));
    }

    // Store in socket data for later use
    socket.data.businessId = businessId;
    socket.data.userId = userId;

    next();
  });

  io.on('connection', (socket: Socket) => {
    const businessId = socket.data.businessId;
    const userId = socket.data.userId;

    console.log(`[WS] Client connected: businessId=${businessId}, userId=${userId}`);

    // Join business-specific room
    const roomName = `business:${businessId}`;
    socket.join(roomName);
    console.log(`[WS] Client joined room: ${roomName}`);

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: businessId=${businessId}`);
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  return io;
}

/**
 * Get Socket.io server instance
 */
export function getIOServer(): SocketIOServer | null {
  return io;
}

/**
 * Global event emitter for WebSocket events (works even without HTTP server)
 * This allows us to emit events from anywhere and broadcast via WebSocket if available
 * 
 * IMPORTANT: Set max listeners to prevent warnings (we may have many business rooms)
 */
if (!globalStore.__waWSEventEmitter) {
  const emitter = new EventEmitter();
  // Set max listeners to a high value to prevent warnings
  // In production with many concurrent connections, we might want to use a more sophisticated approach
  emitter.setMaxListeners(100);
  globalStore.__waWSEventEmitter = emitter;
}
export const wsEventEmitter = globalStore.__waWSEventEmitter as EventEmitter;

/**
 * Emit WebSocket event to business room
 * This is the main function to call when events occur
 * Works with both Socket.io (if available) and EventEmitter (for SSE)
 */
export function emitWSEvent(event: WSEvent) {
  const roomName = `business:${event.businessId}`;

  try {
    if (io) {
      io.to(roomName).emit('event', event);
    }
    wsEventEmitter.emit('event', event);
    wsEventEmitter.emit(`event:${roomName}`, event);
    wsEventEmitter.emit(`${event.type}:${event.businessId}`, event);
    console.log(`[WS] emitWSEvent ok: ${event.type} businessId=${event.businessId} (socketio=${!!io}, sse_fanout=1, realtime_delivery)`);
  } catch (err) {
    console.error(`[WS] emitWSEvent failure: ${event.type}`, { businessId: event.businessId, err });
  }
}

/**
 * Emit new message event (CRM / Baileys paths). SSE clients receive `message:new` without refetching the full thread.
 */
export function emitNewMessage(businessId: string, conversationId: string, message: any) {
  const messageId = message?.id || message?.message_id;
  try {
    emitWSEvent({
      type: 'message:new',
      businessId,
      conversationId,
      message
    });
    console.log('[WS] emitNewMessage success', {
      businessId,
      conversationId,
      messageId,
      realtime_delivery: true
    });
  } catch (err) {
    console.error('[WS] emitNewMessage failure', { businessId, conversationId, messageId, err });
  }
}

/**
 * Emit conversation update event
 */
export function emitConversationUpdate(businessId: string, conversation: any) {
  emitWSEvent({
    type: 'conversation:update',
    businessId,
    conversation
  });
}

/**
 * Emit summary update event (for unread counts, etc.)
 */
export function emitSummaryUpdate(businessId: string, summary: any) {
  emitWSEvent({
    type: 'summary:update',
    businessId,
    summary
  });
}

/**
 * Emit label update event
 */
export function emitLabelUpdate(businessId: string, conversationId: string, labels: any[]) {
  emitWSEvent({
    type: 'label:update',
    businessId,
    conversationId,
    labels
  });
}

/**
 * Emit agent assignment update event
 */
export function emitAgentUpdate(businessId: string, conversationId: string, assignedTo: string | null) {
  emitWSEvent({
    type: 'agent:update',
    businessId,
    conversationId,
    assignedTo
  });
}

