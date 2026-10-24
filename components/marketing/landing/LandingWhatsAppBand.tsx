'use client';

import { clsx } from 'clsx';
import { useEffect, useState, type RefObject } from 'react';
import { BellRing, FileText, MessagesSquare } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { sleep } from '@/components/marketing/landing/LandingMotion';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingWhatsAppBandContent = {
  kicker: string;
  heading: string;
  subtext: string;
  points: { title: string; text: string }[];
};

export const LANDING_WHATSAPP_BAND_DEFAULTS: LandingWhatsAppBandContent = {
  kicker: 'WhatsApp, built in',
  heading: 'Bills where your customers already are.',
  subtext: 'Link your own number with a QR code. Bills, statements and reminders go out from the same screen you bill on.',
  points: [
    { title: 'PDF bill with a UPI link', text: 'Your customer has proof on the phone they already use.' },
    { title: 'Reminders that send themselves', text: 'Polite nudges before and after the due date. Payments land against the right bill.' },
    { title: 'Grow into a team inbox', text: 'Shared inbox, AI replies and a WhatsApp shop when one phone is not enough.' },
  ],
};

const POINT_ICONS = [FileText, BellRing, MessagesSquare];

type Msg = { from: 'me' | 'them' | 'system'; text: string; time?: string; pdf?: string };

const CHAT: Msg[] = [
  { from: 'me', pdf: 'INV-0142.pdf', text: 'Namaste! Your bill for ₹6,098 from Shree Ganesh Traders. Pay by UPI: khatar.io/p/0142', time: '11:02 ✓✓' },
  { from: 'them', text: 'Thank you ji, will pay this week 🙏', time: '11:05' },
  { from: 'me', text: 'Gentle reminder: ₹6,098 for INV-0142 is due on 22 Oct.', time: '22 Oct, 10:00 ✓✓' },
  { from: 'them', text: 'Paid on UPI ✅', time: '10:14' },
  { from: 'system', text: '₹6,098 recorded against INV-0142' },
];

/** Index of the message that shows a typing indicator before it. */
const TYPING_BEFORE = 3;

function WhatsAppChat() {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInViewOnce({ threshold: 0.35 });
  const [shown, setShown] = useState(reduced ? CHAT.length : 0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced) {
      setShown(CHAT.length);
      return;
    }
    if (!inView) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < CHAT.length && !cancelled; i += 1) {
        if (i === TYPING_BEFORE) {
          setTyping(true);
          await sleep(1100);
          if (cancelled) return;
          setTyping(false);
        }
        setShown(i + 1);
        await sleep(i === 1 ? 900 : 750);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, reduced]);

  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="mx-auto w-full max-w-[22rem] rounded-[2.4rem] bg-[#0b141a] p-2.5 shadow-2xl shadow-black/40">
      <div className="overflow-hidden rounded-[1.9rem] bg-[#efeae2]">
        <div className="flex items-center gap-2.5 bg-[#075E54] px-4 py-3.5 text-white">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#25a18e] text-sm font-bold">S</span>
          <span className="text-sm font-semibold leading-tight">
            Sharma &amp; Sons
            <span className="block text-[11px] font-normal opacity-75">online</span>
          </span>
        </div>
        <div className="flex min-h-[24rem] flex-col gap-2 px-3 py-4 text-[13.5px] text-[#111b21]">
          {CHAT.map((m, i) => (
            <div
              key={i}
              className={clsx(
                'max-w-[85%] rounded-xl px-2.5 py-2 leading-snug shadow-sm transition-all duration-500 ease-out motion-reduce:transition-none',
                m.from === 'me' && 'self-end bg-[#d9fdd3]',
                m.from === 'them' && 'self-start bg-white',
                m.from === 'system' && 'self-center bg-[#fff7d6] text-xs text-[#54656f]',
                i < shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
              )}
            >
              {m.pdf && (
                <span className="mb-1.5 flex items-center gap-2 rounded-lg bg-black/5 p-2 text-[13px] font-semibold">
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">PDF</span>
                  {m.pdf}
                </span>
              )}
              {m.text}
              {m.time && <span className="mt-0.5 block text-right text-[10.5px] text-[#667781]">{m.time}</span>}
            </div>
          ))}
          {typing && (
            <span className="flex gap-1 self-start rounded-xl bg-white px-3 py-2.5" aria-label="Typing">
              {[0, 1, 2].map((d) => (
                <span key={d} className="landing-typing-dot h-1.5 w-1.5 rounded-full bg-[#8696a0]" style={{ animationDelay: `${d * 150}ms` }} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function LandingWhatsAppBand(props: Partial<LandingWhatsAppBandContent> = {}) {
  const c = withDefaults(LANDING_WHATSAPP_BAND_DEFAULTS, props);
  return (
    <section id="whatsapp" className="relative scroll-mt-24 overflow-hidden bg-primary-600 py-20 text-white 2xl:py-28">
      <div className="landing-glow landing-glow-orange pointer-events-none absolute -right-40 -top-40 h-[36rem] w-[36rem] opacity-70" aria-hidden />
      <div className={`${LANDING_PAGE_GUTTER} relative grid items-center gap-14 lg:grid-cols-[1fr_0.9fr]`}>
        <div>
          <LandingReveal>
            {c.kicker && <p className="landing-kicker landing-kicker-light">{c.kicker}</p>}
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
            {c.subtext && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-primary-100 2xl:text-xl">{c.subtext}</p>}
          </LandingReveal>
          <ul className="mt-9 space-y-5">
            {c.points.map((p, i) => {
              const Icon = POINT_ICONS[i % POINT_ICONS.length];
              return (
                <LandingReveal as="li" key={`${p.title}-${i}`} delay={i * 80} className="grid grid-cols-[2.75rem_1fr] gap-4">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-accent-200">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-lg font-bold">{p.title}</span>
                    <span className="block text-[15.5px] text-primary-100">{p.text}</span>
                  </span>
                </LandingReveal>
              );
            })}
          </ul>
        </div>
        <LandingReveal delay={120}>
          <WhatsAppChat />
        </LandingReveal>
      </div>
    </section>
  );
}
