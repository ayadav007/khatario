import { announcementSettings } from '@/lib/store/engine/studio-adapter';
import { StudioAnnouncement } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { noBox } from './shared';

export function Announcement({ section }: EngineSectionProps) {
  const s = announcementSettings(section);
  if (!s.text) return null;
  return <StudioAnnouncement s={noBox(s)} live />;
}
