import { slideshowSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { EngineHero } from '../EngineViews';
import { noBox } from './shared';

export function Slideshow({ section }: EngineSectionProps) {
  return <EngineHero s={noBox(slideshowSettings(section))} />;
}
