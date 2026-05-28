'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user, loading: authLoading } = useAuth();
  const { isOffline } = useNetworkStatus();
  const redirectTarget = searchParams.get('redirect') || '/dashboard';

  // State-driven: if AuthContext already restored a cached session, go to dashboard.
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(redirectTarget.startsWith('/') ? redirectTarget : '/dashboard');
    }
  }, [user, authLoading, router, redirectTarget]);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'phone' | 'auth'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

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
        setError("You're offline — sign-in needs internet.");
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
            ? "You're offline. Please check your connection and try again."
            : msg || 'Login failed'
        );
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md" padding="lg">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
            <span className="text-white font-bold text-2xl">KB</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Khatario</h1>
          <p className="text-text-secondary text-sm">Sign in to your business</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
          className="space-y-4"
        >
          {sessionNotice && (
            <div
              className="p-3 bg-amber-50 text-amber-900 text-sm rounded-md border border-amber-200"
              role="status"
            >
              {sessionNotice}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>
          )}

          <div className={step === 'phone' ? 'block' : 'hidden'}>
            <Input
              type="tel"
              label="Phone Number"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {step === 'auth' && (
            <>
              <Input
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

          <Button type="submit" className="w-full" isLoading={loading}>
            {step === 'phone' ? 'Continue' : 'Login'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-text-secondary">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-primary-500 hover:text-primary-600 font-medium">
              Create a new account
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
