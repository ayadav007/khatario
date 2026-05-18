# PostgreSQL Setup - Complete Step-by-Step Guide

## ✅ PostgreSQL is Installed - Let's Set It Up!

This guide will walk you through creating the database, connecting with pgAdmin, and getting everything ready for Khatario.

---

## 📋 **Prerequisites Check**

Before we start, let's verify PostgreSQL is installed:

### Check Installation

**Windows (Command Prompt or PowerShell):**
```bash
psql --version
```

**macOS/Linux:**
```bash
psql --version
```

**Expected output:** `psql (PostgreSQL) 12.x` or higher

If you get "command not found", PostgreSQL may not be in your PATH. Continue anyway - we'll connect through pgAdmin.

---

## 🎯 **Step 1: Start PostgreSQL Service**

PostgreSQL needs to be running before we can connect.

### Windows

**Option A: Check if it's running automatically**
- PostgreSQL usually starts automatically on Windows
- If not, open **Services** (Windows Key + R, type `services.msc`)
- Find "postgresql-x64-XX" service
- Right-click → Start (if stopped)

**Option B: Start via Command Prompt (as Administrator)**
```bash
net start postgresql-x64-14
```
(Replace `14` with your version number)

### macOS

```bash
brew services start postgresql
# OR
pg_ctl -D /usr/local/var/postgres start
```

### Linux

```bash
sudo systemctl start postgresql
# Check status
sudo systemctl status postgresql
```

---

## 🔐 **Step 2: Find Your PostgreSQL Password**

During installation, you were asked to set a password for the `postgres` user. **Do you remember it?**

- ✅ **Yes, I remember** → Skip to Step 3
- ❌ **No, I forgot** → See "Reset Password" section below

### Reset PostgreSQL Password (Windows)

If you forgot your password:

1. Open Command Prompt as **Administrator**
2. Navigate to PostgreSQL bin folder (usually):
   ```bash
   cd "C:\Program Files\PostgreSQL\14\bin"
   ```
   (Replace `14` with your version)

3. Reset password:
   ```bash
   psql -U postgres
   ```
   (It might ask for password - try common ones or see next step)

4. If that doesn't work, edit the `pg_hba.conf` file:
   - Location: `C:\Program Files\PostgreSQL\14\data\pg_hba.conf`
   - Find line: `host all all 127.0.0.1/32 md5`
   - Change `md5` to `trust` (temporarily)
   - Restart PostgreSQL service
   - Connect without password: `psql -U postgres`
   - Change password: `ALTER USER postgres WITH PASSWORD 'your_new_password';`
   - Change `pg_hba.conf` back to `md5`
   - Restart PostgreSQL service again

---

## 📊 **Step 3: Create Database Using pgAdmin (Easiest Method)**

pgAdmin is a visual tool that makes database management easy.

### Step 3.1: Open pgAdmin

1. **Windows:** Search for "pgAdmin" in Start menu and open it
2. **macOS:** Open from Applications folder or Spotlight
3. **Linux:** Type `pgadmin4` in terminal or find in applications

### Step 3.2: Connect to PostgreSQL Server

When pgAdmin opens, you'll see a login screen:

1. **Enter Master Password**
   - This is a password to protect your pgAdmin settings (create a new one or use existing)
   - This is NOT your PostgreSQL password

2. **Find PostgreSQL Server**
   - Look in the left sidebar
   - You should see: **Servers** → **PostgreSQL 14** (or your version)
   - Click to expand

3. **Enter PostgreSQL Password**
   - Double-click on **PostgreSQL 14** (or right-click → Connect)
   - Enter password when prompted (this is the `postgres` user password you set during installation)

**Can't connect?** See troubleshooting section at the end.

### Step 3.3: Create the Database

Once connected:

1. **Expand the server** in left sidebar
2. **Right-click on "Databases"** → **Create** → **Database...**

