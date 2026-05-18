# 🚀 START HERE - Database Setup Guide

## PostgreSQL is Installed ✅ - Let's Set It Up!

This is the **simplest, step-by-step guide** to get your database ready.

---

## 📋 **Step 1: Create Database (2 minutes)**

### Using pgAdmin (Easiest Way)

1. **Open pgAdmin**
   - Search "pgAdmin" in Windows Start menu
   - Click to open

2. **Connect to PostgreSQL**
   - Enter Master Password (create one if first time)
   - In left sidebar, expand **"Servers"**
   - Double-click **"PostgreSQL 14"** (or your version)
   - Enter your PostgreSQL password
   - Click OK

3. **Create Database**
   - Right-click **"Databases"** in left sidebar
   - Click **Create** → **Database...**
   - Enter name: `khatario`
   - Click **Save**

✅ **Done!** Database created.

---

## 📝 **Step 2: Create Environment File (1 minute)**

1. **Go to your project folder:**
   ```
   D:\MyApps\Khatario
   ```

2. **Create a file named `.env.local`**
   - Open Notepad
   - Save As → Navigate to `D:\MyApps\Khatario`
   - File name: `.env.local` (with the dot!)
   - Save as type: "All Files"

3. **Paste this content:**
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=khatario
   DB_USER=postgres
   DB_PASSWORD=YOUR_PASSWORD
   DB_SSL=false
   
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NODE_ENV=development
   ```

4. **Replace `YOUR_PASSWORD`** with your actual PostgreSQL password!

✅ **Done!** Environment file created.

---

## 🗄️ **Step 3: Run Migrations (2 minutes)**

1. **Open Terminal in project folder:**
   - Right-click in `D:\MyApps\Khatario` folder
   - Select "Open in Terminal" or "Open PowerShell"

2. **Install dependencies:**
   ```bash
   npm install
   ```
   (Wait for it to finish)

3. **Run migration:**
   ```bash
   npm run db:migrate
   ```

4. **You should see:**
   ```
   ✅ Database schema created successfully!
   ```

✅ **Done!** All tables created.

---

## ✅ **Step 4: Verify (30 seconds)**

**In pgAdmin:**
- Expand: **khatario** → **Schemas** → **public** → **Tables**
- You should see many tables (businesses, customers, items, etc.)

**Or test:**
```bash
npm run dev
```
App should start without database errors!

---

## 🎉 **You're Done!**

Your database is ready! 

**What's next:**
- The app can now connect to the database
- You can start creating customers, items, and invoices
- Real data will be saved!

---

## ❌ **Having Problems?**

### Can't connect to PostgreSQL?
- Check if PostgreSQL service is running (Windows Services)
- Verify password is correct

### Migration failed?
- Check `.env.local` file exists
- Verify password is correct in `.env.local`
- Make sure database `khatario` exists

### Need more help?
- See detailed guide: `docs/POSTGRESQL_SETUP_GUIDE.md`
- Or: `SETUP_STEPS.md`

---

## 📚 **Quick Reference**

**Create database:** pgAdmin → Right-click Databases → Create → Database → Name: `khatario`

**Environment file:** `.env.local` in project root with database credentials

**Run migrations:** `npm run db:migrate`

**Verify:** Check tables in pgAdmin or run `npm run dev`

---

**That's it! Simple and fast. 🚀**

