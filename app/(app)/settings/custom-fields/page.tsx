'use client';

export const dynamic = 'force-dynamic';

import { CustomFieldsManager } from '@/components/custom-fields/CustomFieldsManager';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

function CustomFieldsSettingsPage() {
  return (
    <div className={WIDE_PAGE_CONTENT_CLASS}>
      <div className="mb-6">
        <MobileDuplicatePageChrome
          title="Custom fields"
          description="Define extra fields for items and invoices. Choose which appear on each invoice template under Templates & printing → Customize."
        />
      </div>

      <div className="space-y-6 max-w-2xl">
        <CustomFieldsManager
          entityType="item"
          title="Item fields"
          description="Filled when adding or editing items. Can appear on invoice line items when enabled on the template."
        />
        <CustomFieldsManager
          entityType="invoice"
          title="Invoice fields"
          description="Filled when creating an invoice. Shown below invoice number, date, and due date when enabled on the template."
        />
      </div>
    </div>
  );
}

export default withPageAuth('settings', 'read', CustomFieldsSettingsPage);
