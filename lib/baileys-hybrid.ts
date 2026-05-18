/**
 * Hybrid Baileys Library
 * Combines stable connection from @whiskeysockets/baileys with interactive button support from baileys-pro
 * 
 * This library:
 * - Uses standard Baileys for stable connection management (no _c errors, stable QR, etc.)
 * - Adds baileys-pro's button message logic (including <biz> XML nodes) for interactive buttons
 * - Provides the best of both worlds: stable connection + working buttons
 */

import makeWASocketStandard, {
  DisconnectReason as DisconnectReasonStandard,
  fetchLatestBaileysVersion as fetchLatestBaileysVersionStandard,
  BufferJSON as BufferJSONStandard,
  initAuthCreds as initAuthCredsStandard,
  proto as protoStandard
} from '@whiskeysockets/baileys';

// Import types separately (they're exported from Types, not main index)
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys/lib/Types';

// Import utility functions (these are exported from Utils)
import { normalizeMessageContent, getContentType } from '@whiskeysockets/baileys/lib/Utils/messages';

// Button type constants (same values as baileys-pro uses)
const BUTTON_TYPE_RESPONSE = 1; // proto.Message.ButtonsMessage.Button.Type.RESPONSE (Quick Reply)
const BUTTON_TYPE_PHONE_NUMBER = 2; // proto.Message.ButtonsMessage.Button.Type.PHONE_NUMBER (Call)
const BUTTON_TYPE_URL = 3; // proto.Message.ButtonsMessage.Button.Type.URL (Visit Website)
const HEADER_TYPE_EMPTY = 1; // proto.Message.ButtonsMessage.HeaderType.EMPTY when text is present  
const HEADER_TYPE_TEXT = 1; // proto.Message.ButtonsMessage.HeaderType.TEXT
const HEADER_TYPE_IMAGE = 4; // proto.Message.ButtonsMessage.HeaderType.IMAGE

// Re-export standard Baileys functions and types
export const DisconnectReason = DisconnectReasonStandard;
export const fetchLatestBaileysVersion = fetchLatestBaileysVersionStandard;
export const BufferJSON = BufferJSONStandard;
export const initAuthCreds = initAuthCredsStandard;
export { type AuthenticationCreds, type SignalDataTypeMap };
export const proto = protoStandard;

/**
 * Helper to get button type from message (from baileys-pro logic)
 */
function getButtonType(message: any): string | undefined {
  if (message.buttonsMessage) {
    return 'buttons';
  } else if (message.buttonsResponseMessage) {
    return 'buttons_response';
  } else if (message.interactiveResponseMessage) {
    return 'interactive_response';
  } else if (message.listMessage) {
    return 'list';
  } else if (message.listResponseMessage) {
    return 'list_response';
  }
  return undefined;
}

/**
 * Helper to get button args (from baileys-pro logic)
 */
function getButtonArgs(message: any): any {
  if (message.templateMessage) {
    return {};
  } else if (message.listMessage) {
    const type = message.listMessage.listType;
    if (!type) {
      throw new Error('Expected list type inside message');
    }
    // Return format: { v: '2', type: 'single_select' | 'product_list' }
    const typeMap: { [key: number]: string } = {
      1: 'single_select',
      2: 'product_list'
    };
    return { v: '2', type: typeMap[type] || 'single_select' };
  }
  return {};
}

/**
 * Format interactive button message using baileys-pro proto structure
 * ALL button types (cta_reply, cta_call, cta_url) use the SAME nativeFlowMessage format
 * Based on research: https://www.npmjs.com/package/baileys-pro
 */
