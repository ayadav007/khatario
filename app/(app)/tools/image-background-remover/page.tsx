'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { ImageBackgroundRemoverTool } from '@/components/tools/ImageBackgroundRemoverTool';

export default function ImageBackgroundRemoverPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Background remover"
        subtitle="Click a product or person. The cutout is made on this device."
      />

      <ImageBackgroundRemoverTool />
    </div>
  );
}
