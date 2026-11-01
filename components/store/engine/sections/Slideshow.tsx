import type { StudioHeroSettings, StudioSlide } from '@/lib/store/studio-sections';
import { slideSchemeStyle } from '@/lib/store/engine/render-helpers';
import { slideshowDevices, slideshowSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { EngineHero } from '../EngineViews';
import { noBox } from './shared';
import '../slideshow.css';

/**
 * Each slide's colour scheme becomes its CSS variables here, on the server (the scheme helpers stay out of the
 * browser bundle). A scheme id that no longer exists gives none, so that slide keeps the slideshow's scheme.
 */
export function Slideshow({ section, theme }: EngineSectionProps) {
  const schemes = theme.settings.color_schemes;
  const withScheme = <T extends StudioSlide | StudioHeroSettings>(x: T): T => {
    const schemeStyle = slideSchemeStyle(schemes, x.colorScheme);
    return schemeStyle ? { ...x, schemeStyle } : x;
  };
  const s = withScheme(slideshowSettings(section));
  if (s.slides) s.slides = s.slides.map(withScheme);
  return <EngineHero s={noBox(s)} devices={slideshowDevices(section)} />;
}
