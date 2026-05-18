'use client';

import React from 'react';

/**
 * TypingIndicator Component
 * Displays the animated three dots typing indicator (WhatsApp style)
 */
export function TypingIndicator() {
  return (
    <div className="flex gap-2 mb-1">
      <div className="flex items-end gap-1 px-4 py-2 bg-white rounded-2xl shadow-sm max-w-xs">
        <div className="flex gap-1 py-2">
          <span 
            className="w-2 h-2 bg-[#667781] rounded-full animate-bounce" 
            style={{ animationDelay: '0ms' }}
          ></span>
          <span 
            className="w-2 h-2 bg-[#667781] rounded-full animate-bounce" 
            style={{ animationDelay: '150ms' }}
          ></span>
          <span 
            className="w-2 h-2 bg-[#667781] rounded-full animate-bounce" 
            style={{ animationDelay: '300ms' }}
          ></span>
        </div>
      </div>
    </div>
  );
}
