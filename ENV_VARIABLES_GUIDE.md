# Environment Variables Guide

## ✅ YES, You Need Environment Variables!

Environment variables are **required** for the application to work properly, especially for database connection.

## Required Environment Variables

### 1. Database Connection (REQUIRED)

These are **absolutely necessary** for the app to connect to PostgreSQL:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false
```

**Where they're used:**
- `lib/db.ts` - Database connection pool

**What happens without them:**
- App will try to connect with defaults
- May work for local development if defaults match
- **Will fail in production** without proper credentials

---

### 2. Application Configuration (Optional but Recommended)

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

**Where they're used:**
- `NODE_ENV` - Controls logging, debug mode in `lib/db.ts`
- `NEXT_PUBLIC_APP_URL` - For generating links, PDFs, etc.

**What happens without them:**
- App will still work
- Uses defaults (localhost:3000 for development)

---

### 3. WhatsApp Integration (Optional)

```env
WHATSAPP_CLOUD_API_KEY=
WHATSAPP_CLOUD_API_SECRET=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_SESSION_PATH=./whatsapp-sessions
```

**Where they're used:**
- `lib/whatsapp.ts` - WhatsApp Cloud API connection

**What happens without them:**
- WhatsApp features won't work
- App will still function for other features

---

### 4. Groq API (Optional - for HSN/SAC AI Validation)

```env
GROQ_API_KEY=your_groq_api_key_here
```

**Where it's used:**
- `lib/services/groq-hsn-validator.ts` - AI-powered HSN/SAC code validation
- `app/api/hsn/validate/route.ts` - HSN validation endpoint

**What happens without it:**
- AI validation features won't work
- System will fall back to local database search only
- No error - feature gracefully degrades

**How to get API key:**
1. Sign up at https://console.groq.com
2. Get free API key (14,400 requests/day free tier)
3. Add to `.env.local`

### 5. JWT/Auth Secrets (For Future Auth Implementation)

```env
JWT_SECRET=your_jwt_secret_here
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret_here
```

**Where they'll be used:**
- Authentication system (when implemented)

**What happens without them:**
- Auth won't work (not implemented yet anyway)

---

## How to Set Up Environment Variables

### Step 1: Create `.env.local` File

In your project root directory, create a file named `.env.local`:

```bash
# Windows
type nul > .env.local

# macOS/Linux
touch .env.local
```

### Step 2: Add Your Variables

Copy this template and fill in your values:

```env
# Database Configuration (REQUIRED)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_SSL=false

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# WhatsApp Configuration (Optional)
# WHATSAPP_CLOUD_API_KEY=
# WHATSAPP_CLOUD_API_SECRET=
# WHATSAPP_PHONE_NUMBER_ID=

# Authentication (For Future)
# JWT_SECRET=generate_random_string_here
```

### Step 3: Replace Placeholder Values

**Important:** Replace these with your actual values:

- `your_postgres_password` → Your PostgreSQL password
- `khatario` → Your database name (if different)
- `postgres` → Your PostgreSQL username (if different)

### Step 4: Restart Development Server

After creating/modifying `.env.local`:

```bash
# Stop the server (Ctrl+C)
# Then restart
npm run dev
```

---

## Environment File Types in Next.js

Next.js supports multiple env file types with different priorities:

1. **`.env.local`** - **Use this one!** (highest priority, not committed to git)
2. `.env.development` - Development-specific
3. `.env.production` - Production-specific
4. `.env` - Default (lowest priority)

**Recommendation:** Use `.env.local` for all local development.

---

## Security Best Practices

### ✅ DO:

1. **Use `.env.local`** - It's already in `.gitignore`
2. **Never commit** `.env.local` to git
3. **Use strong passwords** for database
4. **Keep secrets secure** - Don't share them
5. **Use different values** for development/production

### ❌ DON'T:

1. **Don't commit** `.env.local` to git
2. **Don't hardcode** secrets in code
3. **Don't share** `.env.local` files
4. **Don't use** production credentials in development

---

## Current Code Usage

### Database Connection (`lib/db.ts`)

```typescript
pool = new Pool({
  host: process.env.DB_HOST || 'localhost',        // Default: localhost
  port: parseInt(process.env.DB_PORT || '5432'),    // Default: 5432
  database: process.env.DB_NAME || 'khatario',      // Default: khatario
  user: process.env.DB_USER || 'postgres',          // Default: postgres
  password: process.env.DB_PASSWORD || '',          // Default: '' (will fail!)
  ssl: process.env.DB_SSL === 'true' ? {...} : false,
});
```

**Note:** The code has defaults, but `DB_PASSWORD` defaults to empty string which will fail!

---

## Quick Setup Checklist

- [ ] Create `.env.local` file in project root
- [ ] Add database connection variables
- [ ] Replace `DB_PASSWORD` with your PostgreSQL password
- [ ] Add `NEXT_PUBLIC_APP_URL` (optional)
- [ ] Verify `.env.local` is in `.gitignore` (already is!)
- [ ] Restart development server

---

## Troubleshooting

### "Database connection failed"

**Check:**
1. Is PostgreSQL running?
   ```bash
   # Check if PostgreSQL is running
   pg_isready
   ```

2. Are environment variables set correctly?
   ```bash
   # Check if variables are loaded (in Node.js)
   console.log(process.env.DB_HOST);
   ```

3. Is password correct?
   - Try connecting manually: `psql -U postgres -d khatario`

### "Environment variables not loading"

**Solutions:**
1. Make sure file is named `.env.local` (not `.env.local.txt`)
2. Restart development server after changes
3. Check file is in project root (same level as `package.json`)
4. Verify no typos in variable names

### "Can't find DB_NAME"

**Check:**
1. Database exists: `psql -l | grep khatario`
2. Create if missing: `createdb khatario`
3. Variable name is exact: `DB_NAME` (case-sensitive)

---

## Production Deployment

For production (Vercel, Railway, etc.):

1. **Set environment variables** in hosting platform dashboard
2. **Never commit** `.env.local` (already in `.gitignore`)
3. **Use platform-specific** env variable settings
4. **Enable SSL** for database: `DB_SSL=true`

---

## Example: Complete `.env.local`

```env
# ===========================================
# DATABASE CONFIGURATION (REQUIRED)
# ===========================================
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=mypassword123
DB_SSL=false

# ===========================================
# APPLICATION CONFIGURATION
# ===========================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# ===========================================
# WHATSAPP CONFIGURATION (Optional)
# ===========================================
# WHATSAPP_CLOUD_API_KEY=EAAG...
# WHATSAPP_CLUOD_API_SECRET=abc123...
# WHATSAPP_PHONE_NUMBER_ID=123456789

# ===========================================
# GROQ API (Optional - for HSN/SAC validation)
# ===========================================
# Get free API key from: https://console.groq.com/keys
# Free tier: 14,400 requests/day
# GROQ_API_KEY=your_groq_api_key_here

# ===========================================
# AUTHENTICATION (For Future)
# ===========================================
# JWT_SECRET=generate_a_random_string_here
# NEXTAUTH_SECRET=another_random_string
```

---

## Summary

**YES, you need environment variables!**

**Minimum required:**
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

**Optional but useful:**
- `NEXT_PUBLIC_APP_URL`
- `NODE_ENV`
- WhatsApp credentials

**Action:** Create `.env.local` file now with your database credentials!