export async function formatButtonMessage(
  text: string,
  buttons: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>,
  footer?: string,
  media?: string | Buffer
): Promise<any> {
  console.log('[Hybrid] Formatting interactive buttons using baileys-pro nativeFlowMessage (all types use same structure)');
  
  // Import proto from baileys-pro
  const { proto } = await import('baileys-pro');
  
  // Convert ALL buttons to nativeFlowMessage buttons format using proto.create()
  // According to research, cta_reply, cta_call, and cta_url all use the same structure
  // Based on baileys-pro README and research
  const nativeFlowButtons = buttons.map(btn => {
    const buttonTitle = btn.title.length > 20 ? btn.title.substring(0, 20) : btn.title;
    
    if (btn.type === 'call' && btn.phone) {
      // Format phone number - try with + prefix for call buttons
      let phoneNumber = btn.phone.replace(/[^0-9]/g, '');
      
      // Add country code if needed (for Indian numbers)
      if (phoneNumber.length === 10 && (phoneNumber.startsWith('7') || phoneNumber.startsWith('8') || phoneNumber.startsWith('9'))) {
        phoneNumber = '91' + phoneNumber;
      }
      
      // Add + prefix for call buttons (international format)
      phoneNumber = '+' + phoneNumber;
      
      console.log('[Hybrid] CTA Call button - Phone (with +):', phoneNumber);
      
      // Use proto.create() method
      return proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({
          display_text: buttonTitle,
          phone_number: phoneNumber // Try phone_number field instead of id
        })
      });
    } else if (btn.type === 'url' && btn.url) {
      // Ensure URL has protocol
      let fullUrl = btn.url;
      if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
        fullUrl = 'https://' + fullUrl;
      }
      
      console.log('[Hybrid] CTA URL button - URL:', fullUrl);
      
      // Use proto.create() method
      return proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: buttonTitle,
          url: fullUrl
        })
      });
    } else {
      // Quick reply button - might not be supported in nativeFlowMessage
      console.log('[Hybrid] ⚠️ Quick reply button (may not be supported in nativeFlowMessage):', buttonTitle);
      
      // Use proto.create() method
      return proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: 'quick_reply', // Try 'quick_reply' instead of 'cta_reply'
        buttonParamsJson: JSON.stringify({
          display_text: buttonTitle,
          id: btn.id || btn.title.toLowerCase().replace(/\s+/g, '_')
        })
      });
    }
  });

  // Create the interactive message using proto structures (matching research exactly)
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({
      text: text
    }),
    footer: footer ? proto.Message.InteractiveMessage.Footer.create({
      text: footer
    }) : undefined,
    // Simplified header - no subtitle field, matches research example
    header: media ? proto.Message.InteractiveMessage.Header.create({
      hasMediaAttachment: true
    }) : undefined, // No header for text-only messages
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: nativeFlowButtons
    })
  });

  // Wrap in viewOnceMessage as per baileys-pro format
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: interactiveMessage
      }
    }
  };
}

/**
 * Create WhatsApp Socket using standard Baileys but with button support
 * This wraps standard Baileys' makeWASocket and extends it with baileys-pro's button logic
 */
export function makeWASocket(config: any) {
  // Create socket using standard Baileys (stable connection)
  const socket = makeWASocketStandard(config);

  // Save original relayMessage if it exists (from messages socket)
  const originalRelayMessage = (socket as any).relayMessage;

  // Override relayMessage to add button support (baileys-pro's <biz> node logic)
  if (originalRelayMessage) {
    (socket as any).relayMessage = async function(
      jid: string,
      message: any,
      options: any = {}
    ) {
      // Normalize message content and check if it's a button message
      const normalizedMsg = normalizeMessageContent(message);
      const key = normalizedMsg ? getContentType(normalizedMsg) : null;
      const buttonType = normalizedMsg ? getButtonType(normalizedMsg) : null;
      
      // Check for viewOnceMessage structure (new format from Perplexity)
      const hasViewOnceMessage = message?.viewOnceMessage || normalizedMsg?.viewOnceMessage;
      const hasInteractiveInViewOnce = hasViewOnceMessage?.message?.interactiveMessage;

      // CRITICAL FIX: Only add <biz> node when explicitly requested via options.addBizInteractive flag
      // This prevents over-aggressive injection that causes 405 errors
      // 
      // Why 405 happens: WhatsApp rejects malformed/unexpected interactive stanzas when:
      // - <biz> node is added to messages that don't need it (like plain text or media)
      // - Protocol version mismatch between session and native_flow format
      // - <biz> node structure doesn't match what WhatsApp expects for the message type
      //
      // How this fix avoids it: We only inject <biz> when explicitly requested for CTA messages,
      // not by auto-detecting message types. This ensures normal messages stay untouched.
      //
      // Based on: https://github.com/WhiskeySockets/Baileys/issues/807
      const shouldAddBiz = options?.addBizInteractive === true;

      if (shouldAddBiz) {
        console.log('[Hybrid] ✅ Explicitly requested <biz> node for native flow CTA - adding...');
        
        // Ensure additionalNodes array exists
        if (!options.additionalNodes) {
          options.additionalNodes = [];
        }

        // Check if we already have a biz node (don't duplicate)
        const hasBizNode = options.additionalNodes.some((node: any) => node.tag === 'biz');

        if (!hasBizNode) {
          // Add native_flow <biz> node structure
          // This is required for native flow CTAs (call/url buttons) to work
          // The structure matches baileys-pro's implementation
          const bizNode = {
            tag: 'biz',
            attrs: {},
            content: [{
              tag: 'interactive',
              attrs: {
                type: 'native_flow',
                v: '1' // Version 1 of native flow protocol
              },
              content: [{
                tag: 'native_flow',
                attrs: {
                  name: 'quick_reply' // Required attribute for native flow
                }
              }]
            }]
          };
          options.additionalNodes.push(bizNode);
          console.log('[Hybrid] ✅ Added <biz><interactive type="native_flow" v="1"> node for CTA');
        } else {
          console.log('[Hybrid] ⚠️ <biz> node already exists in additionalNodes, skipping duplicate');
        }
      }
      // If addBizInteractive is not set, we don't add <biz> node - normal messages pass through untouched

      // Call original relayMessage with modified options
      return originalRelayMessage.call(this, jid, message, options);
    };
  }

  // Override sendMessage to use baileys-pro button formatting
  const originalSendMessage = socket.sendMessage.bind(socket);
  
  socket.sendMessage = async function(jid: string, content: any, options: any = {}) {
    // Only log button-related messages, not every message
    const hasButtons = content && typeof content === 'object' && ('buttons' in content || 'buttonsMessage' in content);
    if (hasButtons) {
      console.log('[Hybrid] sendMessage called with button content keys:', Object.keys(content));
    }
    
    // If content has 'buttons' field, format it using baileys-pro proto structure
    if (content && typeof content === 'object' && 'buttons' in content && Array.isArray(content.buttons)) {
      const { text, buttons, footer } = content;
      console.log('[Hybrid] Detected buttons in content, formatting as interactive message...');
      // Format using baileys-pro proto structure (async)
      const buttonMessage = await formatButtonMessage(text || '', buttons, footer);
      console.log('[Hybrid] Formatted button message structure:', Object.keys(buttonMessage));
      // Call original sendMessage with formatted message
      return originalSendMessage(jid, buttonMessage, options);
    }

    // If it's already a buttonsMessage format, pass it through (standard quick reply buttons)
    if (content && typeof content === 'object' && 'buttonsMessage' in content) {
      console.log('[Hybrid] Content already has buttonsMessage format, passing through (no <biz> node)...');
      // Pass through - standard Baileys will handle quick reply buttons
      return originalSendMessage(jid, content, options);
    }

    // For all other messages (normal text, images, etc.), just use original sendMessage without modification
    return originalSendMessage(jid, content, options);
  };

  return socket;
}

