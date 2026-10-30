import { videoEmbedUrl } from '@/lib/store/engine/shared';
import type { EngineSectionProps } from '../registry';
import { EngineVideoCover } from './EngineVideoCover';
import { str, withDefaults } from './shared';

/** A YouTube or Vimeo embed (privacy-friendly hosts); nothing renders for a link that does not parse. */
export function Video({ section }: EngineSectionProps) {
  const v = withDefaults(section);
  const embed = videoEmbedUrl(str(v.video_url));
  if (!embed) return null;
  const heading = str(v.heading);
  const cover = str(v.cover_image);
  return (
    <div className="eng-video">
      {heading ? <h2>{heading}</h2> : null}
      <div className="eng-video-frame">
        {cover ? (
          <EngineVideoCover embed={embed} cover={cover} title={heading || 'Video'} />
        ) : (
          <iframe
            src={embed}
            title={heading || 'Video'}
            loading="lazy"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </div>
  );
}
