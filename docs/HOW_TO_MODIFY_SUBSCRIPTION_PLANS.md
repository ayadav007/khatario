# How to Modify Subscription Plans for Testing

## Overview
Subscription plans are stored in the `subscription_plans` table in PostgreSQL. You can modify plan features and limits directly in the database for testing purposes.

## Method 1: Update via SQL (Recommended for Quick Testing)

### Connect to PostgreSQL Database
```bash
# Using psql
psql -U your_username -d your_database_name

# Or using pgAdmin / DBeaver / any SQL client
```

### Example: Enable WhatsApp Manual for Free Plan

```sql
-- View current free plan configuration
SELECT id, name, features FROM subscription_plans WHERE id = 'free';

-- Update free plan to enable whatsapp_manual and increase WhatsApp limit
UPDATE subscription_plans
SET features = jsonb_set(
  jsonb_set(
    features,
    '{features,whatsapp_manual}',
    'true'
  ),
  '{limits,max_whatsapp_per_day}',
  '10'
)
WHERE id = 'free';

-- Verify the change
SELECT id, name, features->'features'->'whatsapp_manual' as whatsapp_manual,
       features->'limits'->'max_whatsapp_per_day' as whatsapp_limit
FROM subscription_plans WHERE id = 'free';
```

### Example: Disable a Feature

```sql
-- Disable whatsapp_manual for free plan
UPDATE subscription_plans
SET features = jsonb_set(
  features,
  '{features,whatsapp_manual}',
  'false'
)
WHERE id = 'free';
```

### Example: Change WhatsApp Daily Limit

```sql
-- Set free plan to allow 5 WhatsApp messages per day
UPDATE subscription_plans
SET features = jsonb_set(
  features,
  '{limits,max_whatsapp_per_day}',
  '5'
)
WHERE id = 'free';

-- Set to unlimited (use -1)
UPDATE subscription_plans
SET features = jsonb_set(
  features,
  '{limits,max_whatsapp_per_day}',
  '-1'
)
WHERE id = 'free';
```

### Common Feature Flags to Test

```sql
-- Enable/disable whatsapp_manual
'{features,whatsapp_manual}' → 'true' or 'false'

-- Enable/disable whatsapp_auto_reminders
'{features,whatsapp_auto_reminders}' → 'true' or 'false'

-- Change WhatsApp daily limit
'{limits,max_whatsapp_per_day}' → '0', '10', '100', or '-1' (unlimited)

-- Change invoice limit
'{limits,max_invoices_per_month}' → '20', '500', or '-1' (unlimited)

-- Change customer limit
'{limits,max_customers}' → '10', '100', or '-1' (unlimited)
```

## Method 2: Re-run Seed Script (Resets All Plans)

If you want to reset plans to default values:

```bash
# Run the seed script
psql -U your_username -d your_database_name -f database/seed_subscriptions.sql
```

**⚠️ Warning:** This will reset ALL subscription plans to their default values.

## Method 3: Update Business Subscription Directly

To test with a specific business account:

```sql
-- Check current business subscription
SELECT bs.*, sp.name as plan_name, sp.features
FROM business_subscriptions bs
JOIN subscription_plans sp ON bs.plan_id = sp.id
WHERE bs.business_id = 'your-business-id-here';

-- Change a business to a different plan
UPDATE business_subscriptions
SET plan_id = 'professional'  -- or 'free', 'business', 'enterprise'
WHERE business_id = 'your-business-id-here';
```

## Method 4: Modify Seed File and Re-apply

1. Edit `database/seed_subscriptions.sql`
2. Change the values in the JSON for the plan you want to test
3. Run the seed script (see Method 2)

Example modification in seed file:
```sql
-- FREE PLAN
('free', 'free', 'Free / Starter', ..., 
'{
  "limits": {
    "max_whatsapp_per_day": 10  -- Changed from 0 to 10
  },
  "features": {
    "whatsapp_manual": true,  -- Changed from false to true
    ...
  }
}'::jsonb, true, 1),
```

## Quick Test Scenarios

### Test 1: Free Plan with WhatsApp Enabled
```sql
UPDATE subscription_plans
SET features = jsonb_set(
  jsonb_set(
    features,
    '{features,whatsapp_manual}',
    'true'
  ),
  '{limits,max_whatsapp_per_day}',
  '5'
)
WHERE id = 'free';
```

### Test 2: Free Plan with Unlimited WhatsApp (for testing only)
```sql
UPDATE subscription_plans
SET features = jsonb_set(
  jsonb_set(
    features,
    '{features,whatsapp_manual}',
    'true'
  ),
  '{limits,max_whatsapp_per_day}',
  '-1'
)
WHERE id = 'free';
```

### Test 3: Disable WhatsApp for All Plans
```sql
UPDATE subscription_plans
SET features = jsonb_set(
  features,
  '{features,whatsapp_manual}',
  'false'
);
```

## Important Notes

1. **Cache**: Subscription data might be cached. After updating the database, you may need to:
   - Restart your application server
   - Clear any application cache
   - Wait a few minutes for cache expiration

2. **Business Subscriptions**: The `business_subscriptions` table links businesses to plans. Make sure the business you're testing has the correct `plan_id` assigned.

3. **Feature Checks**: The application uses `hasFeature(business_id, 'feature_key')` which reads from the plan assigned to the business, not directly from the plan table.

4. **Limit Checks**: The application uses `checkLimit(business_id, 'whatsapp')` which reads the limit from the plan and checks usage from `subscription_usage` table.

## Verify Changes

After making changes, verify they're working:

```sql
-- Check plan features
SELECT 
  id,
  name,
  features->'features'->'whatsapp_manual' as whatsapp_manual,
  features->'features'->'whatsapp_auto_reminders' as auto_reminders,
  features->'limits'->'max_whatsapp_per_day' as whatsapp_limit
FROM subscription_plans
ORDER BY sort_order;
```

## Troubleshooting

If changes don't seem to take effect:

1. Check business subscription assignment:
```sql
SELECT bs.business_id, bs.plan_id, sp.name, sp.features
FROM business_subscriptions bs
JOIN subscription_plans sp ON bs.plan_id = sp.id
WHERE bs.business_id = 'your-business-id';
```

2. Check subscription cache in application (if any)

3. Restart the application server

4. Check application logs for feature/limit check errors

