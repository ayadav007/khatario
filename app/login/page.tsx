'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import Link from 'next/link';
import { FileText, MessageCircle, Users } from 'lucide-react';
import {
  isConnectAgentSeat,
  resolveHomePathForUser,
} from '@/lib/users/connect-seats';

const SHOP_POINTS = [
  { icon: FileText, label: 'GST bills and estimates' },
  { icon: Users, label: 'Customer and supplier khata' },
  { icon: MessageCircle, label: 'Collect on WhatsApp' },
] as const;

const loginField = 'min-h-14 rounded-xl px-4 !text-base md:min-h-16 md:!text-lg';
const loginButton = 'w-full !min-h-12 !text-base md:!min-h-14 md:!text-lg';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const { login, user, loading: authLoading, platformSession } = useAuth();
  const { isOffline } = useNetworkStatus();
  const redirectFromQuery = searchParams.get('redirect');
  const defaultHome = resolveHomePathForUser(platformSession, user);
  const redirectTarget =
    redirectFromQuery &&
    redirectFromQuery !== '/dashboard' &&
    !(isConnectAgentSeat(user) && redirectFromQuery.startsWith('/dashboard'))
      ? redirectFromQuery
      : defaultHome;

  // Already signed in (cached session or cookie) → go to app.
  //
  // Guard against a redirect loop: a data-preserving reinstall can leave a stale
  // cached `user` in local storage while the auth cookie is dead. That makes this
  // effect push to /dashboard, which fails to authenticate and bounces back to
  // /login → full-page reload loop (no chance to type). We allow exactly ONE
  // redirect attempt; if we land back on /login within a short window, the
  // session is invalid, so we stay put and let the user sign in again.
  useEffect(() => {
    if (authLoading || !user) return;

    const FLAG = 'khatario_login_redirect_ts';
    const now = Date.now();
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(FLAG) || '0');
    } catch {
      /* sessionStorage unavailable */
    }

    if (last && now - last < 8000) {
      // We just redirected to the app and came right back → dead session.
      try {
        sessionStorage.removeItem(FLAG);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      sessionStorage.setItem(FLAG, String(now));
    } catch {
      /* ignore */
    }

    const target = redirectTarget.startsWith('/') ? redirectTarget : '/dashboard';
    window.location.replace(target);
  }, [user, authLoading, redirectTarget]);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'phone' | 'auth'>('phone');
  const [mode, setMode] = useState<'login' | 'forgot-request' | 'forgot-verify'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reason = new URLSearchParams(window.location.search).get('reason');
    const messages: Record<string, string> = {
      business_deleted:
        'That business is no longer available (it may have been removed). Please sign in with another account or create a new one.',
      user_deleted: 'This login is no longer valid. Please sign in again or register.',
      session_invalid: 'Your session is no longer valid. Please sign in again.',
    };
    if (reason && messages[reason]) {
      setSessionNotice(messages[reason]);
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  const handleContinue = async () => {
    setError('');

    if (step === 'phone') {
      if (!phone) {
        setError('Please enter your phone number');
        return;
      }
      setStep('auth');
    } else {
      if (!password) {
        setError('Please enter password');
        return;
      }

      if (isOffline) {
        setError('No internet connection. Sign-in needs internet.');
        return;
      }

      setLoading(true);

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          if (res.status === 429 && typeof data.retryAfterMs === 'number') {
            const mins = Math.max(1, Math.ceil(data.retryAfterMs / 60000));
            throw new Error(
              data.error ||
                `Too many login attempts. Please wait about ${mins} minute(s) and try again.`
            );
          }
          throw new Error(data.error || 'Login failed');
        }

        await login({ user: data.user, business: data.business });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        setError(
          msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
            ? 'No internet connection. Please check your connection and try again.'
            : msg || 'Login failed'
        );
      } finally {
        setLoading(false);
      }
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!phone || !resetEmail) {
      setError('Enter the login phone number and the email on the account');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, email: resetEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send codes');
      let msg = data.message as string;
      if (data.debugWhatsAppOtp || data.debugEmailOtp) {
        msg += ` (staging WhatsApp ${data.debugWhatsAppOtp || '—'}, email ${data.debugEmailOtp || '—'})`;
      }
      setInfo(msg);
      setMode('forgot-verify');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send codes');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          email: resetEmail,
          whatsappCode,
          emailCode,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reset password');
      setInfo(data.message || 'Password updated. Sign in with your new password.');
      setMode('login');
      setStep('auth');
      setPassword('');
      setWhatsappCode('');
      setEmailCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  const heading = mode === 'login' ? 'Sign in' : 'Reset your password';
  const subheading =
    mode === 'login'
      ? step === 'auth'
        ? `Signing in as ${phone}`
        : 'Use the mobile number on your business account.'
      : 'We send one code on WhatsApp and one to your email. Both are required.';

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] dark:bg-slate-950 lg:grid lg:grid-cols-2">
      <aside className="relative overflow-hidden bg-[#032B23] px-5 py-5 text-white sm:px-8 lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14 xl:px-16">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-[#F58220]/20"
          aria-hidden
        />
        <div className="relative">
          <p className="text-lg font-semibold tracking-tight">Khatario</p>
          <p className="mt-1 text-sm text-white/80 lg:hidden">Sign in to your shop</p>
          <h1 className="mt-16 hidden max-w-md text-4xl font-bold leading-tight lg:block">
            Your shop&apos;s bills, parties, and dues, in one place.
          </h1>
          <ul className="mt-8 hidden space-y-4 lg:block">
            {SHOP_POINTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-base text-white/90">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 hidden text-sm text-white/70 lg:block">
          GST billing for Indian businesses
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-white px-5 py-10 dark:bg-slate-900 sm:px-10 lg:px-16 lg:py-16">
      <div className="w-full max-w-xl [&_label]:!text-base [&_label]:sm:!text-lg">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">{heading}</h2>
          <p className="mt-3 text-base leading-relaxed text-text-secondary sm:text-lg">{subheading}</p>
        </div>

        {mode === 'login' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
          className="space-y-6"
        >
          {sessionNotice && (
            <div
              className="p-3 bg-amber-50 text-amber-900 text-sm rounded-md border border-amber-200"
              role="status"
            >
              {sessionNotice}
            </div>
          )}
          {info && (
            <div className="p-3 bg-green-50 text-green-800 text-sm rounded-md border border-green-200" role="status">
              {info}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>
          )}

          <div className={step === 'phone' ? 'block' : 'hidden'}>
            <Input
              className={loginField}
              inputRef={phoneInputRef}
              type="tel"
              label="Phone Number"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="numeric"
              autoComplete="tel"
              enterKeyHint="next"
              pattern="[0-9]*"
              maxLength={15}
              onPointerDown={() => {
                phoneInputRef.current?.focus();
              }}
            />
          </div>

          {step === 'auth' && (
            <>
              <Input
                className={loginField}
                type="password"
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <div className="flex justify-between items-center text-sm">
                <button
                  type="button"
                  onClick={() => setStep('phone')}
                  className="text-text-secondary hover:text-text-primary"
                >
                  Change Number
                </button>
              </div>
            </>
          )}

          {mode === 'login' && (step === 'auth' || step === 'phone') ? (
            <p className="text-right text-base">
              <button
                type="button"
                className="text-primary-500 hover:text-primary-600 font-medium"
                onClick={() => {
                  setError('');
                  setInfo('');
                  setMode('forgot-request');
                }}
              >
                Forgot password?
              </button>
            </p>
          ) : null}

          {mode === 'login' ? (
          <Button type="submit" size="lg" className={loginButton} isLoading={loading}>
            {step === 'phone' ? 'Continue' : 'Login'}
          </Button>
          ) : null}
        </form>
        ) : null}

        {mode === 'forgot-request' ? (
          <form onSubmit={handleForgotRequest} className="space-y-6">
            {info && (
              <div className="p-3 bg-green-50 text-green-800 text-sm rounded-md border border-green-200">{info}</div>
            )}
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>}
            <Input
              className={loginField}
              type="tel"
              label="Login phone number"
              placeholder="Phone you use to sign in"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="numeric"
              autoComplete="tel"
            />
            <Input
              className={loginField}
              type="email"
              label="Account email"
              placeholder="Email on this business account"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              autoComplete="email"
            />
            <Button type="submit" size="lg" className={loginButton} isLoading={loading}>
              Send WhatsApp and email codes
            </Button>
            <button
              type="button"
              className="w-full text-sm text-text-secondary"
              onClick={() => {
                setMode('login');
                setError('');
                setInfo('');
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : null}

        {mode === 'forgot-verify' ? (
          <form onSubmit={handleForgotVerify} className="space-y-6">
            {info && (
              <div className="p-3 bg-green-50 text-green-800 text-sm rounded-md border border-green-200">{info}</div>
            )}
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>}
            <Input
              className={loginField}
              type="text"
              inputMode="numeric"
              maxLength={6}
              label="WhatsApp code"
              placeholder="6-digit code from WhatsApp"
              value={whatsappCode}
              onChange={(e) => setWhatsappCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <Input
              className={loginField}
              type="text"
              inputMode="numeric"
              maxLength={6}
              label="Email code"
              placeholder="6-digit code from email"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <Input
              className={loginField}
              type="password"
              label="New password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              className={loginField}
              type="password"
              label="Confirm new password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Button type="submit" size="lg" className={loginButton} isLoading={loading}>
              Reset password
            </Button>
            <button
              type="button"
              className="w-full text-sm text-text-secondary"
              onClick={() => {
                setMode('forgot-request');
                setError('');
              }}
            >
              Resend codes
            </button>
          </form>
        ) : null}

        <div className="mt-8 text-center">
          <p className="text-base text-text-secondary">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-primary-500 hover:text-primary-600 font-medium">
              Create a new account
            </Link>
          </p>
        </div>
      </div>
      </main>
    </div>
  );
}
