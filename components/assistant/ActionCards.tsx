'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { addDays, format } from 'date-fns';
import { ArrowRight, CalendarDays, CheckCircle2, Loader2, Sparkles, UserRound } from 'lucide-react';
import { PublicWhatsAppOtp } from '@/components/auth/PublicWhatsAppOtp';
import type { AssistantAction, AssistantChannel } from './useAssistantChat';

interface CardContext {
  base: string;
  channel: AssistantChannel;
  conversationId: string | null;
  onDone: (note: string) => void;
  onAction: (action: AssistantAction) => void;
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const primaryBtn =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50';

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

async function postAction(ctx: CardContext, payload: Record<string, unknown>) {
  const res = await fetch(`${ctx.base}/action?channel=${ctx.channel}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, conversationId: ctx.conversationId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong.');
  return data as Record<string, unknown>;
}

interface Slot {
  id: string;
  start_time: string;
  end_time: string;
}

function slotLabel(slot: Slot) {
  const start = new Date(`2000-01-01T${slot.start_time}`);
  return format(start, 'h:mm a');
}

export function DemoBookingCard(ctx: CardContext) {
  const minDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const maxDate = format(addDays(new Date(), 60), 'yyyy-MM-dd');
  const [step, setStep] = useState<'details' | 'otp' | 'saving'>('details');
  const [date, setDate] = useState(minDate);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '' });
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setSlot(null);
    fetch(`/api/bookings/available-slots?date=${date}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots?: Slot[] }) => !cancelled && setSlots(d.slots ?? []))
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const phone10 = form.phone.replace(/\D/g, '').slice(-10);
  const detailsValid =
    Boolean(slot) && form.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && /^[6-9]\d{9}$/.test(phone10);

  const onVerified = useCallback(
    async (ok: boolean) => {
      setVerified(ok);
      if (!ok || !slot) return;
      setStep('saving');
      setError('');
      try {
        const res = await fetch('/api/bookings/create', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            phone: phone10,
            company_name: form.company.trim() || null,
            scheduled_date: date,
            scheduled_time: slot.start_time,
            time_slot_id: slot.id,
            lead_source: 'assistant',
            message: 'Booked via Khatario assistant',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not book the demo.');
        const booking = data.booking as { id: string; booking_number: string };
        await postAction(ctx, { type: 'link_booking', bookingId: booking.id }).catch(() => undefined);
        ctx.onDone(
          `Your demo is booked for ${format(new Date(`${date}T00:00:00`), 'EEE, d MMM')} at ${slotLabel(slot)}. Booking number: ${booking.booking_number}. The Khatario team will call you on +91 ${phone10}.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not book the demo.');
        setStep('details');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slot, form, date, phone10],
  );

  if (step === 'otp' || step === 'saving') {
    return (
      <Card icon={<CalendarDays className="h-4 w-4 text-primary-600" />} title="Verify your WhatsApp number">
        {step === 'saving' ? (
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Booking your demo…
          </p>
        ) : (
          <div className="-mx-3 [&>div]:max-w-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:px-3 [&>div]:py-2 [&>div]:shadow-none">
            <PublicWhatsAppOtp purpose="demo_booking" phone={phone10} verified={verified} onVerified={onVerified} autoSend onCancel={() => setStep('details')} />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card icon={<CalendarDays className="h-4 w-4 text-primary-600" />} title="Book a free demo">
      <div className="space-y-2">
        <input type="date" className={inputCls} min={minDate} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Demo date" />
        <div className="flex flex-wrap gap-1.5">
          {slots == null ? (
            <span className="text-xs text-slate-500">Loading times…</span>
          ) : slots.length === 0 ? (
            <span className="text-xs text-slate-500">No free times on this day. Try another date.</span>
          ) : (
            slots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlot(s)}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                  slot?.id === s.id
                    ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200'
                    : 'border-slate-200 text-slate-700 hover:border-primary-300 dark:border-slate-600 dark:text-slate-200'
                }`}
              >
                {slotLabel(s)}
              </button>
            ))
          )}
        </div>
        <input className={inputCls} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        <input className={inputCls} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
        <input className={inputCls} placeholder="WhatsApp number (10 digits)" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
        <input className={inputCls} placeholder="Business name (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} autoComplete="organization" />
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button type="button" className={primaryBtn} disabled={!detailsValid} onClick={() => setStep('otp')}>
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}

export function TalkToHumanCard(ctx: CardContext) {
  const [form, setForm] = useState({ name: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = form.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, '').slice(-10));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await postAction(ctx, {
        type: 'capture_lead',
        lead: { name: form.name.trim(), phone: form.phone, note: form.note.trim() || undefined, handoff: true },
      });
      ctx.onDone('Thanks! The Khatario team will contact you shortly on WhatsApp or phone.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon={<UserRound className="h-4 w-4 text-primary-600" />} title="Talk to the Khatario team">
      <div className="space-y-2">
        <input className={inputCls} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        <input className={inputCls} placeholder="Mobile number (10 digits)" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
        <textarea className={`${inputCls} resize-none`} rows={2} placeholder="What would you like help with? (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} />
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button type="button" className={primaryBtn} disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Request a call back
        </button>
      </div>
    </Card>
  );
}

