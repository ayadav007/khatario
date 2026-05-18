# Environment Variables Setup - Quick Guide

## ✅ Yes, Environment Variables Are Required!

The app **needs** environment variables to connect to PostgreSQL database.

## Quick Setup (5 Minutes)

### Step 1: Create `.env.local` File

In your project root (same folder as `package.json`), create a file named `.env.local`.

**Windows:**
```powershell
New-Item -Path .env.local -ItemType File
```

**macOS/Linux:**
```bash
touch .env.local
```

### Step 2: Copy This Template

Open `.env.local` and paste:

```env
# Database Configuration (REQUIRED)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

### Step 3: Update Values

**Replace these with your actual values:**

- `your_password_here` → Your PostgreSQL password
- `khatario` → Your database name (if different)
- `postgres` → Your PostgreSQL username (if different)

### Step 4: Restart Server

```bash
# Stop server (Ctrl+C), then:
npm run dev
```

## Required vs Optional

### 🔴 Required (App won't work without these)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL server address |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `khatario` | Database name |
| `DB_USER` | `postgres` | Database username |
| `DB_PASSWORD` | _(empty)_ | **Database password** ⚠️ Must set! |
| `DB_SSL` | `false` | Enable SSL (use `true` for production) |

### 🟡 Optional (App works but features disabled)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Base URL for links/PDFs |
| `NODE_ENV` | `development` or `production` |
| `WHATSAPP_CLOUD_API_KEY` | For WhatsApp integration |
| `JWT_SECRET` | For authentication (future) |

## Security Notes

✅ **`.env.local` is already in `.gitignore`** - safe to commit code
❌ **Never commit** `.env.local` file itself
✅ **Use different passwords** for development/production

## Troubleshooting

**"Can't connect to database"**
- Check PostgreSQL is running: `pg_isready`
- Verify password in `.env.local`
- Test connection: `psql -U postgres -d khatario`

**"Environment variables not loading"**
- File must be named exactly `.env.local`
- File must be in project root
- Restart dev server after changes

## Full Guide

See `ENV_VARIABLES_GUIDE.md` for complete documentation.

## Example File

See `env.example` for a complete template with comments.

