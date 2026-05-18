# Guide: Adding New WhatsApp Features to Locking System

This guide explains how to add a new WhatsApp feature to the locking/unlocking system.

## Overview

The system supports two addon types:
- `whatsapp_bot` - Unlocks Conversations, Bot Rules, and related features
- `whatsapp_send_message` - Unlocks Send Message feature

## Step-by-Step Process

### Step 1: Decide Addon Type

Determine which addon type your new feature belongs to:
- **Use `whatsapp_bot`** if the feature is related to:
  - Conversations management
  - Bot rules/automation
  - CRM features
  - Message labeling/management
  
- **Use `whatsapp_send_message`** if the feature is related to:
  - Sending messages
  - Message templates
  - Bulk messaging

- **Create a new addon type** if the feature doesn't fit either category

### Step 2: Add Feature to Sidebar

Edit `components/layout/Sidebar.tsx`:

```typescript
{
  href: '/whatsapp/conversations',
  label: 'WhatsApp',
  icon: MessageSquare,
  collapsible: true,
  subItems: [
    { 
      href: '/whatsapp/conversations', 
      label: 'Conversations',
      featureKey: 'whatsapp_bot',
      isLocked: true
    },
    { 
      href: '/whatsapp/bot-rules', 
      label: 'Bot Rules',
      featureKey: 'whatsapp_bot',
      isLocked: true
    },
    { 
      href: '/whatsapp/send-message', 
      label: 'Send Message',
      featureKey: 'whatsapp_send_message',
      isLocked: true
    },
    // ADD YOUR NEW FEATURE HERE
    { 
      href: '/whatsapp/your-new-feature', 
      label: 'Your New Feature',
      featureKey: 'whatsapp_bot', // or 'whatsapp_send_message'
      isLocked: true
    },
  ],
},
```

### Step 3: Create Feature Page with Lock Gate

Create a new page file (e.g., `app/whatsapp/your-new-feature/page.tsx`):

```typescript
'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { Card } from '@/components/ui/Card';
import { Lock } from 'lucide-react';
// Import your feature component
// import { YourFeatureComponent } from '@/components/whatsapp/YourFeatureComponent';

export default function YourNewFeaturePage() {
  const { business } = useAuth();
  const { hasFeature, loading, refreshAddons } = useSubscriptionCheck(business?.id);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Check access - replace 'whatsapp_bot' with your addon type
  const hasAccess = hasFeature('whatsapp_bot');

  useEffect(() => {
    if (!loading && !hasAccess) {
      setShowUpgradeModal(true);
    } else if (!loading && hasAccess) {
      setShowUpgradeModal(false);
    }
  }, [loading, hasAccess]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto py-8">
          <Card className="p-8 text-center">
            <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Your New Feature is Locked
            </h2>
            <p className="text-gray-600 mb-6">
              Upgrade to unlock this feature.
            </p>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              Unlock Feature
            </button>
          </Card>
        </div>

        {showUpgradeModal && (
          <WhatsAppAddonModal
            addonType="whatsapp_bot" // or 'whatsapp_send_message'
            onClose={() => setShowUpgradeModal(false)}
            onPurchaseSuccess={async () => {
              await refreshAddons?.();
              setTimeout(() => {
                window.location.reload();
              }, 500);
            }}
          />
        )}
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Your New Feature</h1>
          <p className="text-gray-600">Feature description</p>
        </div>
        {/* Your feature component here */}
        {/* <YourFeatureComponent /> */}
      </div>
    </AppLayout>
  );
}
```

### Step 4: Add Feature Gate to API Routes

If your feature has API routes, add the addon check:

For `whatsapp_bot` features:
```typescript
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  // ... existing code ...
  
  const businessId = searchParams.get('business_id');
  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  // Add this check
  const hasAddon = await hasWhatsAppBotAddon(businessId);
  if (!hasAddon) {
    return NextResponse.json(
      { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
      { status: 403 }
    );
  }

  // ... rest of your code ...
}
```

For `whatsapp_send_message` features:
```typescript
import { hasWhatsAppSendMessageAddon } from '@/lib/subscription';

// Same pattern, but use hasWhatsAppSendMessageAddon instead
```

### Step 5: Update Addon Description (Optional)

If you want to show this feature in the addon list, update `app/api/subscriptions/addons/route.ts`:

```typescript
const availableAddons = [
  {
    id: 'whatsapp_bot',
    name: 'WhatsApp Bot',
    display_name: 'WhatsApp Bot & Conversations',
    description: 'Access to WhatsApp Conversations, Bot Rules, and advanced automation features',
    price_monthly: 499,
    currency: 'INR',
    features: [
      'Conversations management',
      'Bot Rules & Automation',
      'Message labeling',
      'Auto-replies',
      'CRM integration',
      'Your New Feature', // ADD YOUR FEATURE HERE
    ],
  },
  // ...
];
```

