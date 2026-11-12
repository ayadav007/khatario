import Link from 'next/link';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { splitLegalLinks } from '@/lib/marketing/legal/links';
import { formatLegalDate, type LegalDocumentData } from '@/lib/marketing/legal/types';

const LINK_CLASS = 'font-semibold text-primary-700 underline hover:text-primary-800';

function LegalText({ text }: { text: string }) {
  return (
    <>
      {splitLegalLinks(text).map((part, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>;
        if (part.href.startsWith('mailto:')) {
          return (
            <a key={i} href={part.href} className={LINK_CLASS}>
              {part.label}
            </a>
          );
        }
        return (
          <Link key={i} href={part.href} className={LINK_CLASS}>
            {part.label}
          </Link>
        );
      })}
    </>
  );
}

export function LegalDocument({ document }: { document: LegalDocumentData }) {
  return (
    <section className="bg-white py-14 md:py-16">
      <div className={`${LANDING_PAGE_GUTTER} w-full`}>
        <div className="max-w-3xl">
          <p className="text-sm text-slate-500">Last updated: {formatLegalDate(document.updatedOn)}</p>

          <nav aria-label="Contents" className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-900">Contents</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {document.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-primary-700 hover:text-primary-800">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {document.sections.map((s) => (
            <section key={s.id} id={s.id} className="mt-10 scroll-mt-28">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">{s.heading}</h2>
              {s.paragraphs?.map((p, i) => (
                <p key={i} className="mt-4 text-base leading-relaxed text-slate-600">
                  <LegalText text={p} />
                </p>
              ))}
              {s.bullets && s.bullets.length > 0 && (
                <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-relaxed text-slate-600">
                  {s.bullets.map((b, i) => (
                    <li key={i}>
                      <LegalText text={b} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
