import { EventEmitter } from 'events';

/**
 * Global event emitter for WhatsApp conversation updates
 * This allows us to emit events when messages are received and broadcast to all connected SSE clients
 */
const globalStore = globalThis as any;
if (!globalStore.__waEventEmitter) {
  globalStore.__waEventEmitter = new EventEmitter();
}
export const waEventEmitter = globalStore.__waEventEmitter as EventEmitter;

/**
 * Emit conversation update event
 * Call this from lib/whatsapp-crm.ts when a new message is stored
 */
export function emitConversationUpdate(businessId: string, conversationId: string) {
  waEventEmitter.emit(`conversation:${businessId}`, {
    type: 'conversation_updated',
    conversationId
  });
}