### Step 6: Update Subscription Library (If Creating New Addon Type)

If creating a completely new addon type (not `whatsapp_bot` or `whatsapp_send_message`):

1. **Update `lib/subscription.ts`** - Add a new function:
```typescript
export async function hasWhatsAppNewFeatureAddon(businessId: string): Promise<boolean> {
  try {
    const addon = await db.queryOne<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM whatsapp_addons
      WHERE business_id = $1
        AND addon_type = 'whatsapp_new_feature'
        AND status = 'active'
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `, [businessId]);

    return parseInt(addon?.count || '0', 10) > 0;
  } catch (error) {
    console.error('Error checking WhatsApp New Feature addon:', error);
    return false;
  }
}
```

2. **Update `hasFeature` function** in `lib/subscription.ts`:
```typescript
export async function hasFeature(businessId: string, featureKey: string): Promise<boolean> {
  // Check addon status first for WhatsApp features
  if (featureKey === 'whatsapp_bot') {
    return await hasWhatsAppBotAddon(businessId);
  }
  
  if (featureKey === 'whatsapp_send_message') {
    return await hasWhatsAppSendMessageAddon(businessId);
  }

  // ADD YOUR NEW FEATURE CHECK
  if (featureKey === 'whatsapp_new_feature') {
    return await hasWhatsAppNewFeatureAddon(businessId);
  }

  // For other features, check subscription plan
  const subscription = await getBusinessSubscription(businessId);
  
  if (!subscription) {
    return false;
  }

  return subscription.features?.features?.[featureKey] === true;
}
```

3. **Update `hooks/useSubscriptionCheck.ts`** - Add check in `hasFeature`:
```typescript
function hasFeature(featureKey: string): boolean {
  // Check addons first for WhatsApp features
  if (featureKey === 'whatsapp_bot' || featureKey === 'whatsapp_send_message' || featureKey === 'whatsapp_new_feature') {
    const addonType = featureKey === 'whatsapp_bot' 
      ? 'whatsapp_bot' 
      : featureKey === 'whatsapp_send_message'
      ? 'whatsapp_send_message'
      : 'whatsapp_new_feature'; // NEW ADDON TYPE
    if (!Array.isArray(addons) || addons.length === 0) {
      return false;
    }
    const hasAddon = addons.some(a => 
      a.addon_type === addonType && 
      a.status === 'active' &&
      (!a.end_date || new Date(a.end_date) >= new Date())
    );
    return hasAddon;
  }
  // ... rest of code
}
```

4. **Update `app/api/subscriptions/addons/[type]/purchase/route.ts`** - Add to valid types:
```typescript
const validAddonTypes: WhatsAppAddonType[] = ['whatsapp_bot', 'whatsapp_send_message', 'whatsapp_new_feature'];
const addonPricing: Record<WhatsAppAddonType, number> = {
  whatsapp_bot: 499,
  whatsapp_send_message: 299,
  whatsapp_new_feature: 199, // NEW PRICING
};
```

5. **Update `app/api/subscriptions/addons/route.ts`** - Add to available addons:
```typescript
const availableAddons = [
  // ... existing addons
  {
    id: 'whatsapp_new_feature',
    name: 'WhatsApp New Feature',
    display_name: 'WhatsApp New Feature',
    description: 'Description of your new feature',
    price_monthly: 199,
    currency: 'INR',
    features: [
      'Feature 1',
      'Feature 2',
    ],
  },
];
```

## Quick Reference Checklist

- [ ] Add to Sidebar with `featureKey` and `isLocked: true`
- [ ] Create page component with feature gate
- [ ] Add `hasFeature` check in the page
- [ ] Add API route feature gates (if applicable)
- [ ] Update addon description (optional)
- [ ] If new addon type: Update subscription library, hook, purchase API, and addons list

## Example: Adding "Broadcasts" Feature

Here's a complete example of adding a "Broadcasts" feature:

### 1. Sidebar (`components/layout/Sidebar.tsx`)
```typescript
{
  href: '/whatsapp/broadcasts',
  label: 'Broadcasts',
  featureKey: 'whatsapp_bot', // Using existing addon
  isLocked: true
},
```

### 2. Page (`app/whatsapp/broadcasts/page.tsx`)
```typescript
const hasAccess = hasFeature('whatsapp_bot'); // Same addon type
```

### 3. API Route (`app/api/whatsapp/broadcasts/route.ts`)
```typescript
const hasAddon = await hasWhatsAppBotAddon(businessId);
if (!hasAddon) {
  return NextResponse.json(
    { error: 'WhatsApp Bot addon is required.' },
    { status: 403 }
  );
}
```

That's it! The feature will be locked/unlocked based on the `whatsapp_bot` addon status.

