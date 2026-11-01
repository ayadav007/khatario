import { multicolumnSettings } from '@/lib/store/engine/studio-adapter';
import { StudioUspStrip } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { noBox } from './shared';

export function Multicolumn({ section }: EngineSectionProps) {
  const s = multicolumnSettings(section);
  // An empty list would make Studio fall back to its sample promises.
  if (!s.usps?.length) return null;
  return <StudioUspStrip s={noBox(s)} />;
}
