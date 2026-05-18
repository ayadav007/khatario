# Fix Backup System Issues

## Issues Fixed

### 1. Feature Access Error (403)
**Problem:** `backup_restore` feature not found in platform registry  
**Solution:** Added `settings_backup` feature to all subscription plans

### 2. Google Drive Credentials
**Problem:** Required environment variables that users don't have access to  
**Solution:** Users can now enter their own Google OAuth credentials in the UI

---

## Database Migrations to Run

### Step 1: Add Backup Feature to Registry

Run this SQL in your PostgreSQL database:

```sql
-- Migration 143: Add Backup & Restore Feature to Platform Registry

-- 1. Add backup_restore feature to platform_features
INSERT INTO platform_features (id, category, label, description, route_path, icon_name, sort_order, is_active, is_addon)
VALUES (
  'settings_backup', 
  'settings', 
  'Backup & Restore', 
  'Backup business data and restore from previous backups',
  '/settings/backup',
  'Database',
  50,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;

-- 2. Enable backup_restore for FREE plan
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES ('free', 'settings_backup', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 3. Enable for all other plans
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT id, 'settings_backup', true
FROM subscription_plans
WHERE id != 'free'
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;
```

### Step 2: Add Google Drive Credentials Support

Run this SQL in your PostgreSQL database:

```sql
-- Migration 144: Allow businesses to configure their own Google Drive OAuth credentials

-- Add columns for per-business OAuth app credentials
ALTER TABLE cloud_storage_connections
ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT,
ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS redirect_uri TEXT;

-- Comments
COMMENT ON COLUMN cloud_storage_connections.client_id_encrypted IS 'Encrypted OAuth client ID - per business Google Cloud Project';
COMMENT ON COLUMN cloud_storage_connections.client_secret_encrypted IS 'Encrypted OAuth client secret - per business';
COMMENT ON COLUMN cloud_storage_connections.redirect_uri IS 'OAuth redirect URI configured in Google Cloud Console';
```

---

## How to Run Migrations

### Option 1: Using psql command line

```bash
# Navigate to your project directory
cd D:\MyApps\Khatario

# Run migration 143
psql -U postgres -d khatario -f database/migrations/143_add_backup_restore_feature.sql

# Run migration 144
psql -U postgres -d khatario -f database/migrations/144_google_drive_credentials_per_business.sql
```

### Option 2: Using pgAdmin

1. Open pgAdmin
2. Connect to your `khatario` database
3. Open Query Tool
4. Copy and paste the SQL from migration 143
5. Execute
6. Copy and paste the SQL from migration 144
7. Execute

### Option 3: Using any PostgreSQL client

1. Connect to your `khatario` database
2. Execute the SQL from both migrations

---

## Verification

After running the migrations, verify:

### 1. Check Feature Added

```sql
SELECT * FROM platform_features WHERE id = 'settings_backup';
```

Expected: 1 row with settings_backup feature

### 2. Check Feature Enabled for Plans

```sql
SELECT spf.plan_id, spf.enabled, sp.name 
FROM subscription_plan_features spf
JOIN subscription_plans sp ON spf.plan_id = sp.id
WHERE spf.feature_id = 'settings_backup';
```

Expected: All your subscription plans with enabled = true

### 3. Check New Columns Added

```sql
\d cloud_storage_connections
```

Expected: Should show `client_id_encrypted`, `client_secret_encrypted`, `redirect_uri` columns

---

## Testing the Fixes

### 1. Test Backup Creation

1. Go to Settings → Backup & Restore
2. Click "Create Backup Now"
3. Should download backup file successfully (no 403 error)

### 2. Test Google Drive Setup

1. Go to Settings → Backup & Restore
2. Click "Setup" on Google Drive
3. Modal opens asking for credentials
4. Follow instructions to create Google Cloud Project
5. Enter Client ID and Client Secret
6. Save credentials
7. Click "Connect" to initiate OAuth
8. Authorize in Google
9. Should redirect back with "Connected" status

---

## Google Drive Setup Guide for Users

### Creating Google OAuth Credentials

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com
   - Sign in with your Google account

