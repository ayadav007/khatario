'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Calendar,
  Clock,
  User,
  Mail,
  Phone,
  Building,
  MessageSquare,
  CheckCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  Check,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { format, addDays, startOfToday } from 'date-fns';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

interface TimeSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  max_bookings_per_slot: number;
}

const DEMO_BENEFITS = [
  'A live walkthrough tailored to your business — retail, wholesale, or services.',
  'See GST invoicing, inventory, and reports in one workflow, not scattered tools.',
  'Get answers from our team on setup, migration, and what to turn on first.',
  'Leave with a clear picture of time saved at the counter and in accounts.',
];

export default function BookDemoPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company_name: '',
    message: '',
    scheduled_date: '',
    scheduled_time: '',
    time_slot_id: '',
    lead_source: 'organic',
  });
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [bookingNumber, setBookingNumber] = useState('');

  const minDate = format(addDays(startOfToday(), 1), 'yyyy-MM-dd');
  const maxDate = format(addDays(startOfToday(), 60), 'yyyy-MM-dd');

  useEffect(() => {
    if (formData.scheduled_date) {
      fetchAvailableSlots(formData.scheduled_date);
    } else {
      setAvailableSlots([]);
      setFormData((prev) => ({ ...prev, scheduled_time: '', time_slot_id: '' }));
    }
  }, [formData.scheduled_date]);

  const fetchAvailableSlots = async (date: string) => {
    setLoadingSlots(true);
    setError('');
    try {
      const res = await fetch(`/api/bookings/available-slots?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableSlots(data.slots || []);
        if (data.slots.length === 0) {
          setError('No available time slots for this date. Please select another date.');
        }
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to load available slots');
      }
    } catch {
      setError('Failed to load available time slots');
    } finally {
      setLoadingSlots(false);
    }
  };

  const formatTimeSlot = (slot: TimeSlot) => {
    const start = new Date(`2000-01-01T${slot.start_time}`);
    const end = new Date(`2000-01-01T${slot.end_time}`);
    return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        setBookingNumber(data.booking?.booking_number || '');
        setSuccess(true);
        setTimeout(() => {
          router.push('/');
        }, 5000);
      } else {
        setError(data.error || 'Failed to create booking');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <MarketingSiteHeader />
        <div className={`${LANDING_PAGE_GUTTER} flex min-h-[60vh] items-center justify-center py-16`}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
              <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Booking confirmed</h1>
            <p className="mt-2 text-slate-600 dark:text-slate-300">Your demo booking has been successfully created.</p>
            <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="text-sm text-slate-500 dark:text-slate-400">Booking number</p>
              <p className="text-xl font-bold text-primary-600 dark:text-primary-400">{bookingNumber}</p>
            </div>
            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
              We&apos;ll send you a confirmation email shortly. Redirecting to the homepage…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <MarketingSiteHeader />

      <div className={`${LANDING_PAGE_GUTTER} py-10 lg:py-14 xl:py-16`}>
        <div className="grid gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-12 xl:gap-16 2xl:gap-20">
          {/* Left: visual + persuasion — fills same row height as form column on lg+ */}
          <div className="order-2 flex h-full min-h-0 flex-col gap-8 lg:order-1 lg:gap-8">
            {/* Tall hero band; width uses full left column on lg+ */}
            <div className="relative mx-auto h-72 w-full max-w-xl shrink-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-200 shadow-lg dark:border-slate-700 sm:h-80 sm:max-w-2xl md:h-96 md:max-w-3xl lg:mx-0 lg:h-[26rem] lg:max-w-none xl:h-[30rem] 2xl:h-[34rem]">
              <Image
                src="/images/book-demo-hero.png"
                alt="Professional working with invoicing and business data on dual monitors"
                fill
                className="object-cover object-center"
                sizes="(max-width: 1024px) 90vw, 45vw"
                priority
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col justify-between gap-8">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
                  Personalised demo
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl lg:text-[2.25rem] lg:leading-tight xl:text-5xl xl:leading-tight">
                  Run your billing day like this — calm, fast, and under control
                </h1>
                <p className="mt-4 text-lg leading-relaxed text-slate-600 dark:text-slate-300 sm:text-xl">
                  Book a short session and we&apos;ll show you how Khatario fits your counters, your accounts, and your
                  GST workflow — so you spend less time on paperwork and more on the business.
                </p>

                <ul className="mt-8 space-y-4">
                  {DEMO_BENEFITS.map((line) => (
                    <li
                      key={line}
                      className="flex gap-3 text-base leading-relaxed text-slate-700 dark:text-slate-300 sm:text-lg"
                    >
                      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-primary-700 dark:bg-slate-800/50 dark:text-primary-300">
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" aria-hidden />
                  <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">No pressure — just clarity.</span>{' '}
                    Pick a slot that works for you; we&apos;ll confirm by email and join you on time.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: form — column matches left height; card grows to fill */}
          <div className="order-1 flex h-full min-h-0 flex-col lg:order-2">
            <div className="mb-6 shrink-0 text-center lg:mb-8 lg:text-left">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50 sm:text-3xl">Book a demo</h2>
              <p className="mt-2 text-lg text-slate-600 dark:text-slate-300">
                Share a few details and choose a time — we&apos;ll handle the rest.
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:p-8 lg:p-10">
              <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-8">
                <div className="shrink-0 space-y-5">
                  <h3 className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    <User className="h-6 w-6 text-primary-600 dark:text-primary-400" aria-hidden />
                    Your information
                  </h3>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={inputClass}
                        placeholder="John Doe"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Email *
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
                        <input
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className={`${inputClass} pl-11`}
                          placeholder="john@example.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Phone *
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
                        <input
                          type="tel"
                          required
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className={`${inputClass} pl-11`}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Company name
                      </label>
                      <div className="relative">
                        <Building
                          className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          type="text"
                          value={formData.company_name}
                          onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                          className={`${inputClass} pl-11`}
                          placeholder="Your company"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Additional message
                      </label>
                      <div className="relative">
                        <MessageSquare className="absolute left-3.5 top-3 h-5 w-5 text-slate-400" aria-hidden />
                        <textarea
                          value={formData.message}
                          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                          className={`${inputClass} min-h-[100px] resize-y pl-11 pt-3`}
                          rows={3}
                          placeholder="Tell us what you'd like to see in the demo..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 space-y-5 border-t border-slate-200 pt-8 dark:border-slate-700">
                  <h3 className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    <Calendar className="h-6 w-6 text-primary-600 dark:text-primary-400" aria-hidden />
                    Schedule your demo
                  </h3>

                  <div>
                    <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                      Preferred date *
                    </label>
                    <input
                      type="date"
                      required
                      min={minDate}
                      max={maxDate}
                      value={formData.scheduled_date}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          scheduled_date: e.target.value,
                          scheduled_time: '',
                          time_slot_id: '',
                        })
                      }
                      className={inputClass}
                    />
                  </div>

                  {formData.scheduled_date && (
                    <div>
                      <label className="mb-1.5 block text-base font-medium text-slate-700 dark:text-slate-300">
                        Available time slots *
                      </label>
                      {loadingSlots ? (
                        <div className="flex justify-center py-10">
                          <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-hidden />
                        </div>
                      ) : availableSlots.length > 0 ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {availableSlots.map((slot) => (
                            <button
                              key={slot.id}
                              type="button"
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  time_slot_id: slot.id,
                                  scheduled_time: slot.start_time,
                                });
                              }}
                              className={`rounded-xl border-2 p-3 text-sm font-medium transition-all sm:text-base ${
                                formData.time_slot_id === slot.id
                                  ? 'border-primary-600 bg-slate-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200'
                                  : 'border-slate-200 text-slate-700 hover:border-primary-300 dark:border-slate-600 dark:text-slate-200'
                              }`}
                            >
                              <Clock className="mb-1 inline-block h-4 w-4" aria-hidden />
                              <br />
                              {formatTimeSlot(slot)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="py-6 text-center text-base text-slate-500">No available slots for this date</p>
                      )}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="flex shrink-0 items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                    <p className="text-base text-red-800 dark:text-red-200">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !formData.scheduled_time}
                  className="mt-auto flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none dark:disabled:bg-slate-600"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      Creating booking…
                    </>
                  ) : (
                    'Confirm booking'
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
