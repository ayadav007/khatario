import { ChevronDown } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type FaqItem = { q: string; a: string };

export type LandingFaqContent = {
  heading: string;
  intro: string;
  items: FaqItem[];
};

export const LANDING_FAQ_DEFAULTS: LandingFaqContent = {
  heading: 'Questions shop owners ask us',
  intro: 'Still unsure? [Book a free demo](/book-demo) and ask us anything.',
  items: [
    {
      q: 'Are the bills GST compliant? Can I file GSTR-1 from Khatario?',
      a: 'Yes. Every bill carries HSN/SAC codes and works out CGST, SGST or IGST from the place of supply. Khatario prepares GSTR-1 and GSTR-3B views that you can export as Excel or JSON for the GST portal, or send to your CA.',
    },
    {
      q: 'What happens if the internet goes down at the counter?',
      a: 'Saving a bill needs an internet connection. Reconnect, then save the bill. Khatario does not keep billing while you are disconnected.',
    },
    {
      q: 'Does it work on my phone?',
      a: 'Yes. Khatario runs in the browser on your computer, tablet or phone, and you can add it to your home screen like an app. Your data is the same on every device.',
    },
    {
      q: 'Which printers does it support?',
      a: '58mm and 80mm thermal receipt printers over Bluetooth, USB or network, plus A4 PDF bills for any regular printer.',
    },
    {
      q: 'I use Tally, Vyapar or a notebook today. How hard is it to switch?',
      a: 'Most shops start billing on day one. Import your item list from a CSV file (we give you the template), add customers as they come in, and keep your old books for past years. If you want help, book a demo and we will walk through it on your data.',
    },
    {
      q: 'Is my business data safe?',
      a: 'Everything travels over encrypted HTTPS, and role-based access means staff only see what they should. Your customer list and bills are yours — we do not sell them to advertisers. Backups are included on every plan, including Free.',
    },
    {
      q: 'Is there really a free plan?',
      a: 'Yes. The Free plan includes unlimited GST invoices, customers and items, and you can send invoices on WhatsApp from your own number. New accounts also start with a trial of the full product, and no card is needed to begin.',
    },
    {
      q: 'Can Khatario read my supplier bills?',
      a: 'Yes. Take a photo or upload the PDF of a supplier bill (JPG, PNG or PDF, up to 10 MB). Khatario reads the supplier, GSTIN, bill number, date, items with HSN, quantity, rate and GST, and opens the purchase entry filled in for you to check and save.',
    },
    {
      q: 'What can the Khatario AI do?',
      a: 'It reads supplier bills into purchase entries, answers questions about your business in plain words ("How was sale today?", "Who owes me the most?", "Low stock") in the app or on WhatsApp, and on Khatario Connect it replies to customers on WhatsApp from your item list.',
    },
    {
      q: 'Can I sell online with Khatario?',
      a: 'Yes. Your items become an online store with your name, using one of the [store themes](/themes). Each order turns into a GST tax invoice, and online orders hold stock so you never sell the same pack twice.',
    },
    {
      q: 'Can I send offers to my customers on WhatsApp?',
      a: 'Bills, statements and payment reminders go out free from your own number. For festival offers, a shared team inbox and AI replies, Khatario Connect uses the official WhatsApp Business API on your own Meta account, and you pay Meta directly with no markup from us.',
    },
    {
      q: 'Do you charge a markup on WhatsApp messages?',
      a: 'No. Khatario Connect runs on your own WhatsApp Business account with Meta, so Meta bills you directly for messages at its own rates. Many WhatsApp tools resell messages with their own margin added; we add nothing on top. You pay Khatario only the fixed Connect plan fee.',
    },
    {
      q: 'Can I track staff attendance and salary?',
      a: 'Yes. Staff check in from their own phone at the shop; location, shop Wi-Fi and the device are checked so fake GPS does not work. Salary is worked out from attendance and leave. HR Lite for up to 30 staff comes with every Billing plan.',
    },
    {
      q: 'Can my staff and other branches use it too?',
      a: 'Yes. Growth includes up to 3 users. Business includes up to 10 users and up to 3 branches, each with their own login and permissions.',
    },
  ],
};

/** Plain text for search-engine data: strips the markdown markers used in answers. */
function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function LandingFaq(props: Partial<LandingFaqContent> = {}) {
  const c = withDefaults(LANDING_FAQ_DEFAULTS, props);
  const items = c.items.filter((f) => f.q && f.a);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: plainText(a) },
    })),
  };

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 2xl:py-24" aria-labelledby="landing-faq-heading">
      {items.length > 0 && (
        <script
          type="application/ld+json"
          // JSON.stringify output with "<" escaped cannot break out of the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <div className={`${LANDING_PAGE_GUTTER} grid gap-10 lg:grid-cols-12 lg:gap-16`}>
        <div className={`${LANDING_SECTION_INTRO} lg:col-span-4`}>
          <h2
            id="landing-faq-heading"
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl"
          >
            {c.heading}
          </h2>
          {c.intro && (
            <p className={LANDING_INTRO_SUBTEXT}>
              <SafeMarkdown inline text={c.intro} />
            </p>
          )}
        </div>

        <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50/60 lg:col-span-8">
          {items.map(({ q, a }, i) => (
            <details key={`${q}-${i}`} className="group px-5 sm:px-6 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-slate-900 sm:text-lg">
                {q}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <SafeMarkdown text={a} className="-mt-1 pb-5 leading-relaxed text-slate-600 2xl:text-lg" />
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
