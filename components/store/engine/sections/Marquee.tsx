import { marqueeSettings } from '@/lib/store/engine/studio-adapter';
import { StudioMarquee } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { noBox } from './shared';

export function Marquee({ section }: EngineSectionProps) {
  return <StudioMarquee s={noBox(marqueeSettings(section))} />;
}
