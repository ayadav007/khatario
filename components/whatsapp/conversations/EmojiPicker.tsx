'use client';

import React from 'react';

const EMOJIS = [
  '😀', '😂', '😊', '😍', '🙂', '😉', '😎', '🤔', '😅', '😢', '😡', '🙏',
  '👍', '👎', '👌', '👏', '🙌', '💪', '🤝', '👋', '✌️', '🤞', '👉', '👀',
  '❤️', '🧡', '💚', '💙', '💯', '🔥', '✨', '🎉', '🎁', '⭐', '✅', '❌',
  '📦', '🚚', '🛒', '💰', '🧾', '📞', '📍', '⏰', '📅', '📷', '📄', '🔗',
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ onPick }: EmojiPickerProps) {
  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 grid w-72 grid-cols-8 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onMouseDown={(ev) => {
            ev.preventDefault();
            onPick(e);
          }}
          className="rounded p-1 text-xl leading-none hover:bg-gray-100"
          aria-label={`Insert ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
