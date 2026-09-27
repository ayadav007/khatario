'use client';

import { Render } from '@puckeditor/core';
import { marketingConfig } from '@/components/marketing/builder/config';
import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';

export function MarketingPageRenderer({ data }: { data: MarketingDocument }) {
  return <Render config={marketingConfig} data={data} />;
}
