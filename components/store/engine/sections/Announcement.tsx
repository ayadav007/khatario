import { marqueeItems } from '@/lib/store/grocery';
import { announcementSettings } from '@/lib/store/engine/studio-adapter';
import { StudioAnnouncement } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { EngineAnnouncementScroll } from '../EngineViews';
import { noBox, withDefaults } from './shared';

export function Announcement({ section }: EngineSectionProps) {
  const s = announcementSettings(section);
  if (!s.text) return null;
  if (withDefaults(section).scrolling === true) {
    const items = marqueeItems(s.text);
    if (items.length === 0) return null;
    return <EngineAnnouncementScroll items={items} link={s.link ?? ''} />;
  }
  return <StudioAnnouncement s={noBox(s)} live />;
}
