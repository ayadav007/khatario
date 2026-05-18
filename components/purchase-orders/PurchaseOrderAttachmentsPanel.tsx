'use client';

import React, { useState } from 'react';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { Button } from '@/components/ui/Button';

interface PurchaseOrderAttachmentsPanelProps {
  orderId: string;
  businessId: string;
  onActivity?: () => void;
}

export function PurchaseOrderAttachmentsPanel({
  orderId,
  businessId,
  onActivity,
}: PurchaseOrderAttachmentsPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [showUploader, setShowUploader] = useState(true);

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-text-secondary">
        Attach quotes, delivery notes, or other files to this purchase order.
      </p>
      {showUploader && (
        <DocumentUploader
          entityType="purchase_order"
          entityId={orderId}
          businessId={businessId}
          onUploadSuccess={() => {
            setRefreshKey((k) => k + 1);
            onActivity?.();
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Uploaded files</h3>
        <Button variant="secondary" size="sm" onClick={() => setShowUploader((v) => !v)}>
          {showUploader ? 'Hide uploader' : 'Add files'}
        </Button>
      </div>
      <DocumentList
        key={refreshKey}
        entityType="purchase_order"
        entityId={orderId}
        businessId={businessId}
        onDelete={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
