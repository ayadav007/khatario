'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Phone, Loader2, ArrowRight, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Toast, ToastType } from '@/components/ui/Toast';

export default function AttendanceLoginPage() {
  const router = useRouter();
  const { business } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) {
      setToast({ message: 'Business not found', type: 'error' });
      return;
    }

    if (!phone || phone.length < 10) {
      setToast({ message: 'Please enter a valid phone number', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/attendance/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          business_id: business.id,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setOtpSent(true);
        setStep('otp');
        // In development, show OTP in toast
        if (data.otp) {
          setToast({ message: `OTP: ${data.otp} (Dev mode)`, type: 'success' });
        } else {
          setToast({ message: 'OTP sent to your phone', type: 'success' });
        }
      } else {
        setToast({ message: data.error || 'Failed to send OTP', type: 'error' });
      }
    } catch (error) {
      console.error('Error sending OTP:', error);
      setToast({ message: 'Failed to send OTP. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) {
      setToast({ message: 'Business not found', type: 'error' });
      return;
    }

    if (!otp || otp.length !== 6) {
      setToast({ message: 'Please enter a valid 6-digit OTP', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/attendance/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          otp_code: otp,
          business_id: business.id,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Store session token in localStorage
        localStorage.setItem('attendance_session_token', data.session_token);
        localStorage.setItem('attendance_employee', JSON.stringify(data.employee));
        localStorage.setItem('attendance_session_expires', data.expires_at);

        setToast({ message: 'Login successful', type: 'success' });
        
        // Redirect to kiosk or mobile attendance
        setTimeout(() => {
          router.push('/attendance/kiosk');
        }, 500);
      } else {
        setToast({ message: data.error || 'Invalid OTP', type: 'error' });
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      setToast({ message: 'Failed to verify OTP. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = () => {
    setOtp('');
    setOtpSent(false);
    setStep('phone');
  };

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-100px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">Attendance Login</h1>
            <p className="text-sm text-text-secondary">
              {step === 'phone' 
                ? 'Enter your phone number to receive OTP'
                : 'Enter the OTP sent to your phone'}
            </p>
          </div>

          {step === 'phone' ? (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <Input
                label="Phone Number"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="9876543210"
                required
                maxLength={10}
                icon={<Phone className="w-5 h-5" />}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={loading || phone.length < 10}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    Send OTP
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Enter OTP
                </label>
                <Input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                  maxLength={6}
                  className="text-center text-2xl font-mono tracking-widest"
                  autoFocus
                />
                <p className="text-xs text-text-secondary mt-2 text-center">
                  OTP sent to {phone}
                </p>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || otp.length !== 6}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify OTP'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={handleResendOTP}
                disabled={loading}
              >
                Change Phone Number
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs text-center text-text-secondary">
              For full access employees, please use the regular login
            </p>
          </div>
        </Card>

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </AppLayout>
  );
}