/**
 * Send interactive button message helper
 * Bypasses standard Baileys' generateWAMessageContent (which doesn't handle buttonsMessage)
 * and sends the proto message directly to relayMessage
 */
export async function sendButtonMessage(
  socket: any,
  jid: string,
  text: string,
  buttons: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>,
  footer?: string,
  media?: string | Buffer
): Promise<any> {
  console.log('[Hybrid] sendButtonMessage called with', buttons.length, 'buttons', media ? 'and media' : '');
  
  // Format the button message (all types use nativeFlowMessage format)
  const buttonMessageProto = await formatButtonMessage(text, buttons, footer, media);
  console.log('[Hybrid] Formatted button message proto:', Object.keys(buttonMessageProto));
  
  try {
    // Verify socket has user
    if (!socket || !socket.user) {
      throw new Error('Socket or user not available');
    }
    
    // Import baileys-pro utilities
    const { generateWAMessageFromContent } = await import('baileys-pro');
    const { generateMessageID } = await import('@whiskeysockets/baileys/lib/Utils/generics');
    
    // Get user JID from socket
    const userJid = socket.user?.id;
    if (!userJid) {
      throw new Error('Socket user not available');
    }
    
    // Create WAMessage from proto (as per baileys-pro README and research)
    console.log('[Hybrid] Creating WAMessage from proto using generateWAMessageFromContent');
    const fullMsg = generateWAMessageFromContent(jid, buttonMessageProto, {
      userJid,
      messageId: generateMessageID(),
      timestamp: new Date()
    });
    
    // Send using relayMessage with addBizInteractive flag
    // According to research, ALL button types (cta_reply, cta_call, cta_url) need <biz> node
    console.log('[Hybrid] Sending via relayMessage with addBizInteractive: true');
    const msgId = await socket.relayMessage(jid, fullMsg.message, {
      messageId: fullMsg.key.id,
      addBizInteractive: true // CRITICAL: Required for nativeFlowMessage buttons
    });
    
    console.log('[Hybrid] ✅ Interactive button message sent successfully, message ID:', msgId);
    
    // Update the message key with the returned ID
    if (msgId) {
      fullMsg.key.id = msgId;
    }
    
    return fullMsg;
  } catch (error: any) {
    console.error('[Hybrid] ❌ Error sending button message:', error);
    
    // Handle connection closed errors
    if (error === 1006 || error.code === 1006 || (typeof error === 'number' && error === 1006)) {
      throw new Error('WhatsApp connection was lost while sending button message. Please try again.');
    }
    
    // Re-throw the error
    throw error;
  }
}