3. **Fill in the form:**
   - **Database name:** `khatario`
   - **Owner:** `postgres` (default)
   - **Encoding:** `UTF8` (default)
   - **Template:** `template0` (or leave default)
   - Click **Save**

4. **Verify:**
   - You should see `khatario` database appear in the left sidebar under "Databases"
   - ✅ Database created!

---

## 💻 **Step 4: Create Database Using Command Line (Alternative)**

If you prefer command line or pgAdmin isn't working:

### Windows

1. Open **Command Prompt** or **PowerShell**

2. Navigate to PostgreSQL bin folder:
   ```bash
   cd "C:\Program Files\PostgreSQL\14\bin"
   ```
   (Replace `14` with your version)

3. Create database:
   ```bash
   createdb -U postgres khatario
   ```

4. Enter password when prompted

### macOS/Linux

1. Open Terminal

2. Create database:
   ```bash
   createdb -U postgres khatario
   ```
   
   Or connect first:
   ```bash
   psql -U postgres
   ```
   Then inside psql:
   ```sql
   CREATE DATABASE khatario;
   \q
   ```

3. Verify:
   ```bash
   psql -U postgres -l
   ```
   You should see `khatario` in the list

---

## 🔗 **Step 5: Configure Environment Variables**

Now let's tell the app how to connect to the database.

### Step 5.1: Create `.env.local` File

1. Go to your project folder: `D:\MyApps\Khatario`
2. Create a new file named `.env.local`

**Windows (Command Prompt):**
```bash
cd D:\MyApps\Khatario
type nul > .env.local
```

**Windows (PowerShell):**
```powershell
cd D:\MyApps\Khatario
New-Item -Path .env.local -ItemType File
```

**macOS/Linux:**
```bash
cd /path/to/Khatario
touch .env.local
```

### Step 5.2: Add Database Configuration

Open `.env.local` in any text editor and paste:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_postgres_password_here
DB_SSL=false

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

**⚠️ IMPORTANT:** Replace `your_postgres_password_here` with your actual PostgreSQL password!

### Step 5.3: Verify File Location

Make sure `.env.local` is in the project root:
```
D:\MyApps\Khatario\
├── .env.local          ← Should be here
├── package.json
├── app/
├── components/
└── ...
```

---

## 🗄️ **Step 6: Run Database Migrations**

Now let's create all the tables in the database.

### Step 6.1: Install Dependencies (If Not Done)

```bash
cd D:\MyApps\Khatario
npm install
```

### Step 6.2: Run Migration Script

```bash
npm run db:migrate
```

**What this does:**
- Reads `database/schema.sql`
- Creates all tables (businesses, customers, items, invoices, etc.)
- Sets up indexes and triggers
- Takes about 10-30 seconds

**Expected output:**
```
Connecting to database...
Connected successfully!
Reading schema file...
Running migrations...
✅ Database schema created successfully!

Database setup complete!
You can now start the application with: npm run dev
```

### Step 6.3: Verify Tables Were Created

**Using pgAdmin:**

1. In pgAdmin, expand: **Servers** → **PostgreSQL 14** → **Databases** → **khatario** → **Schemas** → **public** → **Tables**
2. You should see ~20 tables including:
   - `businesses`
   - `users`
   - `customers`
   - `items`
   - `invoices`
   - `payments`
   - etc.

**Using Command Line:**
```bash
psql -U postgres -d khatario -c "\dt"
```

You should see a list of tables.

---

## ✅ **Step 7: Test Database Connection**

Let's verify everything is working.

### Test Connection from Command Line

```bash
psql -U postgres -d khatario
```

If it connects, you'll see:
```
psql (14.x)
Type "help" for help.

khatario=#
```

Type `\q` to exit.

### Test from Application

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Check console for errors. You should NOT see database connection errors.

3. Try accessing: `http://localhost:3000/dashboard`

---

## 🎯 **Step 8: Create a Test Business (Optional)**

