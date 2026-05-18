'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { X } from 'lucide-react';

const DISMISS_KEY = 'profile_banner_dismissed';

function getColorScheme(pct: number) {
  if (pct >= 80) return {
    bg: 'bg-gradient-to-r from-slate-50 to-accent-50',
    border: 'border-primary-200',
    badge: 'bg-primary-600',
    bar: 'bg-primary-500',
    barTrack: 'bg-slate-100',
    text: 'text-primary-900',
    btn: 'bg-primary-600 hover:bg-primary-700',
  };
  if (pct >= 50) return {
    bg: 'bg-gradient-to-r from-amber-50 to-yellow-50',
    border: 'border-amber-200',
    badge: 'bg-amber-600',
    bar: 'bg-amber-500',
    barTrack: 'bg-amber-100',
    text: 'text-amber-900',
    btn: 'bg-amber-600 hover:bg-amber-700',
  };
  return {
    bg: 'bg-gradient-to-r from-red-50 to-orange-50',
    border: 'border-red-200',
    badge: 'bg-red-600',
    bar: 'bg-red-500',
    barTrack: 'bg-red-100',
    text: 'text-red-900',
    btn: 'bg-red-600 hover:bg-red-700',
  };
}

export function ProfileCompletionBanner() {
  const { business } = useAuth();
  const router = useRouter();
  const [profileCompletion, setProfileCompletion] = useState(0);
  const [dismissed, setDismissed] = useState(true); // Start hidden to prevent flash

  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored) {
      const { timestamp } = JSON.parse(stored);
      // Re-show after 7 days
      if (Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true);
        return;
      }
    }
    setDismissed(false);
  }, []);

  const fieldOrder: Array<{ key: string; label: string }> = [
    { key: 'name', label: 'Business Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'pincode', label: 'Pincode' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'pan', label: 'PAN' },
    { key: 'logo_url', label: 'Logo' },
  ];

  useEffect(() => {
    if (!business) {
      setProfileCompletion(0);
      return;
    }

    const address = (business as any).address_line1 || business.address || '';
    const requiredFields = {
      name: business.name ? 1 : 0,
      email: business.email ? 1 : 0,
      phone: business.phone ? 1 : 0,
      address: address ? 1 : 0,
      city: business.city ? 1 : 0,
      state: business.state ? 1 : 0,
      pincode: business.pincode ? 1 : 0,
    };

    const optionalFields = {
      gstin: business.gstin ? 1 : 0,
      pan: business.pan ? 1 : 0,
      logo_url: business.logo_url ? 1 : 0,
    };

    const requiredScore = Object.values(requiredFields).reduce((sum, val) => sum + val, 0);
    const requiredMax = Object.keys(requiredFields).length;
    const requiredPercentage = (requiredScore / requiredMax) * 70;

    const optionalScore =
      (optionalFields.gstin * 15) +
      (optionalFields.pan * 10) +
      (optionalFields.logo_url * 5);

    if (business.id) {
      fetch(`/api/bank-accounts?business_id=${business.id}`)
        .then(res => res.json())
        .then(() => {
          setProfileCompletion(Math.round(Math.min(100, requiredPercentage + optionalScore)));
        })
        .catch(() => {
          setProfileCompletion(Math.round(Math.min(100, requiredPercentage + optionalScore)));
        });
    } else {
      setProfileCompletion(Math.round(Math.min(100, requiredPercentage + optionalScore)));
    }
  }, [business]);

  const getFirstMissingField = (): string | null => {
    if (!business) return 'name';
    const address = (business as any).address_line1 || business.address || '';
    for (const field of fieldOrder) {
      if (field.key === 'address' && !address) return 'address_line1';
      const val = (business as any)[field.key];
      if (!val) return field.key;
    }
    return null;
  };

  if (profileCompletion >= 100 || dismissed) return null;

  const colors = getColorScheme(profileCompletion);

  return (
    <div className={`${colors.bg} border-b ${colors.border} px-4 py-2 shadow-sm`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex-shrink-0">
            <div className={`w-9 h-9 ${colors.badge} rounded-full flex items-center justify-center shadow-sm`}>
              <span className="text-white text-xs font-bold">{profileCompletion}%</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${colors.text}`}>
              Your profile is {profileCompletion}% complete
            </p>
            <div className={`mt-1 w-full ${colors.barTrack} rounded-full h-1.5 max-w-sm`}>
              <div
                className={`${colors.bar} h-1.5 rounded-full transition-all duration-500`}
                style={{ width: `${profileCompletion}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              const firstMissing = getFirstMissingField();
              router.push(firstMissing ? `/settings/business?highlight=${firstMissing}` : '/settings/business');
            }}
            className={`px-3 py-1.5 ${colors.btn} text-white text-xs font-semibold rounded-md transition-colors shadow-sm whitespace-nowrap`}
          >
            Complete Profile
          </button>
          <button
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, JSON.stringify({ timestamp: Date.now() }));
              setDismissed(true);
            }}
            className="p-1 rounded hover:bg-black/5 transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  );
}
