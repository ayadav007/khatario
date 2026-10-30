import { Suspense, type CSSProperties, type ReactNode } from 'react';
import type { Section, ThemeData } from '@/lib/store/engine/types';
import { sectionFrameStyle } from '@/lib/store/engine/render-helpers';
import { sanitizeCssClass, scopeSectionCss, sectionDomId } from '@/lib/store/section-css';
import { SectionBoundary } from './SectionBoundary';

/**
 * Wrapper every engine section renders in: `#section-{id}`, data attributes, the merchant's classes,
 * the colour scheme and spacing, and the section's scoped CSS. Rendered on the server so the scheme
 * and CSS helpers (which pull in the sanitisers) stay out of the browser bundle; the error boundary
 * around the section is the client part.
 */
export function SectionFrame({
  id,
  section,
  theme,
  children,
}: {
  id: string;
  section: Section;
  theme: ThemeData;
  children: ReactNode;
}) {
  const css = scopeSectionCss(section.custom_css, id);
  return (
    <section
      id={sectionDomId(id)}
      data-section-type={section.type}
      data-section-id={id}
      className={['eng-sec', sanitizeCssClass(section.css_class)].filter(Boolean).join(' ')}
      style={sectionFrameStyle(theme.settings, section) as CSSProperties}
    >
      {/* Scoped and brace-balanced by scopeSectionCss, with every `<` removed. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {/* Suspense lets a section that fails during server rendering fall back to the client, where the boundary hides it. */}
      <SectionBoundary type={section.type}>
        <Suspense fallback={null}>{children}</Suspense>
      </SectionBoundary>
    </section>
  );
}
