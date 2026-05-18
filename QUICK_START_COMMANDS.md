# Quick Start - Database Setup

## ✅ Schema Fixed!
The trigger issue has been resolved. The schema now drops existing triggers before creating new ones.

## 🚀 Run These Commands Now

```powershell
# 1. Run the migration (now fixed)
node scripts/migrate.js

# 2. Seed subscription plans
$env:PGPASSWORD="admin"
psql -U postgres -d khatario_db -f database/seed_subscriptions.sql

# 3. Seed platform admin (password: admin123)
psql -U postgres -d khatario_db -f database/seed_platform_admin.sql

# 4. Start the app
npm run dev
```

## 🎯 Then Test These URLs

**Platform Admin:**
- URL: `http://localhost:3000/admin/login`
- Email: `admin@khatario.com`
- Password: `admin123`

**Business User:**
- URL: `http://localhost:3000/login`
- Use your existing business account
- Go to Settings → "Subscription & Billing" tab

## 🧪 Test Checklist

**Platform Admin Dashboard:**
- [ ] View metrics (MRR, ARR, total businesses)
- [ ] Browse businesses list
- [ ] View subscription plans
- [ ] Search businesses

**Business User Features:**
- [ ] View current subscription plan
- [ ] Click "Upgrade" to see plan comparison
- [ ] Test `/suppliers` - Add a supplier
- [ ] Test `/expenses` - Record an expense
- [ ] Test `/purchases` - View purchases
- [ ] Test `/reports` - View all reports

## 💡 If You See Errors

**"relation already exists"**
- This is OK! Tables already exist from previous migrations
- The script will continue and add new columns/tables

**"trigger already exists"**
- Fixed! This should not happen anymore

**"password authentication failed"**
- Update your `.env` file with correct DB_PASSWORD

## 📊 What Gets Created

### New Tables:
- `subscription_plans` (4 plans seeded)
- `business_subscriptions`
- `feature_flags` (40+ flags seeded)
- `subscription_usage`
- `platform_admins` (1 super admin seeded)
- `platform_admin_logs`

### Existing businesses:
- Will automatically get FREE plan assigned
- Will get 30-day trial period

## 🎉 After Successful Setup

You'll have:
1. ✅ Working platform admin login
2. ✅ Subscription plans configured
3. ✅ Business users with FREE plan
4. ✅ All new modules (Suppliers, Expenses, Purchases, Reports)

**Ready to go!** 🚀

