# Setup Steps - PostgreSQL Database

## 🎯 Quick Overview

Since PostgreSQL is installed, you just need to:
1. Create the database
2. Configure environment variables
3. Run migrations

**Time: ~5 minutes**

---

## 📝 Step-by-Step Instructions

### Step 1: Create Database Using pgAdmin ⭐ (Easiest)

#### A. Open pgAdmin
- Search "pgAdmin" in Windows Start menu
- Or find it in Applications folder

#### B. Connect to PostgreSQL
1. Enter Master Password (create one if first time - this protects pgAdmin settings)
2. In left sidebar, expand **Servers**
3. Double-click **PostgreSQL 14** (or your version number)
4. Enter your PostgreSQL password (the one you set during installation)
5. Click OK

**Trouble connecting?**
- Check if PostgreSQL service is running
- Try password you set during installation
- If forgot password, see troubleshooting below

#### C. Create Database
1. In left sidebar, **right-click on "Databases"**
2. Click **Create** → **Database...**
3. Fill in:
   - **Database name:** `khatario`
   - **Owner:** `postgres` (default - leave as is)
4. Click **Save**

✅ **Done!** You should see `khatario` database appear in the list.

---

### Step 2: Create Environment File

#### A. Go to Project Folder
```
D:\MyApps\Khatario
```

#### B. Create `.env.local` File

**Windows (Easiest):**
1. Open Notepad (or any text editor)
2. Save As → Navigate to `D:\MyApps\Khatario`
3. File name: `.env.local` (include the dot at the beginning!)
4. Save as type: "All Files"

**Or Command Prompt:**
```bash
cd D:\MyApps\Khatario
type nul > .env.local
```

#### C. Add This Content

Open `.env.local` and paste:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_SSL=false

NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

**⚠️ IMPORTANT:** Replace `YOUR_PASSWORD_HERE` with your actual PostgreSQL password!

#### D. Verify File Location

Make sure the file is here:
```
D:\MyApps\Khatario\
├── .env.local       ← Should be here
├── package.json
├── app/
└── ...
```

---

### Step 3: Run Database Migrations

#### A. Open Terminal in Project Folder

**Windows:**
- Right-click in `D:\MyApps\Khatario` folder
- Select "Open in Terminal" or "Open PowerShell here"

#### B. Install Dependencies (If Not Done)

```bash
npm install
```

Wait for it to finish (~1-2 minutes)

#### C. Run Migration

```bash
npm run db:migrate
```

**What you should see:**
```
Connecting to database...
Connected successfully!
Reading schema file...
Running migrations...
✅ Database schema created successfully!

Database setup complete!
You can now start the application with: npm run dev
```

**If you see errors:**
- Check `.env.local` file exists
- Verify password is correct
- Make sure database `khatario` exists

---

### Step 4: Verify Everything Works

#### Option A: Check in pgAdmin

1. In pgAdmin, refresh the database list
2. Expand: **khatario** → **Schemas** → **public** → **Tables**
3. You should see many tables:
   - businesses
   - customers
   - items
   - invoices
   - payments
   - etc. (~20 tables)

#### Option B: Test Connection

```bash
psql -U postgres -d khatario
```

If it connects, you'll see:
```
khatario=#
```

Type `\q` to exit.

---

## ✅ You're Done!

Your database is set up and ready!

**Next:**
1. Start the app: `npm run dev`
2. Database connection should work
3. Start using the app!

---

## 🔧 Troubleshooting

### Problem: Can't Connect to PostgreSQL in pgAdmin

**Solutions:**
1. **Check PostgreSQL is running:**
   - Press `Windows Key + R`
   - Type `services.msc` and press Enter
   - Find "postgresql-x64-14" (or your version)
   - If status is "Stopped", right-click → Start

2. **Try default password:**
   - Try "postgres" (common default)
   - Or password you set during installation

3. **Reset password** (if forgot):
   - See detailed guide below

### Problem: "Database does not exist"

**Solution:**
- Make sure you created the database in Step 1
- Check spelling: `khatario` (all lowercase)
- Create it again if needed

### Problem: Migration fails with "password authentication failed"

**Solutions:**
1. Double-check password in `.env.local`
2. Make sure password matches what you use in pgAdmin
3. Try connecting manually:
   ```bash
   psql -U postgres
   ```
   (Enter password when prompted)

### Problem: "Cannot find .env.local"

**Solutions:**
1. Make sure file is in project root: `D:\MyApps\Khatario`
2. Check file name is exactly `.env.local` (with the dot!)
3. Make sure it's not `.env.local.txt` (Windows sometimes adds .txt)

### Problem: "Command not found: psql"

**Solution:**
- PostgreSQL might not be in PATH
- Use pgAdmin instead (easier!)
- Or add PostgreSQL bin folder to PATH

---

## 🔐 Reset PostgreSQL Password (If Forgotten)

### Quick Method (Windows):

1. **Edit pg_hba.conf:**
   - Location: `C:\Program Files\PostgreSQL\14\data\pg_hba.conf`
   - Open with Notepad (as Administrator)
   - Find line: `host all all 127.0.0.1/32 md5`
   - Change `md5` to `trust`
   - Save file

2. **Restart PostgreSQL:**
   - Open Services (Windows Key + R → `services.msc`)
   - Find PostgreSQL service
   - Right-click → Restart

3. **Connect without password:**
   ```bash
   psql -U postgres
   ```

4. **Change password:**
   ```sql
   ALTER USER postgres WITH PASSWORD 'your_new_password';
   \q
   ```

5. **Revert pg_hba.conf:**
   - Change `trust` back to `md5`
   - Restart PostgreSQL service again

---

## 📚 Alternative: Create Database via Command Line

If pgAdmin doesn't work, use command line:

### Windows:

1. Open Command Prompt
2. Navigate to PostgreSQL bin:
   ```bash
   cd "C:\Program Files\PostgreSQL\14\bin"
   ```
   (Replace `14` with your version)

3. Create database:
   ```bash
   createdb -U postgres khatario
   ```

4. Enter password when prompted

### macOS/Linux:

```bash
createdb -U postgres khatario
```

---

## 🎯 Quick Checklist

Before moving forward, verify:

- [ ] PostgreSQL service is running
- [ ] Can connect to PostgreSQL in pgAdmin
- [ ] Database `khatario` is created
- [ ] `.env.local` file exists in project root
- [ ] `.env.local` has correct password
- [ ] Migration script ran successfully
- [ ] Can see tables in pgAdmin (or via command line)

---

## 💡 Pro Tips

1. **Keep password safe** - `.env.local` is already in `.gitignore` so it won't be committed

2. **Use pgAdmin for visual management** - Much easier than command line!

3. **Test connection first** - Always verify you can connect before running migrations

4. **Write down your password** - Store it securely (password manager recommended)

---

## 📖 Need More Help?

- **Detailed Guide:** See `docs/POSTGRESQL_SETUP_GUIDE.md`
- **Quick Start:** See `QUICK_START_DATABASE.md`
- **Environment Variables:** See `ENV_VARIABLES_GUIDE.md`

---

**Once all steps are complete, you're ready to use the app! 🚀**

