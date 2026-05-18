import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generateInvoicePdf } from '@/lib/pdf-generator';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let body: any;

    // Handle FormData (for image uploads)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      body = {
        business_id: formData.get('business_id') as string,
        to: formData.get('to') as string,
        message: formData.get('message') as string,
        message_type: formData.get('message_type') as string,
        image: formData.get('image') as File | null,
      };
    } else {
      // Handle JSON
      try {
        body = await request.json();
      } catch (parseError) {
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
      }
    }

    const { business_id, to, message, mediaUrl, invoiceId, message_type, buttons, image, footer } = body || {};
    
    if (!business_id || !to || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Convert new button format to backend format
    let formattedButtons: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }> | undefined;
    if (message_type === 'button' && buttons) {
      formattedButtons = [];
      
      // Handle new format from bulk campaign / single message
      if (buttons.quickReplies || buttons.callToActions) {
        // Add quick replies
        if (buttons.quickReplies && Array.isArray(buttons.quickReplies)) {
          buttons.quickReplies.forEach((title: string, index: number) => {
            if (title.trim()) {
              formattedButtons!.push({
                id: `quick_reply_${index}`,
                title: title.trim(),
                type: 'quick_reply'
              });
            }
          });
        }
        
        // Add call to actions
        if (buttons.callToActions) {
          if (buttons.callToActions.phone?.title && buttons.callToActions.phone?.phone) {
            formattedButtons!.push({
              id: 'call_button',
              title: buttons.callToActions.phone.title,
              type: 'call',
              phone: buttons.callToActions.phone.phone
            });
          }
          
          if (buttons.callToActions.url?.title && buttons.callToActions.url?.url) {
            formattedButtons!.push({
              id: 'url_button',
              title: buttons.callToActions.url.title,
              type: 'url',
              url: buttons.callToActions.url.url
            });
          }
        }
      } 
      // Handle old format (backward compatibility)
      else if (Array.isArray(buttons)) {
        formattedButtons = buttons;
      }
    }

    // Check if business has WhatsApp Bot addon (unlocks Conversations, Bot Rules, and Send Message)
    // Exception: allow sending if it's an invoice-related message (invoice sending is free)
    if (invoiceId) {
      // Invoice messages are allowed without addon
    } else {
      const hasAddon = await hasWhatsAppBotAddon(business_id);
      if (!hasAddon) {
        return NextResponse.json(
          { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
          { status: 403 }
        );
      }
    }

    // Handle image upload (FormData)
    let imageBuffer: Buffer | undefined;
    if (image && image instanceof File) {
      const arrayBuffer = await image.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    }

    let media: string | Buffer | undefined = mediaUrl || imageBuffer;

    // If invoiceId is provided, generate PDF buffer internally
    if (invoiceId) {
        try {
            media = await generateInvoicePdf(invoiceId);
        } catch (e) {
            console.error('Failed to generate PDF for WhatsApp:', e);
            return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 });
        }
    }

    // Send message with appropriate type
    await sendWhatsAppMessage(
      business_id,
      to,
      message,
      media,
      message_type || 'text',
      formattedButtons, // Formatted buttons array
      footer // Optional footer for button messages
    );
    
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error sending WA message:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

