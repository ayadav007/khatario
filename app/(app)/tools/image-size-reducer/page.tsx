'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { FileImage } from 'lucide-react';
import { ImageSizeReducerTool } from '@/components/tools/ImageSizeReducerTool';

export default function ImageSizeReducerPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><FileImage className="w-6 h-6 text-primary-500" />
            Image Size Reducer</>}
  subtitle="Compress and reduce image file sizes while maintaining quality"
/>
        </div>

      <ImageSizeReducerTool />
    </div>
  );
}
