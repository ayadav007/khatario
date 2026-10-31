import { testimonialItems } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { str } from './shared';

/** Studio's quote cards, with each quote's star rating and photo (the old Studio strip had neither). */
export function Testimonials({ section }: EngineSectionProps) {
  const quotes = testimonialItems(section).filter((q) => q.text);
  if (quotes.length === 0) return null;
  return (
    <section className="st-section test">
      <div className="sectionTitle">
        <div>
          <h2>{str(section.settings.heading) || 'What customers say'}</h2>
        </div>
      </div>
      <div className="quotes">
        {quotes.map((q, i) => (
          <blockquote key={`${q.name}-${i}`}>
            <span className="eng-stars" role="img" aria-label={`${q.rating} out of 5 stars`}>
              {'★'.repeat(q.rating)}
              <span className="eng-stars-off">{'★'.repeat(5 - q.rating)}</span>
            </span>
            “{q.text}”
            <span className="eng-quote-by">
              {q.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.photo} alt="" loading="lazy" />
              ) : null}
              <b>— {q.name}</b>
            </span>
          </blockquote>
        ))}
      </div>
    </section>
  );
}
