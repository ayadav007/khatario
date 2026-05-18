# Platform Admin System - Complete Setup Guide

## ✅ What's Been Built

### 1. Database Infrastructure
- ✅ `platform_admins` table (separate from business users)
- ✅ `platform_admin_logs` table (activity tracking)
- ✅ Seed script for first super admin

### 2. Authentication & Authorization
- ✅ Platform admin login system (`/admin/login`)
- ✅ Role-based access control (super_admin, admin, support, viewer)
- ✅ Permission checks (`lib/platform-auth.ts`)
- ✅ Activity logging

### 3. Admin Dashboard
- ✅ Complete admin layout with sidebar navigation
- ✅ Platform metrics dashboard
- ✅ MRR/ARR tracking
- ✅ Business analytics
- ✅ Subscription breakdown

### 4. API Routes
- ✅ `POST /api/admin/auth/login` - Admin authentication
- ✅ `GET /api/admin/auth/me` - Get current admin
- ✅ `GET /api/admin/metrics` - Platform metrics
- ✅ `GET /api/admin/subscriptions/plans` - Manage plans

---

## 🚀 Setup Instructions

### Step 1: Install bcryptjs (if not already installed)

```bash
cd D:\MyApps\Khatario
npm install bcryptjs @types/bcryptjs
```

### Step 2: Generate Password Hash

```bash
node scripts/generate_admin_password.js admin123
```

**Output:**
```
Password: admin123
Hash: $2b$10$XxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXx
```

Copy this hash.

### Step 3: Update Seed Script

Open `database/seed_platform_admin.sql` and replace the placeholder hash with the generated hash:

```sql
INSERT INTO platform_admins (
  name, 
  email, 
  password_hash,  -- ← Replace with your generated hash
  ...
```

### Step 4: Apply Database Changes

```bash
# Run the main schema update
node scripts/migrate.js

# Run subscription plans seed
$env:PGPASSWORD="admin"
psql -U postgres -d khatario_db -f database/seed_subscriptions.sql

# Run platform admin seed
psql -U postgres -d khatario_db -f database/seed_platform_admin.sql
```

### Step 5: Start the Application

```bash
npm run dev
```

---

## 🔑 Default Login Credentials

**Platform Admin Portal:** `http://localhost:3000/admin/login`

```
Email:    admin@khatario.com
Password: admin123
```

⚠️ **IMPORTANT**: Change this password immediately after first login!

---

## 🎯 Platform Admin Features

### Dashboard (`/admin`)
- Total businesses count
- Active businesses (last 30 days)
- MRR (Monthly Recurring Revenue)
- ARR (Annual Recurring Revenue)
- Subscription breakdown by plan
- Recent businesses list

### Planned Features (To Be Built)
- `/admin/businesses` - Manage all businesses
- `/admin/subscriptions` - View/edit subscriptions
- `/admin/plans` - Create/edit subscription plans
- `/admin/users` - Manage platform admins (super_admin only)
- `/admin/logs` - View activity logs
- `/admin/settings` - Platform-wide settings

---

## 👥 Platform Admin Roles

| Role | Permissions | Description |
|------|-------------|-------------|
| **super_admin** | Full access | Can create/delete admins, manage all businesses, edit plans |
| **admin** | Business & subscription management | Can view/edit businesses, manage subscriptions |
| **support** | Read + subscription edits | Can help customers with subscriptions |
| **viewer** | Read-only | Can only view metrics and reports |

### Permission Matrix

| Action | super_admin | admin | support | viewer |
|--------|-------------|-------|---------|--------|
| Create/delete admins | ✅ | ❌ | ❌ | ❌ |
| Manage businesses | ✅ | ✅ | ❌ | ❌ |
| Manage subscriptions | ✅ | ✅ | ✅ | ❌ |
| Create/edit plans | ✅ | ❌ | ❌ | ❌ |
| View metrics | ✅ | ✅ | ✅ | ✅ |
| View logs | ✅ | ✅ | ❌ | ❌ |

---

## 🔐 Security Features

### 1. Separate Authentication
- Platform admins use `/admin/login` (different from `/login`)
- Completely separate from business user authentication
- Different database table (`platform_admins` vs `users`)

### 2. Activity Logging
All admin actions are logged in `platform_admin_logs`:
- Login attempts
- Business modifications
- Subscription changes
- Plan updates
- Admin creation/deletion

### 3. Password Security
- Bcrypt hashing with 10 rounds
- No plaintext passwords stored
- Secure password reset flow (to be implemented)

### 4. Role-Based Access Control
- Hierarchical roles (viewer < support < admin < super_admin)
- Permission checks on every admin route
- UI elements hidden based on permissions

---

## 📊 Platform Metrics Explained

### Monthly Recurring Revenue (MRR)
Sum of all monthly subscription prices from active subscriptions.