To test the app, you might want to create a test business record.

### Using pgAdmin:

1. Right-click on `businesses` table → **View/Edit Data** → **All Rows**
2. Click **Add Row** icon (or right-click → Insert Row)
3. Fill in:
   - `name`: Test Business
   - `email`: test@example.com
   - `phone`: +91 9876543210
   - `currency`: INR
   - Leave other fields empty or set defaults
4. Click **Save**

### Using Command Line:

```bash
psql -U postgres -d khatario
```

Then:
```sql
INSERT INTO businesses (name, email, phone, currency)
VALUES ('Test Business', 'test@example.com', '+91 9876543210', 'INR')
RETURNING id;
```

**Save the returned ID** - you'll need it for testing!

---

## 🔧 **Troubleshooting**

### Problem: "Can't connect to PostgreSQL"

**Solutions:**
1. **Check if PostgreSQL is running:**
   - Windows: Open Services, find PostgreSQL service, start it
   - macOS: `brew services list` (check if started)
   - Linux: `sudo systemctl status postgresql`

2. **Check port:**
   - Default is `5432`
   - Verify in pgAdmin: Server Properties → Connection → Port

3. **Check firewall:**
   - Make sure port 5432 is not blocked

### Problem: "Password authentication failed"

**Solutions:**
1. Double-check password in `.env.local`
2. Try connecting manually: `psql -U postgres`
3. Reset password (see Step 2)

### Problem: "Database does not exist"

**Solutions:**
1. Verify database was created:
   ```bash
   psql -U postgres -l
   ```
2. Create it again if missing:
   ```bash
   createdb -U postgres khatario
   ```

### Problem: "Permission denied"

**Solutions:**
1. Make sure you're using the `postgres` user
2. Check file permissions on `.env.local`

### Problem: Migration fails

**Solutions:**
1. Check error message in console
2. Verify database exists
3. Check database connection settings in `.env.local`
4. Make sure PostgreSQL user has CREATE privileges

---

## 📝 **Quick Reference Commands**

### Common PostgreSQL Commands

```bash
# Connect to database
psql -U postgres -d khatario

# List all databases
psql -U postgres -l

# List tables in current database
\dt

# Describe a table
\d table_name

# Exit psql
\q

# Create database
createdb -U postgres khatario

# Drop database (careful!)
dropdb -U postgres khatario
```

### Application Commands

```bash
# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Start development server
npm run dev

# Build for production
npm run build
```

---

## ✅ **Checklist: Are You Ready?**

- [ ] PostgreSQL is installed
- [ ] PostgreSQL service is running
- [ ] You know your PostgreSQL password
- [ ] Database `khatario` is created
- [ ] `.env.local` file exists with correct credentials
- [ ] Migration script ran successfully
- [ ] Tables are visible in pgAdmin
- [ ] You can connect to database from command line
- [ ] Development server starts without database errors

---

## 🎉 **What's Next?**

Once all steps are complete:

1. ✅ Database is ready
2. ⏭️ Update components to use real data (replace dummy data)
3. ⏭️ Create your first business
4. ⏭️ Start adding customers and items
5. ⏭️ Create invoices!

---

## 📚 **Additional Resources**

- **pgAdmin Documentation:** https://www.pgadmin.org/docs/
- **PostgreSQL Documentation:** https://www.postgresql.org/docs/
- **Next.js Environment Variables:** https://nextjs.org/docs/basic-features/environment-variables

---

## 💡 **Tips**

1. **Keep your password safe** - Don't commit `.env.local` to git (it's already in `.gitignore`)

2. **Use pgAdmin for visual management** - It's easier than command line for beginners

3. **Test connection first** - Always verify you can connect before running migrations

4. **Backup regularly** - Once you have data, back up your database regularly

---

**You're all set! 🚀**

If you get stuck at any step, check the troubleshooting section or the error message for specific guidance.

