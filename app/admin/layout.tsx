import type { Metadata, Viewport } from 'next';
import { AdminAppShell } from '@/components/admin/AdminAppShell';

export const metadata: Metadata = {
  title: 'Platform Admin',
  applicationName: 'Khatario Admin',
  manifest: '/admin/pwa-manifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Khatario Admin',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminAppShell>{children}</AdminAppShell>;
}
