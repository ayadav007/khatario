import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Khatario — GST billing, stock and WhatsApp invoices for Indian shops';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Default share image for every public page that does not set its own. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 55%, #14b8a6 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 700, opacity: 0.9 }}>Khatario</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.1, marginTop: 24, maxWidth: 980 }}>
          GST bills in under a minute. Shared on WhatsApp.
        </div>
        <div style={{ fontSize: 34, marginTop: 36, opacity: 0.92 }}>
          Billing · Stock · Udhaar · GST returns — free to start
        </div>
      </div>
    ),
    size,
  );
}
