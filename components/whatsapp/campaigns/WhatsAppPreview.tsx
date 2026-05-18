'use client';

import { Card } from '@/components/ui/Card';
import { MessageContent } from './MessageBuilder';
import { Smartphone, ArrowLeft, X } from 'lucide-react';

interface WhatsAppPreviewProps {
  message: MessageContent;
}

export function WhatsAppPreview({ message }: WhatsAppPreviewProps) {
  // Build buttons array from new format (both Quick Replies and Call to Actions)
  const buttons: Array<{ type: 'quick_reply' | 'call' | 'url'; title: string; phone?: string; url?: string }> = [];
  
  // Add Quick Replies
  if (message.type === 'button' && message.quickReplies) {
    message.quickReplies.forEach(title => {
      if (title.trim()) {
        buttons.push({ type: 'quick_reply', title: title.trim() });
      }
    });
  }
  
  // Add Call to Actions
  if (message.type === 'button' && message.callToActions) {
    if (message.callToActions.phone?.phone && message.callToActions.phone?.title) {
      buttons.push({
        type: 'call',
        title: message.callToActions.phone.title,
        phone: message.callToActions.phone.phone,
      });
    }
    if (message.callToActions.url?.url && message.callToActions.url?.title) {
      buttons.push({
        type: 'url',
        title: message.callToActions.url.title,
        url: message.callToActions.url.url,
      });
    }
  }

  // Format message text to handle bold (basic formatting)
  const formatMessage = (text: string) => {
    // Simple bold detection - **text** becomes bold
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const boldText = part.slice(2, -2);
        return <strong key={index}>{boldText}</strong>;
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <Card padding="lg">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone className="w-5 h-5 text-gray-600" />
        <h3 className="text-lg font-semibold text-gray-900">WhatsApp Preview</h3>
      </div>

      {/* WhatsApp Mobile Preview */}
      <div className="border border-gray-300 rounded-lg overflow-hidden shadow-lg max-w-sm mx-auto bg-white">
        {/* WhatsApp Header - Dark Green */}
        <div className="bg-[#008069] px-4 py-3 flex items-center gap-3">
          <ArrowLeft className="w-5 h-5 text-white" />
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <div className="w-6 h-6 rounded-full bg-[#008069]" />
          </div>
          <div className="flex-1 text-white">
            <div className="text-sm font-medium">Recipient</div>
          </div>
          <X className="w-5 h-5 text-white" />
        </div>

        {/* Chat Background - Light Beige/Off-White with Pattern */}
        <div 
          className="bg-[#efeae2] p-4 min-h-[400px] relative"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='grid' width='100' height='100' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='50' cy='50' r='0.5' fill='%23d4e5d1' opacity='0.4'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23grid)'/%3E%3C/svg%3E")`,
          }}
        >
          {/* Incoming Message Bubble - WhatsApp style with left tail */}
          <div className="relative max-w-[75%] mb-3">
            {/* WhatsApp bubble with tail */}
            <div 
              className="bg-[#f0f0f0] rounded-lg shadow-sm p-3 relative"
              style={{
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                borderRadius: '7.5px',
                marginLeft: '8px',
              }}
            >
              {/* Left tail pointer - CSS triangle */}
              <div 
                style={{
                  position: 'absolute',
                  left: '-8px',
                  top: '0px',
                  width: '0',
                  height: '0',
                  borderStyle: 'solid',
                  borderWidth: '0 8px 13px 0',
                  borderColor: 'transparent #f0f0f0 transparent transparent',
                }}
              />

              {/* Image (for image type or button type with image) */}
              {message.mediaUrl && (message.type === 'image' || message.type === 'button') && (
                <div className="mb-2 rounded-lg overflow-hidden">
                  <img
                    src={message.mediaUrl}
                    alt="Preview"
                    className="w-full h-auto max-h-48 object-cover"
                  />
                </div>
              )}

              {/* Message Text */}
              {message.text && (
                <div className="mb-2">
                  <p className="text-[#303030] text-[14.2px] leading-[19px] whitespace-pre-wrap break-words">
                    {formatMessage(message.text)}
                  </p>
                </div>
              )}

              {/* Footer */}
              {message.footer && (
                <div className="mb-2 mt-1">
                  <p className="text-[#667781] text-[12.8px] leading-[16px]">
                    {message.footer}
                  </p>
                </div>
              )}

              {/* Buttons - Inside bubble with borders */}
              {message.type === 'button' && buttons.length > 0 && (
                <div className="mt-3 space-y-[6px]">
                  {buttons.map((button, index) => {
                    let buttonText = button.title;
                    if (buttonText.length > 20) {
                      buttonText = buttonText.substring(0, 20) + '...';
                    }
                    
                    return (
                      <div
                        key={index}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-[#0086ff]/30 hover:bg-[#f5f5f5] transition-colors cursor-pointer flex items-center justify-center"
                        style={{ 
                          borderRadius: '6px',
                          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
                        }}
                      >
                        <span className="text-[#0086ff] text-[14.2px] font-normal leading-[19px] text-center">
                          {buttonText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        <p>This is a preview. Actual appearance may vary slightly on recipient devices.</p>
      </div>
    </Card>
  );
}

