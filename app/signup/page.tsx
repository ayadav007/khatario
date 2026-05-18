'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  User,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';

const fieldShell =
  '[&_input]:rounded-lg [&_input]:border-slate-200 [&_input]:bg-white [&_input]:py-3 [&_input]:shadow-none ' +
  'dark:[&_input]:border-slate-600 dark:[&_input]:bg-slate-900';

const selectClassName = clsx(
  'w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900',
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
);

const labelClass =
  'mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200';

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    businessName: '',
    businessEmail: '',
    businessPhone: '',
    businessType: '',
    industry: '',
    businessModel: '',
    userName: '',
    userPhone: '',
    password: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        // Required so the browser stores Set-Cookie from the signup response (session JWTs).
        credentials: 'same-origin',
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Signup failed');
      }

      // Full page navigation (not client-side router.push): guarantees the next document
      // load sends the new httpOnly session cookies. router.push alone can skip a full
      // reload and left some users stuck on /signup after a successful 201.
      // /api/signup already sets JWT cookies — user is logged in; /login will redirect
      // to /dashboard once /api/auth/session hydrates AuthContext.
      window.location.assign('/login?registered=true');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const benefits = [
    'Create GST-ready invoices, estimates, and e-way aligned documents',
    'Manage customers, suppliers, items, and stock in one place',
    'Multi-branch and roles when your team grows',
    'Purchase bills, expenses, and payment tracking built in',
    'Reports for sales, GST, and inventory at a glance',
    'WhatsApp and email options for faster collections',
    'Secure cloud access—work from office or field',
    'Start with a free trial, then stay on Free or upgrade anytime',
  ];

  /** Wide shell: use horizontal space on large monitors (not a skinny centered column). */
  const pageShell =
    'mx-auto w-full max-w-[1800px] px-4 sm:px-6 md:px-10 lg:px-14 xl:px-16 2xl:px-20';

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top bar — Exotel-style */}
      <header className="border-b border-slate-100 dark:border-slate-800">
        <div className={clsx(pageShell, 'flex items-center justify-between py-4')}>
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-primary-600 dark:text-primary-400">
              Khatario
            </span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span className="hidden sm:inline">Already have an account?</span>
            <Link
              href="/login"
              className="rounded-md border border-primary-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-600 transition hover:bg-slate-50 dark:border-primary-400 dark:text-primary-400 dark:hover:bg-primary-900/50"
            >
              Log in
            </Link>
          </div>
        </div>
      </header>

      <main className={clsx(pageShell, 'pb-16 pt-10 lg:pb-20 lg:pt-14')}>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:gap-20 2xl:gap-24">
          {/* Left — value prop */}
          <div className="order-2 flex min-w-0 flex-col justify-center lg:order-1">
            <h1 className="text-2xl font-bold leading-tight text-slate-900 dark:text-white sm:text-3xl xl:text-4xl xl:leading-tight">
              What can you do with Khatario?
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400 sm:text-base lg:text-lg">
              Everything you need to run billing and operations for an Indian business—without juggling
              five different tools.
            </p>
            <ul className="mt-8 min-w-0 space-y-3.5">
              {benefits.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-snug text-slate-700 dark:text-slate-300 sm:text-[15px]">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white"
                    aria-hidden
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {/* Light illustration block — soft abstract workspace feel */}
            <div
              className="relative mt-10 hidden min-h-[200px] w-full max-w-2xl overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-slate-50/40 to-indigo-50/60 p-8 dark:from-slate-900 dark:via-primary-900/30 dark:to-slate-900 lg:block xl:max-w-none"
              aria-hidden
            >
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary-200/40 blur-2xl dark:bg-primary-800/20" />
              <div className="absolute -bottom-4 left-1/4 h-24 w-24 rounded-full bg-indigo-200/30 blur-xl dark:bg-indigo-900/20" />
              <div className="relative flex items-end justify-center gap-2 pt-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/90 shadow-sm dark:bg-slate-800/90">
                  <Building2 className="h-7 w-7 text-primary-500" />
                </div>
                <div className="mb-1 flex gap-1">
                  <span className="h-10 w-8 rounded-md bg-white/80 dark:bg-slate-700/80" />
                  <span className="h-12 w-8 rounded-md bg-slate-100/90 dark:bg-slate-800/40" />
                  <span className="h-9 w-8 rounded-md bg-white/80 dark:bg-slate-700/80" />
                </div>
              </div>
              <p className="relative mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
                Your team, invoices, and inventory—in one dashboard
              </p>
            </div>
          </div>

          {/* Right — form (full column width on large screens) */}
          <div className="order-1 min-w-0 lg:order-2">
            <div className="mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none xl:pl-4 2xl:pl-8">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl xl:text-4xl">
                Hi there! Let&apos;s get you started
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 sm:text-base">
                Create your account and go live in a couple of minutes.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                  </div>
                )}

                <div className={fieldShell}>
                  <Input
                    label="Business name *"
                    name="businessName"
                    value={formData.businessName}
                    onChange={handleChange}
                    placeholder="Enter company name"
                    icon={<Building2 className="h-4 w-4" strokeWidth={2} />}
                    required
                    autoComplete="organization"
                    className="border-slate-200"
                  />
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className={fieldShell}>
                    <Input
                      label="Business phone (optional)"
                      name="businessPhone"
                      type="tel"
                      value={formData.businessPhone}
                      onChange={handleChange}
                      placeholder="Official number"
                      icon={<Phone className="h-4 w-4" strokeWidth={2} />}
                      autoComplete="tel"
                      className="border-slate-200"
                    />
                  </div>
                  <div className={fieldShell}>
                    <Input
                      label="Business email (optional)"
                      name="businessEmail"
                      type="email"
                      value={formData.businessEmail}
                      onChange={handleChange}
                      placeholder="Enter your email ID"
                      icon={<Mail className="h-4 w-4" strokeWidth={2} />}
                      autoComplete="email"
                      className="border-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    Business type <span className="text-red-500">*</span>
                  </label>
                  <select name="businessType" value={formData.businessType} onChange={handleChange} className={selectClassName} required>
                    <option value="">Select</option>
                    <option value="retail">Retail</option>
                    <option value="wholesaler">Wholesaler</option>
                    <option value="distributor">Distributor</option>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="service">Service</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>
                    Industry <span className="text-red-500">*</span>
                  </label>
                  <select name="industry" value={formData.industry} onChange={handleChange} className={selectClassName} required>
                    <option value="">Select</option>
                    <option value="pharmaceuticals">Pharmaceuticals</option>
                    <option value="textiles">Textiles</option>
                    <option value="garments">Garments</option>
                    <option value="electronics">Electronics</option>
                    <option value="food_beverages">Food &amp; Beverages</option>
                    <option value="automotive">Automotive</option>
                    <option value="construction">Construction</option>
                    <option value="services">Services</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Business model (optional)</label>
                  <select name="businessModel" value={formData.businessModel} onChange={handleChange} className={selectClassName}>
                    <option value="">Select</option>
                    <option value="b2b">B2B</option>
                    <option value="b2c">B2C</option>
                    <option value="b2b2c">B2B2C</option>
                    <option value="export">Export</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </div>

                <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Your account (admin)
                  </p>
                  <div className={clsx('space-y-5', fieldShell)}>
                    <Input
                      label="Your name *"
                      name="userName"
                      value={formData.userName}
                      onChange={handleChange}
                      placeholder="Enter your name"
                      icon={<User className="h-4 w-4" strokeWidth={2} />}
                      required
                      autoComplete="name"
                      className="border-slate-200"
                    />
                  </div>

                  <div className="mt-5">
                    <label className={labelClass}>
                      Mobile number (login ID) <span className="text-red-500">*</span>
                    </label>
                    <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                      <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        +91
                      </span>
                      <input
                        name="userPhone"
                        type="tel"
                        inputMode="numeric"
                        value={formData.userPhone}
                        onChange={handleChange}
                        placeholder="9876543210"
                        required
                        autoComplete="tel"
                        className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500/30 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="mt-5">
                    <label className={labelClass}>
                      Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-slate-400 dark:text-slate-500"
                        aria-hidden
                      >
                        <Lock className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <input
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="Create a strong password"
                        required
                        autoComplete="new-password"
                        className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="mt-2 w-full rounded-lg py-3.5 text-sm font-semibold uppercase tracking-wide shadow-none"
                  size="lg"
                  isLoading={loading}
                >
                  Start my free trial
                </Button>

                <p className="text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  By clicking the button above, you agree to our{' '}
                  <Link href="/terms" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </form>

              <p className="mt-8 text-center text-sm text-slate-600 lg:hidden dark:text-slate-400">
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-primary-600 dark:text-primary-400">
                  Log in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
