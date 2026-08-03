'use client';

export const dynamic = 'force-dynamic';

import { CustomFieldsManager } from '@/components/custom-fields/CustomFieldsManager';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { SlidersHorizontal } from 'lucide-react';

function CustomFieldsSettingsPage() {
  return (
    <SettingsPageShell
      title="Custom fields"
      description="Define extra fields for items and invoices. Choose which appear on each invoice template under Templates & printing → Customize."
      icon={SlidersHorizontal}
    >
      <div className="max-w-2xl space-y-6">
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
    </SettingsPageShell>
  );
}

export default withPageAuth('settings', 'read', CustomFieldsSettingsPage);
