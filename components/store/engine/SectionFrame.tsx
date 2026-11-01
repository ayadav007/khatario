import { Suspense, type CSSProperties, type ReactNode } from 'react';
import type { Section, ThemeData } from '@/lib/store/engine/types';
import type { GroupKey } from '@/lib/store/engine/editor/ops';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { sectionFrameClass, sectionFrameStyle } from '@/lib/store/engine/render-helpers';
import { sanitizeCssClass, scopeSectionCss, sectionDomId } from '@/lib/store/section-css';
import { SectionBoundary, SectionFailedCard } from './SectionBoundary';

/** The schema's display name ("Slideshow"), or the type when the schema is unknown. */
export function sectionTypeName(type: string): string {
  return getSectionSchema(type)?.name ?? type;
}

/**
 * Wrapper every engine section renders in: `#section-{id}`, data attributes, the merchant's classes,
 * the colour scheme and spacing, and the section's scoped CSS. Rendered on the server so the scheme
 * and CSS helpers (which pull in the sanitisers) stay out of the browser bundle; the error boundary
 * around the section is the client part.
 *
 * In editor mode it also carries what the editor bridge needs (the section's index in its group and
 * the name tag text), and a section that failed (`failed`, or a throw caught by the boundary) shows
 * the red "failed to load" card instead of disappearing.
 */
export function SectionFrame({
  id,
  section,
  theme,
  group,
  index,
  editor = false,
  failed = false,
  children,
}: {
  id: string;
  section: Section;
  theme: ThemeData;
  group: GroupKey;
  /** Position in the group's `order` (hidden sections included), used for "+" insertion points. */
  index: number;
  editor?: boolean;
  /** The section's data failed to load (editor mode only renders it). */
  failed?: boolean;
  children?: ReactNode;
}) {
  const css = scopeSectionCss(section.custom_css, id);
  const typeName = sectionTypeName(section.type);
  return (
    <section
      id={sectionDomId(id)}
      data-section-type={section.type}
      data-section-id={id}
      data-scheme={
        section.custom_colors && Object.keys(section.custom_colors).length
          ? 'custom'
          : section.color_scheme && theme.settings.color_schemes.some((c) => c.id === section.color_scheme)
            ? section.color_scheme
            : undefined
      }
      data-section-group={group}
      {...(editor ? { 'data-section-index': index, 'data-section-name': section.label || typeName } : {})}
      className={[sectionFrameClass(section.settings), sanitizeCssClass(section.css_class)].filter(Boolean).join(' ')}
      style={sectionFrameStyle(theme.settings, section) as CSSProperties}
    >
      {/* Scoped and brace-balanced by scopeSectionCss, with every `<` removed. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {/* Suspense lets a section that fails during server rendering fall back to the client, where the boundary hides it. */}
      {failed ? (
        <SectionFailedCard name={typeName} />
      ) : (
        <SectionBoundary
          type={section.type}
          editorName={editor ? typeName : undefined}
          resetKey={editor ? hashKey(JSON.stringify(section)) : undefined}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </SectionBoundary>
      )}
    </section>
  );
}

/** A short FNV-1a hash, so the boundary's reset key stays small in the editor's payload. */
function hashKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
