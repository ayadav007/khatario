import { richTextSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { richtextHtml } from './shared';

/** Studio's rich-text markup, with the merchant's sanitised HTML instead of plain text. */
export function RichText({ section }: EngineSectionProps) {
  const s = richTextSettings(section);
  const html = richtextHtml(section.type, 'content', section.settings.content);
  if (!s.title && !html) return null;
  return (
    <div className="rich" style={{ paddingTop: 0, paddingBottom: 0, textAlign: s.textAlign ?? 'center' }}>
      {s.title ? <h2>{s.title}</h2> : null}
      {html ? <div className="eng-rt" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </div>
  );
}
