'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useCandidatePortal } from './CandidatePortalContext';

export function CandidatePortalLoginForm() {
  const { slug, refresh, businessMeta } = useCandidatePortal();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/public/candidate/${encodeURIComponent(slug)}/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        return;
      }
      setInfo(data.message || 'Check your email for the sign-in code.');
      setStep('otp');
    } catch {
      setError('Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/candidate/${encodeURIComponent(slug)}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid code');
        return;
      }
      await refresh();
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-text-primary">Candidate Portal</h1>
          {businessMeta?.name && (
            <p className="mt-1 text-sm text-text-secondary">{businessMeta.name}</p>
          )}
        </div>

        {step === 'email' ? (
          <form onSubmit={requestOtp} className="space-y-4">
            <Input
              label="Work email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-green-700">{info}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send sign-in code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-text-secondary">
              Enter the 6-digit code sent to <strong>{email}</strong>
            </p>
            <Input
              label="Sign-in code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              inputMode="numeric"
              maxLength={6}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-primary-600 hover:text-primary-700"
              onClick={() => setStep('email')}
            >
              Use a different email
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
