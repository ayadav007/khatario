import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'How-to guides for Khatario — billing, accounts, inventory, GST, and day-to-day business workflows. No sign-in required.',
};

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
