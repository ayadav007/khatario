'use client';

import { ShoppingCart } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { AbandonedCartList } from '@/components/store/admin/AbandonedCartList';

export default function AbandonedCartsPage() {
  return (
    <SettingsPageShell
      title="Abandoned carts"
      description="Carts that signed-in shoppers left behind. Send a reminder, or message them on WhatsApp."
      icon={ShoppingCart}
    >
      <AbandonedCartList />
    </SettingsPageShell>
  );
}
