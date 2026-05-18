# Setup Instructions for Production

## Issue 1: HTTPS Setup

The `npm run start` command now uses HTTPS by default. You need to set up SSL certificates first:

### Step 1: Install mkcert (if not already installed)

**Windows:**
```powershell
# Run PowerShell as Administrator
.\scripts\install-mkcert-windows.ps1
```

Or download manually from: https://github.com/FiloSottile/mkcert/releases/latest
- Download: `mkcert-v1.4.4-windows-amd64.exe`
- Rename to `mkcert.exe` and add to PATH
- Run: `mkcert -install`

### Step 2: Generate SSL Certificates

```bash
npm run setup:https
```

This will create SSL certificates in the `certs/` folder.

### Step 3: Start the Server

```bash
npm run build
npm run start
```

The server will now run on `https://localhost:3000`

**Note:** If you want to use HTTP instead, use:
```bash
npm run start:http
```

---

## Issue 2: Login 404 Error

The login route should work after rebuilding. If you still get a 404:

1. **Rebuild the application:**
   ```bash
   npm run build
   ```

2. **Verify the route exists:**
   - Check that `app/api/auth/login/route.ts` exists
   - The route should be accessible at `/api/auth/login`

3. **Check the build output:**
   - Look for any errors during build
   - Ensure the route is included in the build

4. **Verify database connection:**
   - Ensure your `.env` file has correct database credentials
   - Test database connection: `npm run db:migrate`

---

## Issue 3: Redis 503 Error (Notifications Stream)

The notifications stream requires Redis to be running. This is **optional** - the app will work without it, but real-time notifications won't be available.

### Redis Setup (WSL/Ubuntu)

If you're using WSL (Windows Subsystem for Linux) with Redis running in Ubuntu:

1. **Verify Redis is running:**
   ```bash
   wsl sudo service redis-server status
   ```

2. **Test connection from Windows:**
   ```bash
   node -e "const Redis = require('ioredis'); const r = new Redis('redis://localhost:6379'); r.ping().then(res => console.log('✅ Connected:', res)).catch(err => console.error('❌ Failed:', err));"
   ```

3. **Ensure `.env` has:**
   ```
   REDIS_URL=redis://localhost:6379
   ```

4. **Restart the application** after setting up Redis to pick up the environment variable.

### Alternative: Set Up Redis on Windows

**Windows (Native):**
1. Download and install Memurai (Redis for Windows): https://www.memurai.com/
2. Start Memurai service
3. Add to `.env`:
   ```
   REDIS_URL=redis://localhost:6379
   ```

**Linux/Mac:**
```bash
# Install Redis
brew install redis  # macOS
# or
sudo apt-get install redis-server  # Ubuntu

# Start Redis
redis-server

# Add to .env
REDIS_URL=redis://localhost:6379
```

### Disable Notifications (If Redis Not Available)

The notifications feature will gracefully degrade if Redis is not available. The 503 error is expected and won't break the app - notifications just won't work in real-time.

To disable notifications completely, you can:
1. Remove or comment out the `REDIS_URL` in `.env`
2. The app will continue to work, but notifications won't stream in real-time

---

## Quick Start Checklist

- [ ] Run `npm run setup:https` to generate SSL certificates
- [ ] Run `npm run build` to build the application
- [ ] Run `npm run start` to start the HTTPS server
- [ ] (Optional) Set up Redis for real-time notifications
- [ ] Verify database connection in `.env` file

---

## Troubleshooting

### HTTPS Certificate Errors
- Make sure you ran `npm run setup:https`
- Check that `certs/localhost-key.pem` and `certs/localhost.pem` exist
- Try regenerating certificates: Delete `certs/` folder and run `npm run setup:https` again

### Login Still Returns 404
- Clear `.next` folder: `rm -rf .next` (or `rmdir /s .next` on Windows)
- Rebuild: `npm run build`
- Check server logs for errors

### Redis Connection Issues
- Verify Redis is running: `redis-cli ping` (should return `PONG`)
- Check `REDIS_URL` in `.env` matches your Redis configuration
- The app will work without Redis, but notifications won't stream in real-time