```sql
SELECT SUM(sp.price_monthly) as mrr
FROM business_subscriptions bs
JOIN subscription_plans sp ON bs.plan_id = sp.id
WHERE bs.status = 'active'
```

### Annual Recurring Revenue (ARR)
`ARR = MRR × 12`

### Active Businesses
Businesses that created at least 1 invoice in the last 30 days.

### Trial Conversions
Businesses that upgraded from the free plan to any paid plan.

---

## 🛠️ How to Create Additional Platform Admins

### Method 1: Via API (After First Admin Login)

```bash
curl -X POST http://localhost:3000/api/admin/platform-users \
  -H "Content-Type: application/json" \
  -H "x-admin-id: YOUR_ADMIN_ID" \
  -d '{
    "name": "John Doe",
    "email": "john@khatario.com",
    "password": "secure_password_123",
    "role": "admin"
  }'
```

### Method 2: Via SQL (Direct Database Access)

```sql
-- Generate password hash first using the script
-- node scripts/generate_admin_password.js your_password

INSERT INTO platform_admins (name, email, password_hash, role, permissions)
VALUES (
  'Support Agent',
  'support@khatario.com',
  '$2b$10$YOUR_GENERATED_HASH_HERE',
  'support',
  '{
    "can_manage_admins": false,
    "can_manage_businesses": false,
    "can_manage_subscriptions": true,
    "can_view_metrics": true
  }'::jsonb
);
```

---

## 🧪 Testing the Platform Admin System

### 1. Test Login

```bash
# Visit in browser:
http://localhost:3000/admin/login

# Or test via API:
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@khatario.com", "password": "admin123"}'
```

**Expected Response:**
```json
{
  "success": true,
  "admin": {
    "id": "...",
    "name": "Platform Owner",
    "email": "admin@khatario.com",
    "role": "super_admin",
    "permissions": { ... }
  },
  "redirect": "/admin"
}
```

### 2. Test Metrics API

```bash
curl http://localhost:3000/api/admin/metrics
```

**Expected Response:**
```json
{
  "metrics": {
    "totalBusinesses": 5,
    "activeBusinesses": 3,
    "totalInvoices": 150,
    "mrr": 2997,
    "arr": 35964,
    ...
  },
  "subscriptionsByPlan": [...],
  "recentBusinesses": [...]
}
```

### 3. View Dashboard

```bash
# Visit in browser after login:
http://localhost:3000/admin
```

Should show:
- Stats cards (businesses, revenue, invoices)
- Subscription breakdown chart
- Recent businesses table

---

## 🔄 What's Next?

### Phase 3A: Platform Admin Management Pages

1. **`/admin/businesses`** - List/search all businesses
2. **`/admin/subscriptions`** - Manage subscriptions
3. **`/admin/plans`** - Create/edit plans
4. **`/admin/users`** - Manage platform admins
5. **`/admin/logs`** - Activity logs

### Phase 3B: In-App Upgrade Flow (for business users)

1. Show current plan in `/settings`
2. Upgrade/downgrade UI
3. Payment gateway integration (Razorpay)
4. Limit enforcement with upgrade prompts

### Phase 4: Missing Features

1. Suppliers UI
2. Purchases UI
3. Expenses UI
4. Reports UI
5. Email invoicing
6. Recurring invoices

---

## 🐛 Troubleshooting

### "Failed to connect to database"
- Ensure PostgreSQL is running
- Check `.env` file for correct credentials
- Verify database name is `khatario_db`

### "Invalid credentials" on admin login
- Ensure you ran `seed_platform_admin.sql`
- Verify password hash was generated correctly
- Check `platform_admins` table has the admin record

### "Admin not found" after login
- Check localStorage has `platform_admin` item
- Clear browser cache and retry
- Verify admin is `is_active = true`

### Metrics showing 0
- Ensure you have businesses and subscriptions in the database
- Run `seed_subscriptions.sql` to assign free plans
- Create test invoices via the business dashboard

---

## 📝 Architecture Summary

```
Platform Admin System
│
├── Authentication Layer
│   ├── /admin/login (UI)
│   ├── POST /api/admin/auth/login (API)
│   └── lib/platform-auth.ts (Logic)
│
├── Authorization Layer
│   ├── Role hierarchy (viewer → support → admin → super_admin)
│   ├── Permission checks (lib/platform-auth.ts)
│   └── Activity logging (platform_admin_logs)
│
├── Dashboard
│   ├── /admin (Overview)
│   ├── /admin/businesses (To be built)
│   ├── /admin/subscriptions (To be built)
│   └── /admin/users (To be built)
│
└── Database
    ├── platform_admins (Admin accounts)
    ├── platform_admin_logs (Activity tracking)
    ├── subscription_plans (Plan definitions)
    └── business_subscriptions (Business-plan mapping)
```

---

**Ready to go!** 🚀

Next steps: Apply the database changes and test the admin login.

