# BullMQ Worker Setup Guide

## ✅ Implementation Status

**Everything is already implemented and ready to use!**

- ✅ Redis connection management (`lib/queue/redis.ts`)
- ✅ BullMQ queue for todo reminders (`lib/queue/todoReminderQueue.ts`)
- ✅ Worker for processing reminders (`lib/workers/todoReminderWorker.ts`)
- ✅ Reminder scheduling in API routes (POST `/api/todos` and PATCH `/api/todos/:id`)
- ✅ Worker start script in `package.json`

---

## 🚀 Quick Start

### Step 1: Verify Redis Connection

Before starting the worker, ensure Redis is working:

```bash
npm run verify:redis
```

**Expected output:**
```
✅ Redis is working! PING test successful.
💡 Recommended REDIS_URL: redis://127.0.0.1:6379
🚀 Ready to proceed with BullMQ/Worker implementation!
```

### Step 2: Ensure `.env.local` Has REDIS_URL

Check your `.env.local` file has:

```env
REDIS_URL=redis://localhost:6379
```

Or:

```env
REDIS_URL=redis://127.0.0.1:6379
```

### Step 3: Start the Worker

**In a separate terminal window** (keep your dev server running), start the worker:

```bash
npm run worker:todo
```

**Expected output:**
```
[Todo Reminder Worker] Checking Redis connection...
[Todo Reminder Worker] Connecting to Redis...
[Todo Reminder Worker] Redis connected successfully
[Todo Reminder Worker] Redis ready, starting worker...
[Todo Reminder Worker] Started and listening for jobs
```

### Step 4: Keep Worker Running

**Important:** The worker must be running continuously for reminders to be processed in real-time.

- ✅ **Keep the worker terminal open** - don't close it
- ✅ **Keep Redis running** (in WSL, your `redis-server` should be running)
- ✅ **Keep your dev server running** in another terminal

---

## 📋 How It Works

### 1. Todo Created/Updated

When you create or update a todo with a reminder:

1. API route (`POST /api/todos` or `PATCH /api/todos/:id`) calls `scheduleTodoReminder()`
2. `scheduleTodoReminder()` creates a BullMQ job with a delay
3. Job is queued in Redis for future processing

### 2. Worker Processes Reminder

When the reminder time arrives:

1. BullMQ worker picks up the job from Redis queue
2. Worker validates todo (status, subscription, etc.)
3. Worker creates notification in database
4. Worker marks reminder as sent
5. User sees popup notification in the app

### 3. Fallback: Database Polling

If Redis is not available or worker is not running:

- System falls back to database polling via `/api/todos/check-reminders`
- Reminders are processed with a delay (checks every 2 minutes)
- Not as precise as BullMQ, but still works

---

## 🧪 Testing

### Test 1: Create Todo with Reminder

1. Open your app: `http://localhost:3000/tools/todo`
2. Create a todo with:
   - **Due Date**: Today
   - **Reminder Time**: 1 minute from now
   - **Reminder Type**: Once
3. Click "Create"

**Check worker logs** - you should see:
```
[Todo Reminder Queue] Scheduled reminder for todo <id> at <time>
```

### Test 2: Wait for Reminder

1. Wait until reminder time arrives
2. **Check worker logs** - you should see:
```
[Todo Reminder Worker] Processing reminder for todo <id>
[Todo Reminder Worker] Successfully processed reminder for todo <id>
```
3. **Check your app** - you should see a popup notification

### Test 3: Verify Notification

1. Check bell icon in top navigation - should show unread notification
2. Click bell icon - should show "Reminder: <todo title>"
3. Click notification - should navigate to todo list

---

## 🔧 Troubleshooting

### ❌ "Redis connection not available"

**Cause:** Redis is not running or REDIS_URL is incorrect.

**Solution:**
1. Verify Redis is running:
   ```bash
   # In WSL
   redis-cli ping
   # Should return: PONG
   ```

2. Check REDIS_URL in `.env.local`:
   ```env
   REDIS_URL=redis://localhost:6379
   ```

3. Test connection:
   ```bash
   npm run verify:redis
   ```

### ❌ "Worker requires a connection"

**Cause:** Worker couldn't connect to Redis.

**Solution:**
1. Ensure Redis is running (WSL or Windows)
2. Check REDIS_URL is set correctly
3. Restart worker: `npm run worker:todo`

### ❌ Reminders not appearing at exact time

**Cause:** Worker is not running or Redis connection failed.

**Solution:**
1. Ensure worker is running: `npm run worker:todo`
2. Check worker logs for errors
3. Verify Redis connection: `npm run verify:redis`
4. Check if reminders are being scheduled (check API route logs)

### ❌ "Command failed: ts-node"

**Cause:** `ts-node` not installed or TypeScript config issue.

**Solution:**
```bash
npm install --save-dev ts-node
```

### ⚠️ Reminders working but delayed

**Cause:** Worker is not running, falling back to database polling.

**Solution:**
Start the worker:
```bash
npm run worker:todo
```

Database polling checks every 2 minutes, so reminders can be delayed. For exact-time reminders, the worker must be running.

---

## 📁 File Structure

```
lib/
  queue/
    redis.ts              # Redis connection management
    todoReminderQueue.ts  # BullMQ queue setup & scheduling
  workers/
    todoReminderWorker.ts # Worker that processes reminders
app/api/
  todos/
    route.ts              # POST - Creates todos & schedules reminders
    [id]/route.ts         # PATCH - Updates todos & reschedules reminders
```

---

## 🔄 Development Workflow

### Normal Development

**Terminal 1 - Dev Server:**
```bash
npm run dev
```

**Terminal 2 - Worker:**
```bash
npm run worker:todo
```

**Terminal 3 - Redis (if in WSL):**
```bash
# Redis should be running automatically in WSL
# If not: sudo service redis-server start
```

### Stopping Worker

Press `Ctrl+C` in the worker terminal to stop gracefully.

Worker will:
- Close Redis connection
- Finish processing current jobs
- Exit cleanly

---

## 🎯 Summary

**For exact-time reminders:**
- ✅ Redis must be running
- ✅ Worker must be running (`npm run worker:todo`)
- ✅ REDIS_URL must be set in `.env.local`

**For delayed reminders (fallback):**
- ⚠️ System falls back to database polling if Redis/worker unavailable
- ⚠️ Checks every 2 minutes (not exact-time)

**Ready to use?**
1. Start Redis (WSL: `sudo service redis-server start`)
2. Start worker: `npm run worker:todo`
3. Create todos with reminders
4. Watch for notifications at reminder time! 🎉
