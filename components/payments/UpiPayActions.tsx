'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { upiAppLinks } from '@/lib/payments/upi-pay-link';

type Links = ReturnType<typeof upiAppLinks>;
type Platform = 'android' | 'ios' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

const APPS = [
  { key: 'gpay', label: 'Google Pay' },
  { key: 'phonepe', label: 'PhonePe' },
  { key: 'paytm', label: 'Paytm' },
] as const;

export default function UpiPayActions({ links, vpa }: { links: Links; vpa: string }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    // Android shows its UPI app chooser for upi://; try it once so most customers pay in one tap.
    if (p === 'android') window.location.href = links.any;
  }, [links.any]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the UPI ID stays visible to type manually */
    }
  };

  const btn = 'block w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors';

  return (
    <div className="mt-6 space-y-3">
      {platform === 'desktop' ? (
        <div className="flex flex-col items-center gap-2">
          <QRCodeSVG value={links.any} size={200} marginSize={2} />
          <p className="text-xs text-gray-500">Scan with any UPI app on your phone</p>
        </div>
      ) : (
        <>
          {platform === 'android' && (
            <a href={links.any} className={`${btn} bg-primary-600 text-white hover:bg-primary-700`}>
              Pay with any UPI app
            </a>
          )}
          {platform &&
            APPS.map((app) => (
              <a
                key={app.key}
                href={platform === 'ios' ? links.ios[app.key] : links.android[app.key]}
                className={`${btn} ${platform === 'ios' && app.key === 'gpay' ? 'bg-primary-600 text-white hover:bg-primary-700' : 'border border-gray-300 text-gray-800 hover:bg-gray-50'}`}
              >
                Pay with {app.label}
              </a>
            ))}
        </>
      )}

      <div className="rounded-xl bg-gray-50 px-4 py-3 text-left">
        <p className="text-xs text-gray-500">Or pay to UPI ID</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 break-all">{vpa}</span>
          <button type="button" onClick={copy} className="shrink-0 text-xs font-semibold text-primary-600 hover:text-primary-700">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
