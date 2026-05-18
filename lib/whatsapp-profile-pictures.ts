/**
 * Helper utility to fetch profile pictures from WhatsApp
 * Used to avoid duplicating profile picture fetching logic
 */

import { getWhatsAppSocket, getWhatsAppStatus } from './whatsapp';

/**
 * Fetch profile picture URL for a contact/group
 */
export async function fetchProfilePicture(
  businessId: string,
  conversationId: string | null,
  fromNumber: string | null,
  isGroup: boolean = false
): Promise<string | null> {
  try {
    const status = await getWhatsAppStatus(businessId);
    
    if (status.status !== 'connected') {
      return null;
    }

    const session = await getWhatsAppSocket(businessId);
    if (!session.socket || session.status !== 'connected') {
      return null;
    }

    // Build JID
    let jid: string;
    if (isGroup && conversationId && conversationId.includes('@g.us')) {
      jid = conversationId;
    } else if (conversationId && conversationId.includes('@')) {
      jid = conversationId;
    } else {
      // For individual chats, build JID from phone number
      const phoneNumber = conversationId || fromNumber;
      if (!phoneNumber) {
        return null;
      }
      // Ensure phone number doesn't already have @s.whatsapp.net
      jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    }

    try {
      const profilePictureUrl = await session.socket.profilePictureUrl(jid, 'image');
      return profilePictureUrl;
    } catch (err: any) {
      // Profile picture not available (404) or other error - this is normal
      // Don't log errors as they're expected for contacts without profile pictures
      if (err.message && !err.message.includes('404')) {
        console.log(`[Profile] Error fetching profile picture for ${jid}:`, err.message);
      }
      return null;
    }
  } catch (err) {
    console.error('[Profile] Error in fetchProfilePicture:', err);
    return null;
  }
}

/**
 * Batch fetch profile pictures for multiple conversations
 * This is more efficient than fetching one by one
 */
export async function fetchProfilePicturesBatch(
  businessId: string,
  conversations: Array<{ conversation_id: string | null; from_number: string | null; is_group?: boolean }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  
  try {
    const status = await getWhatsAppStatus(businessId);
    
    if (status.status !== 'connected') {
      return result;
    }

    const session = await getWhatsAppSocket(businessId);
    if (!session.socket || session.status !== 'connected') {
      return result;
    }

    // Fetch profile pictures in parallel (but limit concurrency to avoid overwhelming WhatsApp)
    const batchSize = 5;
    for (let i = 0; i < conversations.length; i += batchSize) {
      const batch = conversations.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (conv) => {
          try {
            let jid: string;
            if (conv.is_group && conv.conversation_id && conv.conversation_id.includes('@g.us')) {
              jid = conv.conversation_id;
            } else if (conv.conversation_id && conv.conversation_id.includes('@')) {
              jid = conv.conversation_id;
            } else {
              const phoneNumber = conv.conversation_id || conv.from_number;
              if (!phoneNumber) return;
              jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            }

            const profilePictureUrl = await session.socket.profilePictureUrl(jid, 'image');
            const key = conv.conversation_id || conv.from_number || '';
            if (profilePictureUrl) {
              result.set(key, profilePictureUrl);
            }
          } catch (err) {
            // Ignore errors - profile picture not available is normal
          }
        })
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < conversations.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (err) {
    console.error('[Profile] Error in fetchProfilePicturesBatch:', err);
  }

  return result;
}

