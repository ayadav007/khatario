/**
 * Utility functions for message display and handling
 */

/**
 * Get display text for a message, handling media messages properly
 * Media messages often don't have message_text, so we provide fallbacks
 */
export function getDisplayText(message: {
  message_text?: string | null;
  message_type?: string;
  media_url?: string | null;
}): string {
  // If message has text, use it (could be text message or caption)
  if (message.message_text) {
    return message.message_text;
  }
  
  // For media messages without text, provide appropriate placeholder
  switch (message.message_type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'document':
      return '📄 Document';
    case 'audio':
      return '🎵 Audio';
    case 'sticker':
      return '🎭 Sticker';
    case 'location':
      return '📍 Location';
    case 'contact':
      return '👤 Contact';
    default:
      // If we have media_url but unknown type, still indicate it's media
      if (message.media_url) {
        return '📎 Media';
      }
      return 'Message';
  }
}

/**
 * Check if message has media content
 */
export function hasMedia(message: {
  message_type?: string;
  media_url?: string | null;
}): boolean {
  return !!message.media_url || 
         (!!message.message_type && 
          ['image', 'video', 'document', 'audio', 'sticker'].includes(message.message_type));
}

/**
 * Check if message should be displayed (has either text or media)
 */
export function shouldDisplayMessage(message: {
  message_text?: string | null;
  message_type?: string;
  media_url?: string | null;
}): boolean {
  return !!message.message_text || hasMedia(message);
}

