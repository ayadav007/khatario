'use client';

import { useState } from 'react';
import { EMBED_SANDBOX } from '@/lib/store/engine/shared';

/** A cover picture that becomes the embedded player when clicked (nothing loads from the video host before). */
export function EngineVideoCover({ embed, cover, title }: { embed: string; cover: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <iframe
        src={`${embed}${embed.includes('?') ? '&' : '?'}autoplay=1`}
        title={title}
        sandbox={EMBED_SANDBOX}
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  return (
    <button
      type="button"
      className="eng-video-cover"
      aria-label={`Play video: ${title}`}
      style={{ backgroundImage: `url(${JSON.stringify(cover)})` }}
      onClick={() => setPlaying(true)}
    >
      <span aria-hidden="true">▶</span>
    </button>
  );
}
