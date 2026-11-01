import { testimonialItems } from '@/lib/store/engine/studio-adapter';
import { summaryLine } from '@/lib/store/engine/testimonials-summary';
import type { EngineSectionProps } from '../registry';
import { str } from './shared';

/** "Delhi · Bought: Saree", each part only when set. */
function meta(q: { location: string; purchased: string }): string {
  return [q.location, q.purchased ? `Bought: ${q.purchased}` : ''].filter(Boolean).join(' · ');
}

/** Studio's quote cards, with each quote's star rating and photo (the old Studio strip had neither). */
export function Testimonials({ section }: EngineSectionProps) {
  const quotes = testimonialItems(section).filter((q) => q.text);
  if (quotes.length === 0) return null;
  const summary = section.settings.show_summary === true ? summaryLine(quotes.map((q) => q.rating)) : null;
  return (
    <section className="st-section test">
      <div className="sectionTitle">
        <div>
          <h2>{str(section.settings.heading) || 'What customers say'}</h2>
          {summary ? <p className="eng-test-summary">{summary}</p> : null}
        </div>
      </div>
      <div className="quotes">
        {quotes.map((q, i) => (
          <blockquote key={`${q.name}-${i}`}>
            <span className="eng-stars" role="img" aria-label={`${q.rating} out of 5 stars`}>
              {'★'.repeat(q.rating)}
              <span className="eng-stars-off">{'★'.repeat(5 - q.rating)}</span>
            </span>
            {q.title ? <strong>{q.title}</strong> : null}
            “{q.text}”
            <span className="eng-quote-by">
              {q.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.photo} alt="" loading="lazy" />
              ) : null}
              {meta(q) ? (
                <span className="eng-quote-who">
                  <b>— {q.name}</b>
                  <small>{meta(q)}</small>
                </span>
              ) : (
                <b>— {q.name}</b>
              )}
            </span>
          </blockquote>
        ))}
      </div>
    </section>
  );
}
