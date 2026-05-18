# Redis/Memurai Setup Guide for Todo Reminders

## Why Redis/Memurai?

**Without Redis:** The app polls the database every 2 minutes from every user's browser, creating unnecessary server load.

**With Redis:** Reminders are scheduled in Redis and processed by a background worker. No polling needed! ✅

---

## Quick Setup (Choose One)

### Option 1: Memurai (Windows - Recommended)

1. **Download Memurai** (Free Redis-compatible for Windows)
   - Visit: https://www.memurai.com/get-memurai
   - Download and install

2. **Start Memurai**
   - Open Windows Start Menu
   - Search for "Memurai"
   - Click "Memurai" to start the service
   - It runs on port `6379` by default

3. **Add to `.env.local`**
   ```env
   REDIS_URL=redis://localhost:6379
   ```

4. **Test Connection**
   ```bash
   npm run test:redis
   ```

5. **Start Worker** (in a separate terminal)
   ```bash
   npm run worker:todo
   ```

✅ **Done!** Reminders will now be processed via Redis instead of polling.

---

### Option 2: Redis (Linux/macOS)

1. **Install Redis**
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Linux (Ubuntu/Debian)
   sudo apt-get install redis-server
   sudo systemctl start redis
   ```

2. **Add to `.env.local`**
   ```env
   REDIS_URL=redis://localhost:6379
   ```

3. **Test Connection**
   ```bash
   npm run test:redis
   ```

4. **Start Worker**
   ```bash
   npm run worker:todo
   ```

---

## Troubleshooting

### ❌ "REDIS_URL is not set"

**Fix:** Add to `.env.local`:
```env
REDIS_URL=redis://localhost:6379
```

Then restart your dev server.

---

### ❌ "Connection refused" or "ECONNREFUSED"

**Possible causes:**
1. Memurai/Redis is not running
2. Wrong port number
3. Firewall blocking connection

**Solutions:**

1. **Check if Memurai/Redis is running:**
   ```bash
   # Windows - Check Memurai service
   # Open Services (services.msc) and look for "Memurai"
   
   # Linux/macOS - Check Redis
   redis-cli ping
   # Should return: PONG
   ```

2. **Start Memurai (Windows):**
   - Open Start Menu → Search "Memurai" → Click to start
   - Or check Services: `services.msc` → Find "Memurai" → Start

3. **Start Redis (Linux/macOS):**
   ```bash
   # macOS
   brew services start redis
   
   # Linux
   sudo systemctl start redis
   ```

4. **Test connection:**
   ```bash
   npm run test:redis
   ```

---

### ❌ "Worker requires a connection"

**Fix:** Make sure:
1. `REDIS_URL` is set in `.env.local`
2. Memurai/Redis is running
3. Test connection first: `npm run test:redis`

---

## How It Works

### Without Redis (Current - Polling)
```
User Browser → Polls /api/todos/check-reminders every 2 minutes
              → Database query every 2 minutes per user
              → High server load with multiple users
```

### With Redis (Recommended - No Polling)
```
Todo Created → Scheduled in Redis Queue
            → Background Worker processes at reminder time
            → Creates notification
            → User sees popup when notification arrives
            → Zero polling, minimal server load
```

---

## Running the Worker

The worker must run **separately** from your dev server:

**Terminal 1 (Dev Server):**
```bash
npm run dev
```

**Terminal 2 (Worker):**
```bash
npm run worker:todo
```

The worker will:
- ✅ Connect to Redis/Memurai
- ✅ Process reminders at scheduled times
- ✅ Create notifications automatically
- ✅ Log activity for debugging

---

## Production Deployment

For production, you'll need:

1. **Redis Service** (e.g., Redis Cloud, AWS ElastiCache, or self-hosted)
2. **Worker Process** (e.g., PM2, systemd, or container)
3. **Environment Variable:** `REDIS_URL=redis://your-redis-host:6379`

**Example with PM2:**
```bash
pm2 start npm --name "todo-worker" -- run worker:todo
```

---

## Benefits of Using Redis

✅ **No Client-Side Polling** - Removes unnecessary database queries  
✅ **Accurate Timing** - Reminders fire exactly when scheduled  
✅ **Scalable** - Handles thousands of reminders efficiently  
✅ **Reliable** - Redis persists jobs even if server restarts  
✅ **Low Server Load** - One worker processes all reminders  

---

## Fallback Behavior

If Redis is not available:
- ✅ App still works
- ✅ Reminders use database polling (via `/api/todos/check-reminders`)
- ⚠️ Higher server load (but functional)

---

## Summary

1. **Install Memurai** (Windows) or **Redis** (Linux/macOS)
2. **Add `REDIS_URL=redis://localhost:6379`** to `.env.local`
3. **Test:** `npm run test:redis`
4. **Start worker:** `npm run worker:todo` (in separate terminal)
5. **Done!** No more polling, reminders work automatically 🎉
