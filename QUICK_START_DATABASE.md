# Quick Start: Database Setup (5 Minutes)

## ✅ PostgreSQL is Installed - Follow These Steps

---

## Step 1: Open pgAdmin (2 minutes)

1. **Open pgAdmin** from Start menu (Windows) or Applications (macOS)

2. **Enter Master Password** (create one if first time)

3. **Connect to Server:**
   - Expand "Servers" in left sidebar
   - Double-click "PostgreSQL 14" (or your version)
   - Enter your PostgreSQL password (the one you set during installation)
   - Click OK

---

## Step 2: Create Database (1 minute)

1. In pgAdmin, **right-click "Databases"** → **Create** → **Database...**

2. **Enter:**
   - Database name: `khatario`
   - Owner: `postgres` (default)
   - Click **Save**

3. ✅ Database created! You'll see it in the left sidebar.

---

## Step 3: Create Environment File (1 minute)

1. Go to your project folder: `D:\MyApps\Khatario`

2. Create file `.env.local` (can use Notepad or any editor)

3. **Paste this:**
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=khatario
   DB_USER=postgres
   DB_PASSWORD=your_password_here
   DB_SSL=false
   
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NODE_ENV=development
   ```

4. **Replace `your_password_here`** with your actual PostgreSQL password!

---

## Step 4: Run Migrations (1 minute)

1. Open terminal in project folder:
   ```bash
   cd D:\MyApps\Khatario
   ```

2. Install dependencies (if not done):
   ```bash
   npm install
   ```

3. Run migration:
   ```bash
   npm run db:migrate
   ```

4. ✅ You should see: "Database schema created successfully!"

---

## Step 5: Verify (30 seconds)

**In pgAdmin:**
- Expand: **khatario** → **Schemas** → **public** → **Tables**
- You should see ~20 tables (businesses, customers, items, invoices, etc.)

**Or test connection:**
```bash
psql -U postgres -d khatario
```

Type `\q` to exit.

---

## ✅ Done!

Your database is ready! 

**Next steps:**
- Start the app: `npm run dev`
- The app will now be able to connect to the database
- You can start creating customers, items, and invoices!

---

## ❌ Having Issues?

### Can't connect to PostgreSQL?
- Check if PostgreSQL service is running (Windows Services)
- Verify password is correct

### Migration failed?
- Check `.env.local` file exists and password is correct
- Make sure database `khatario` exists

### Don't remember password?
- See detailed guide: `docs/POSTGRESQL_SETUP_GUIDE.md`
- Section: "Reset PostgreSQL Password"

---

**For detailed instructions, see:** `docs/POSTGRESQL_SETUP_GUIDE.md`

