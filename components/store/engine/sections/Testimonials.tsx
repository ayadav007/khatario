import { testimonialItems } from '@/lib/store/engine/studio-adapter';
import { StudioTestimonials } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { noBox, str } from './shared';

export function Testimonials({ section }: EngineSectionProps) {
  const quotes = testimonialItems(section).filter((q) => q.text);
  if (quotes.length === 0) return null;
  return (
    <StudioTestimonials
      s={noBox({ title: str(section.settings.heading) || 'What customers say' })}
      testimonials={quotes.map((q) => ({ name: q.name, text: q.text, photo_url: q.photo }))}
    />
  );
}
