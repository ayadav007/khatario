'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
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

/**
 * UPI apps often decline link-started payments to business UPI IDs (BharatPe, Paytm for Business)
 * "for security reasons", while a scanned QR to the same ID goes through. So the QR is always offered,
 * with a save button for paying from the same phone via "scan from gallery".
 */
export default function UpiPayActions({ links, vpa }: { links: Links; vpa: string }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [copied, setCopied] = useState(false);
  const qrWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the UPI ID stays visible to type manually */
    }
  };

  const saveQr = () => {
    const canvas = qrWrap.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'upi-payment-qr.png';
    a.click();
  };

  const btn = 'block w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors';
  const mobile = platform === 'android' || platform === 'ios';

  return (
    <div className="mt-6 space-y-3">
      {mobile ? (
        <>
          {platform === 'android' && (
            <a href={links.any} className={`${btn} bg-primary-600 text-white hover:bg-primary-700`}>
              Pay with any UPI app
            </a>
          )}
          {APPS.map((app) => (
            <a
              key={app.key}
              href={platform === 'ios' ? links.ios[app.key] : links.android[app.key]}
              className={`${btn} ${platform === 'ios' && app.key === 'gpay' ? 'bg-primary-600 text-white hover:bg-primary-700' : 'border border-gray-300 text-gray-800 hover:bg-gray-50'}`}
            >
              Pay with {app.label}
            </a>
          ))}
        </>
      ) : null}

      <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 px-4 py-4">
        {mobile ? (
          <p className="text-xs text-gray-600">
            If your app says the payment was declined, pay by scanning this QR instead.
          </p>
        ) : null}
        <div ref={qrWrap}>
          <QRCodeCanvas value={links.any} size={mobile ? 180 : 200} marginSize={2} />
        </div>
        {mobile ? (
          <>
            <button
              type="button"
              onClick={saveQr}
              className="text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Save QR to photos
            </button>
            <p className="text-xs text-gray-500">
              Open your UPI app, tap Scan, choose the saved QR from your gallery and pay.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">Scan with any UPI app on your phone</p>
        )}
      </div>

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
