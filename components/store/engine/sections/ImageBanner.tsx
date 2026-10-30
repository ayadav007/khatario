import { bannerSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { EngineBanner } from '../EngineViews';
import { noBox } from './shared';

export function ImageBanner({ section }: EngineSectionProps) {
  return <EngineBanner s={noBox(bannerSettings(section))} />;
}
