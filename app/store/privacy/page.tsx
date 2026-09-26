'use client';

import { StoreMarkdownPage } from '@/components/store/StoreMarkdownPage';
import { useStore } from '@/lib/store/store-context';

export default function StorePrivacyPage() {
  const { store } = useStore();
  return <StoreMarkdownPage title="Privacy policy" body={store?.store_privacy_md || ''} />;
}
