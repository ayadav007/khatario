'use client';

import { StoreMarkdownPage } from '@/components/store/StoreMarkdownPage';
import { useStore } from '@/lib/store/store-context';

export default function StoreTermsPage() {
  const { store } = useStore();
  return <StoreMarkdownPage title="Terms and conditions" body={store?.store_terms_md || ''} />;
}
