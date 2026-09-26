'use client';

import { StoreMarkdownPage } from '@/components/store/StoreMarkdownPage';
import { useStore } from '@/lib/store/store-context';

export default function StoreRefundPage() {
  const { store } = useStore();
  return <StoreMarkdownPage title="Refund policy" body={store?.store_refund_md || ''} />;
}
