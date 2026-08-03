'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from './EmployeePortalContext';

type LoginTab = 'employee_id' | 'phone';
type ForgotStep = 'login' | 'request' | 'reset';

export function EmployeePortalLoginForm() {
  const { slug, refresh, businessMeta } = useEmployeePortal();
  const [tab, setTab] = useState<LoginTab>('employee_id');
  const [step, setStep] = useState<ForgotStep>('login');
  const [employeeCode, setEmployeeCode] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const resetMessages = () => {
    setError(null);
    setInfo(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) {
      setError('Invalid portal link. Open the employee portal from the link your employer shared.');
      return;
    }
    setLoading(true);
    resetMessages();
    const normalizedCode = employeeCode.trim().toUpperCase();
    const normalizedPassword = password
      .trim()
      .replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, '-');
    try {
      const res = await fetch(`/api/public/employee/${encodeURIComponent(slug)}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employee_code: tab === 'employee_id' ? normalizedCode : undefined,
          phone: tab === 'phone' ? phone : undefined,
          password: normalizedPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      await refresh();
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    resetMessages();
    try {
      const res = await fetch(`/api/public/employee/${encodeURIComponent(slug)}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send verification code');
        return;
      }
      setInfo(data.message || 'Verification code sent');
      if (data.dev_otp) {
        setInfo(`${data.message} (dev code: ${data.dev_otp})`);
      }
      setStep('reset');
    } catch {
      setError('Could not send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/public/employee/${encodeURIComponent(slug)}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp_code: otpCode, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not reset password');
        return;
      }
      setInfo(data.message || 'Password updated. Sign in with your new password.');
      setStep('login');
      setPassword('');
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      setTab('phone');
    } catch {
      setError('Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mx-auto w-full">
        {businessMeta?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={businessMeta.logo_url}
            alt=""
            className="mx-auto mb-4 h-14 w-14 rounded-lg object-contain"
          />
        )}
        <h1 className="text-center text-xl font-bold text-text-primary">
          {businessMeta?.name ?? 'Employee portal'}
        </h1>
        {!businessMeta?.name && slug ? (
          <p className="mt-1 text-center text-xs text-amber-700">
            Could not load company details for this link. Confirm the URL with your employer.
          </p>
        ) : null}

        {step === 'login' && (
          <>
            <p className="mb-4 mt-2 text-center text-sm text-text-secondary">
              Sign in to your employee portal
            </p>
            <div className="mb-4 flex rounded-lg border border-border bg-gray-50 p-1">
              <button
                type="button"
                className={`flex-1 rounded-md py-2 text-sm font-medium ${
                  tab === 'employee_id'
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
                onClick={() => {
                  setTab('employee_id');
                  resetMessages();
                }}
              >
                Employee ID
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-2 text-sm font-medium ${
                  tab === 'phone' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'
                }`}
                onClick={() => {
                  setTab('phone');
                  resetMessages();
                }}
              >
                Phone
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {tab === 'employee_id' ? (
                <Input
                  label="Employee ID"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                  autoComplete="username"
                  required
                />
              ) : (
                <IntlPhoneInput
                  label="Phone number"
                  value={phone}
                  onChange={setPhone}
                  required
                  nationalPlaceholder="Registered mobile"
                />
              )}
              <div>
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="mt-1 text-xs link-primary"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'} password
                </button>
              </div>
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              {info && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  {info}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </Button>
            </form>

            <button
              type="button"
              className="mt-4 w-full text-center text-sm link-primary"
              onClick={() => {
                setStep('request');
                resetMessages();
              }}
            >
              Forgot password?
            </button>
          </>
        )}

        {step === 'request' && (
          <Card className="space-y-4 p-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Reset password</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Enter your registered phone number. We&apos;ll send a verification code on WhatsApp.
              </p>
            </div>
            <form onSubmit={handleForgotRequest} className="space-y-4">
              <IntlPhoneInput
                label="Phone number"
                value={phone}
                onChange={setPhone}
                required
                nationalPlaceholder="Registered mobile"
              />
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-text-secondary hover:text-text-primary"
                onClick={() => {
                  setStep('login');
                  resetMessages();
                }}
              >
                Back to sign in
              </button>
            </form>
          </Card>
        )}

        {step === 'reset' && (
          <Card className="space-y-4 p-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Enter verification code</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Enter the code sent to your phone and choose a new password.
              </p>
            </div>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <Input
                label="Verification code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                required
              />
              <Input
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              {info && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  {info}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-text-secondary hover:text-text-primary"
                onClick={() => {
                  setStep('request');
                  resetMessages();
                }}
              >
                Resend code
              </button>
            </form>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-text-secondary">
          Managers with full app access —{' '}
          <Link href="/login" className="link-primary">
            main login
          </Link>
        </p>
      </div>
    </div>
  );
}

export function EmployeePortalUnavailable() {
  const { businessMeta } = useEmployeePortal();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-text-primary">
        {businessMeta?.name ?? 'Employee portal'}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-text-secondary">
        Employee portal is not active for this business. Contact your employer.
      </p>
    </div>
  );
}
