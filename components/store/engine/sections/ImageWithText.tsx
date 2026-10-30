import { imageWithTextSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { EngineCtaButton } from '../EngineViews';
import { richtextHtml } from './shared';

/** One still slide in Studio's hero markup; the description is the merchant's sanitised rich text. */
export function ImageWithText({ section }: EngineSectionProps) {
  const s = imageWithTextSettings(section);
  const html = richtextHtml(section.type, 'description', section.settings.description);
  return (
    <div className={`hero ${s.layout ?? 'image-text'} medium`} style={{ paddingTop: 0, paddingBottom: 0 }}>
      <div className="heroCopy">
        {s.heading ? <h2 className="eng-heroTitle">{s.heading}</h2> : null}
        {html ? <div className="eng-rt" dangerouslySetInnerHTML={{ __html: html }} /> : null}
        {s.buttonText ? <EngineCtaButton label={s.buttonText} link={s.link ?? ''} /> : null}
      </div>
      <div className="heroImg" role="img" aria-label={s.heading ?? ''}>
        {s.image ? (
          <div className="heroSlideImg on" style={{ backgroundImage: `url(${JSON.stringify(s.image)})` }} />
        ) : null}
      </div>
    </div>
  );
}
