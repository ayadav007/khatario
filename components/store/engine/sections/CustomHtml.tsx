import { sanitizeCustomHtml } from '@/lib/store/engine/html';
import type { EngineSectionProps } from '../registry';

export function CustomHtml({ section }: EngineSectionProps) {
  // Sanitised on save and again here, in case the stored theme predates a rule change.
  const html = sanitizeCustomHtml(section.settings.html);
  if (!html) return null;
  return <div className="eng-html" dangerouslySetInnerHTML={{ __html: html }} />;
}