const INVOICE_BANDS = [
  { label: 'Up to 20', value: 20 },
  { label: '21–100', value: 100 },
  { label: '101–500', value: 500 },
  { label: '500+', value: 2000 },
];
const NEEDS: Array<{ id: string; label: string; product: 'billing' | 'hr' }> = [
  { id: 'gst_reports', label: 'GST returns', product: 'billing' },
  { id: 'accounting', label: 'Accounting', product: 'billing' },
  { id: 'online_store', label: 'Online store', product: 'billing' },
  { id: 'payment_links', label: 'Online payments', product: 'billing' },
  { id: 'payroll', label: 'Payroll', product: 'hr' },
  { id: 'leave', label: 'Leave management', product: 'hr' },
];

interface Recommendation {
  planId: string;
  displayName: string;
  priceMonthly: number;
  priceYearly: number;
  reasons: string[];
  unmet: string[];
  trialUrl: string;
}

export function RecommendPlanCard(ctx: CardContext) {
  const [product, setProduct] = useState<'billing' | 'hr' | 'whatsapp'>('billing');
  const [invoices, setInvoices] = useState(100);
  const [users, setUsers] = useState(1);
  const [branches, setBranches] = useState(1);
  const [employees, setEmployees] = useState(10);
  const [needs, setNeeds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rec, setRec] = useState<Recommendation | null>(null);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await postAction(ctx, {
        type: 'recommend_plan',
        answers: { product, invoicesPerMonth: invoices, users, branches, employees, needs: needs.filter((n) => NEEDS.find((x) => x.id === n)?.product === product) },
      });
      setRec(data.recommendation as Recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (rec) {
    const price = rec.priceMonthly
      ? `₹${rec.priceMonthly.toLocaleString('en-IN')}/month${rec.priceYearly ? ` or ₹${rec.priceYearly.toLocaleString('en-IN')}/year` : ''}`
      : 'Free';
    return (
      <Card icon={<Sparkles className="h-4 w-4 text-primary-600" />} title={`Suggested: ${rec.displayName}`}>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{price}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {rec.unmet.length ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Not available on any plan today: {rec.unmet.join(', ')}.</p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href={rec.trialUrl} className={primaryBtn}>
            Start free trial
          </Link>
          <button
            type="button"
            className="rounded-lg border border-primary-600 px-3 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/40"
            onClick={() => ctx.onAction({ type: 'book_demo' })}
          >
            Book a demo
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card icon={<Sparkles className="h-4 w-4 text-primary-600" />} title="Find your plan">
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-3 gap-1.5">
          {(['billing', 'hr', 'whatsapp'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProduct(p)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                product === p ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200' : 'border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200'
              }`}
            >
              {p === 'billing' ? 'Billing' : p === 'hr' ? 'HR' : 'WhatsApp'}
            </button>
          ))}
        </div>
        {product === 'billing' ? (
          <>
            <label className="block text-xs text-slate-600 dark:text-slate-300">
              Invoices per month
              <select className={`${inputCls} mt-1`} value={invoices} onChange={(e) => setInvoices(Number(e.target.value))}>
                {INVOICE_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-slate-600 dark:text-slate-300">
                People using it
                <input type="number" min={1} max={500} className={`${inputCls} mt-1`} value={users} onChange={(e) => setUsers(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="block text-xs text-slate-600 dark:text-slate-300">
                Branches
                <input type="number" min={1} max={100} className={`${inputCls} mt-1`} value={branches} onChange={(e) => setBranches(Math.max(1, Number(e.target.value) || 1))} />
              </label>
            </div>
          </>
        ) : null}
        {product === 'hr' ? (
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Number of employees
            <input type="number" min={1} max={10000} className={`${inputCls} mt-1`} value={employees} onChange={(e) => setEmployees(Math.max(1, Number(e.target.value) || 1))} />
          </label>
        ) : null}
        {product !== 'whatsapp' ? (
          <div className="flex flex-wrap gap-1.5">
            {NEEDS.filter((n) => n.product === product).map((n) => {
              const on = needs.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setNeeds(on ? needs.filter((x) => x !== n.id) : [...needs, n.id])}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200'
                  }`}
                >
                  {n.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Suggest a plan
        </button>
      </div>
    </Card>
  );
}

export function LinkCard({ title, href, cta }: { title: string; href: string; cta: string }) {
  return (
    <Card icon={<CheckCircle2 className="h-4 w-4 text-primary-600" />} title={title}>
      <Link href={href} className={primaryBtn}>
        {cta} <ArrowRight className="h-4 w-4" />
      </Link>
    </Card>
  );
}

export function ActionCard({ action, ...ctx }: CardContext & { action: AssistantAction }) {
  switch (action.type) {
    case 'book_demo':
      return <DemoBookingCard {...ctx} />;
    case 'talk_to_human':
      return <TalkToHumanCard {...ctx} />;
    case 'recommend_plan':
      return <RecommendPlanCard {...ctx} />;
    case 'start_trial':
      return <LinkCard title="Try Khatario free for 30 days" href={action.url} cta="Start free trial" />;
    case 'upgrade':
      return <LinkCard title="Compare plans" href={action.url} cta="Open Plan & billing" />;
    default:
      return null;
  }
}
