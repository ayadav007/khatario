# Debug: WhatsApp Addon Not Unlocking

Follow these steps to diagnose why the WhatsApp features aren't unlocking after purchase:

## Step 1: Check if Migration Was Run

The `whatsapp_addons` table must exist. Run this in pgAdmin or psql:

```sql
-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'whatsapp_addons'
) as table_exists;
```

**If the table doesn't exist**, run the migration:

```sql
-- In pgAdmin: Open Query Tool, open file: database/migrations/030_whatsapp_addon_subscriptions.sql
-- Click Execute (F5)
```

## Step 2: Check if Addon Exists in Database

Replace `YOUR_BUSINESS_ID` with your actual business ID:

```sql
-- Check all addons for your business
SELECT * FROM whatsapp_addons 
WHERE business_id = 'YOUR_BUSINESS_ID';

-- Check specifically for whatsapp_bot addon
SELECT * FROM whatsapp_addons 
WHERE business_id = 'YOUR_BUSINESS_ID' 
  AND addon_type = 'whatsapp_bot';
```

**If no addon exists**, the purchase might have failed. Try purchasing again.

## Step 3: Verify Addon Status

The addon must have:
- `status = 'active'`
- `end_date IS NULL` OR `end_date >= CURRENT_DATE`

```sql
SELECT 
  id,
  business_id,
  addon_type,
  status,
  start_date,
  end_date,
  CASE 
    WHEN status = 'active' AND (end_date IS NULL OR end_date >= CURRENT_DATE) 
    THEN 'VALID' 
    ELSE 'INVALID' 
  END as validity
FROM whatsapp_addons 
WHERE business_id = 'YOUR_BUSINESS_ID';
```

**If status is not 'active'** or end_date has passed, update it:

```sql
UPDATE whatsapp_addons
SET status = 'active',
    end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE business_id = 'YOUR_BUSINESS_ID'
  AND addon_type = 'whatsapp_bot';
```

## Step 4: Test the Debug API

Open this URL in your browser (replace `YOUR_BUSINESS_ID`):

```
http://localhost:3000/api/subscriptions/addons/debug?business_id=YOUR_BUSINESS_ID
```

This will show you:
- If the table exists
- All addons in the database
- Active addons (filtered)
- The result of `hasWhatsAppBotAddon()` check

## Step 5: Test the Current Addons API

Open this URL:

```
http://localhost:3000/api/subscriptions/addons/current?business_id=YOUR_BUSINESS_ID
```

This should return:
```json
{
  "addons": [
    {
      "id": "...",
      "addon_type": "whatsapp_bot",
      "status": "active",
      ...
    }
  ]
}
```

## Step 6: Check Frontend Console

Open browser DevTools (F12) → Console tab. Look for:

```
[SubscriptionCheck] hasFeature('whatsapp_bot'): true addons: [...]
```

If it shows `false`, check what addons are in the array.

## Step 7: Clear Browser Cache

1. Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. Or clear cache: DevTools → Application → Clear Storage → Clear site data

## Step 8: Check Network Tab

1. Open DevTools → Network tab
2. Filter by "addons"
3. Check the response from `/api/subscriptions/addons/current`
4. Verify it includes your addon

## Common Issues & Fixes

### Issue 1: Table doesn't exist
**Fix**: Run migration `030_whatsapp_addon_subscriptions.sql`

### Issue 2: Addon not created after purchase
**Fix**: Check browser console for errors during purchase. Verify the purchase API worked:
```sql
-- Manually create addon if purchase failed
INSERT INTO whatsapp_addons (business_id, addon_type, status, price_monthly, start_date, end_date)
VALUES ('YOUR_BUSINESS_ID', 'whatsapp_bot', 'active', 499, CURRENT_DATE, NULL);
```

### Issue 3: Addon exists but status is wrong
**Fix**: Update status:
```sql
UPDATE whatsapp_addons
SET status = 'active', end_date = NULL
WHERE business_id = 'YOUR_BUSINESS_ID' AND addon_type = 'whatsapp_bot';
```

### Issue 4: Frontend not refreshing
**Fix**: 
1. Clear browser cache
2. Restart dev server
3. Check if `refreshAddons()` is being called after purchase

## Quick Fix Script

If you want to manually create/fix the addon:

```sql
-- Get your business ID first
SELECT id, name FROM businesses;

-- Then create/fix the addon (replace YOUR_BUSINESS_ID)
INSERT INTO whatsapp_addons (business_id, addon_type, status, price_monthly, start_date, end_date)
VALUES ('YOUR_BUSINESS_ID', 'whatsapp_bot', 'active', 499, CURRENT_DATE, NULL)
ON CONFLICT (business_id, addon_type)
DO UPDATE SET 
  status = 'active',
  end_date = NULL,
  updated_at = CURRENT_TIMESTAMP;
```