2. **Create or Select Project**
   - Click "Select a project" → "New Project"
   - Name: "Khatario Backup" (or any name)
   - Click "Create"

3. **Enable Google Drive API**
   - Go to "APIs & Services" → "Library"
   - Search for "Google Drive API"
   - Click "Enable"

4. **Create OAuth Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - If prompted, configure OAuth consent screen first:
     - User Type: External
     - App name: "Khatario Backup"
     - Add your email as developer email
     - Add scopes: Google Drive API (drive.file, drive.appdata)
     - Save
   - Application type: **Web application**
   - Name: "Khatario Backup Client"

5. **Add Redirect URI**
   - In "Authorized redirect URIs", add:
     ```
     https://your-domain.com/api/cloud-storage/google/callback
     ```
   - Replace `your-domain.com` with your actual domain
   - For local testing: `http://localhost:3000/api/cloud-storage/google/callback`

6. **Copy Credentials**
   - Copy the "Client ID" (looks like: `xxxxx.apps.googleusercontent.com`)
   - Copy the "Client secret"

7. **Enter in Khatario**
   - Go to Khatario → Settings → Backup & Restore
   - Click "Setup" on Google Drive
   - Paste Client ID and Client Secret
   - The Redirect URI is pre-filled
   - Click "Save & Continue"
   - Click "Connect" to authorize

8. **Authorize Access**
   - Google will ask you to sign in
   - Select your account
   - Click "Allow" to grant permissions
   - You'll be redirected back to Khatario
   - Google Drive should now show "Connected"

---

## Code Changes Summary

### Files Modified

1. **Feature Access** - Changed from `backup_restore` to `settings_backup`:
   - `app/api/backup/create/route.ts`
   - `app/api/backup/restore/route.ts`
   - `app/api/backup/preview/route.ts`
   - `app/api/backup/schedule/route.ts`
   - `app/api/backup/history/*.ts`
   - `app/api/cloud-storage/google/*.ts`

2. **Google OAuth** - Support business-specific credentials:
   - `app/api/cloud-storage/google/auth/route.ts` - Use business credentials
   - `app/api/cloud-storage/google/callback/route.ts` - Use business credentials
   - `lib/cloud-storage.ts` - Token refresh with business credentials

3. **UI** - Add credentials modal:
   - `app/(app)/settings/backup/page.tsx` - Configuration modal and workflow

### Files Created

1. `database/migrations/143_add_backup_restore_feature.sql` - Feature registry
2. `database/migrations/144_google_drive_credentials_per_business.sql` - Schema update
3. `app/api/cloud-storage/google/credentials/route.ts` - Credentials management API
4. `FIX_BACKUP_ISSUES.md` - This documentation

---

## Important Notes

1. **Backward Compatibility**: The system still supports environment variables for Google OAuth (if configured). Business-specific credentials take precedence.

2. **Security**: All OAuth credentials are encrypted using AES-256 before storing in the database.

3. **No Environment Variables Needed**: Users no longer need GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env (unless you want a default/fallback).

4. **Per-Business Isolation**: Each business configures their own Google Cloud Project, ensuring data isolation.

5. **Free Plan**: Backup feature is now enabled for all plans including Free.

---

## Troubleshooting

### Issue: Still getting 403 error
**Solution:** Make sure migrations ran successfully. Check if `settings_backup` exists in platform_features.

### Issue: Google Drive modal doesn't open
**Solution:** Clear browser cache and reload the page.

### Issue: OAuth redirect fails
**Solution:** Ensure the redirect URI in Google Cloud Console exactly matches the one shown in Khatario (including http/https and port).

### Issue: Token refresh fails
**Solution:** This might happen if client secret was changed in Google Cloud Console. Delete and recreate credentials in Khatario.

---

## Support

If you encounter any issues:
1. Check browser console for errors
2. Check server logs
3. Verify migrations ran successfully
4. Verify Google Cloud Project configuration
5. Test with a new Google Cloud Project

---

## Next Steps

After migrations are complete:
1. Restart your application server
2. Test backup creation (should work now)
3. Setup Google Drive with your credentials
4. Test scheduled backups
5. Refer to BACKUP_TESTING_GUIDE.md for comprehensive testing
