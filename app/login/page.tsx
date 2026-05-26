'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user, loading: authLoading } = useAuth();
  const isOfflineBootstrap = searchParams.get('khatario_offline_bootstrap') === '1';

  // Redirect to dashboard if already logged in (e.g. restored from offline auth)
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, authLoading, router]);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState(''); // Reusing otp state for password/otp
  const [usePassword, setUsePassword] = useState(true); // Default to password login
  const [step, setStep] = useState<'phone' | 'auth'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Explain forced logout (e.g. business deleted in DB while JWT still valid)
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
      // Simple validation or check if user exists could happen here
      setStep('auth');
    } else {
      // Handle login
      if (!password) {
        setError(usePassword ? 'Please enter password' : 'Please enter OTP');
        return;
      }

      // Offline: can't verify credentials without the server
      if (!navigator.onLine) {
        setError(
          "You're offline. Sign in when you're back online. If you've used this app on this device before, open it while online first to enable offline access."
        );
        return;
      }

      setLoading(true);
      
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            phone, 
            password // We are sending 'password' field even if UI says OTP for now
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        await login({ user: data.user, business: data.business });
      } catch (err: any) {
        const msg = err?.message || '';
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

  if (isOfflineBootstrap && authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center" padding="lg">
          <p className="text-text-primary font-medium">Opening Khatario offline…</p>
          <p className="mt-2 text-sm text-text-secondary">
            Restoring your last session from this device.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md" padding="lg">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
            <span className="text-white font-bold text-2xl">KB</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Khatario</h1>
          <p className="text-text-secondary text-sm">Sign in to your business</p>
        </div>

        {/* Form */}
        <form onSubmit={(e) => { e.preventDefault(); handleContinue(); }} className="space-y-4">
          {sessionNotice && (
            <div
              className="p-3 bg-amber-50 text-amber-900 text-sm rounded-md border border-amber-200"
              role="status"
            >
              {sessionNotice}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md">
              {error}
            </div>
          )}

          <div className={step === 'phone' ? 'block' : 'hidden'}>
            <Input
              type="tel"
              label="Phone Number"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              // required - removed to handle custom validation
            />
          </div>

          {step === 'auth' && (
            <>
              {usePassword ? (
                <Input
                  type="password"
                  label="Password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              ) : (
                <Input
                  type="text"
                  label="OTP"
                  placeholder="Enter OTP (Use password for now)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={6}
                  autoFocus
                />
              )}
              
              <div className="flex justify-between items-center text-sm">
                 <button
                  type="button"
                  onClick={() => setStep('phone')}
                  className="text-text-secondary hover:text-text-primary"
                >
                  Change Number
                </button>
                
                {/* 
                <button
                  type="button"
                  onClick={() => setUsePassword(!usePassword)}
                  className="text-primary-500 hover:text-primary-600"
                >
                  {usePassword ? 'Use OTP instead' : 'Use password instead'}
                </button>
                */}
              </div>
            </>
          )}

          <Button type="submit" className="w-full" isLoading={loading}>
            {step === 'phone' ? 'Continue' : 'Login'}
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-text-secondary">
            Don't have an account?{' '}
            <Link href="/signup" className="text-primary-500 hover:text-primary-600 font-medium">
              Create a new account
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
