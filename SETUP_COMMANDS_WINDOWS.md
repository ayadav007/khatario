# 🪟 Windows Setup Commands

## ✅ Step-by-Step Instructions

### 1️⃣ Run Database Migration

```powershell
node scripts/migrate.js
```

**Expected Output:**
```
Connecting to database...
Connected successfully!
Reading schema file...
Running migrations...
✅ Migration completed successfully!
```

### 2️⃣ Run Seed Scripts

```powershell
node scripts/seed.js
```

**Expected Output:**
```
🌱 Starting Database Seeding...
✅ Database connection successful!

📦 Seeding Subscription Plans...
✅ Successfully executed seed_subscriptions.sql

👑 Seeding Platform Admin...
✅ Successfully executed seed_platform_admin.sql

🎉 All seed data loaded successfully!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 Platform Admin Credentials
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URL:      http://localhost:3000/admin/login
Email:    admin@khatario.com
Password: admin123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3️⃣ Start the Application

```powershell
npm run dev
```

**Expected Output:**
```
> khatario@0.1.0 dev
> next dev

  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
  - Network:      http://192.168.x.x:3000

 ✓ Ready in 2.3s
```

---

## 🧪 Testing Checklist

### Test 1: Platform Admin Login ✅

1. Open browser: `http://localhost:3000/admin/login`
2. Enter credentials:
   - **Email**: `admin@khatario.com`
   - **Password**: `admin123`
3. Click "Sign In"
4. **Expected**: Redirected to admin dashboard with metrics

### Test 2: Platform Admin Dashboard ✅

Should see:
- 📊 **Metrics Cards**: Total Businesses, Active Businesses, MRR, ARR
- 📈 **Subscription Breakdown**: Chart showing businesses by plan
- 📋 **Recent Businesses**: Table of latest signups

### Test 3: Platform Admin Pages ✅

Navigate to:
- `/admin` - Dashboard ✅
- `/admin/businesses` - All businesses list ✅
- `/admin/plans` - Subscription plans management ✅

### Test 4: Business User - Subscription Tab ✅

1. Login as a business user at `http://localhost:3000/login`
2. Go to **Settings** → **Subscription & Billing** tab
3. **Expected**: 
   - Current plan displayed (FREE by default)
   - Usage limits shown
   - "Upgrade" button visible

### Test 5: New Modules ✅

Test these pages as a business user:
- `/suppliers` - Suppliers management
- `/expenses` - Expense tracking
- `/purchases` - Purchase orders
- `/reports` - Sales, Purchase, Stock reports

---

## 🐛 Troubleshooting

### Issue: "Migration failed: trigger already exists"
**Solution**: Already fixed! Schema now drops existing triggers first.

### Issue: "psql is not recognized"
**Solution**: Already fixed! Use `node scripts/seed.js` instead.

### Issue: "password authentication failed"
**Solution**: Update `.env` file with correct `DB_PASSWORD`:
```env
DB_PASSWORD=your_actual_password
```

### Issue: "database does not exist"
**Solution**: Create the database first:
```powershell
# If you have psql in PATH:
createdb -U postgres khatario_db

# OR use pgAdmin to create database manually
```

### Issue: Port 3000 already in use
**Solution**: Kill the process or use a different port:
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual number)
taskkill /PID <PID> /F

# OR change port in package.json
"dev": "next dev -p 3001"
```

---

## 📊 What Gets Seeded

### Subscription Plans (4):
1. **FREE** - ₹0/month
   - 20 invoices/month
   - 10 customers
   - Basic features

2. **PROFESSIONAL** - ₹299/month
   - 500 invoices/month
   - Unlimited customers
   - Suppliers, Expenses, Purchases
   - WhatsApp (10/day)

3. **BUSINESS** - ₹999/month
   - Unlimited everything
   - Advanced Reports
   - GST Reports
   - WhatsApp automation (100/day)

4. **ENTERPRISE** - ₹2,999/month
   - All features
   - API access
   - Custom branding
   - Priority support

### Feature Flags (40+):
- Template access controls
- Module permissions
- Limit definitions
- Integration toggles

### Platform Admin (1):
- Email: `admin@khatario.com`
- Password: `admin123`
- Role: `super_admin`
- Full permissions

### Auto-Configuration:
- ✅ All existing businesses get FREE plan
- ✅ 30-day trial period
- ✅ Usage tracking initialized

---

## ✅ Success Criteria

After running all commands, you should have:

1. ✅ **8 new database tables** created
2. ✅ **4 subscription plans** seeded
3. ✅ **40+ feature flags** defined
4. ✅ **1 platform admin** account created
5. ✅ **Existing businesses** assigned to FREE plan
6. ✅ **App running** on http://localhost:3000

---

## 🎉 Next Steps

Once everything is running:

1. **Test Platform Admin**:
   - Login at `/admin/login`
   - Explore dashboard, businesses, plans

2. **Test Business Features**:
   - Check subscription in settings
   - Try new modules (Suppliers, Expenses, Purchases, Reports)

3. **Create Test Data**:
   - Add a supplier
   - Record an expense
   - View reports

4. **Test Upgrade Flow**:
   - Click "Upgrade" in subscription tab
   - View plan comparison modal

---

**Ready to test!** 🚀

If you encounter any issues, check the troubleshooting section above or let me know!

