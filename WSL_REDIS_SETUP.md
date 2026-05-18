# Connecting to Redis in WSL from Windows

Since you have **Redis installed in WSL Ubuntu** and your **Node.js app running on Windows**, you need to use the WSL IP address to connect.

## Quick Setup

### Step 1: Get WSL IP Address

**From Windows PowerShell or Command Prompt:**
```powershell
wsl hostname -I
```

**Example output:**
```
172.24.64.1
```

### Step 2: Update `.env.local`

Open `.env.local` and set:

```env
REDIS_URL=redis://172.24.64.1:6379
```

Replace `172.24.64.1` with your actual WSL IP address from Step 1.

### Step 3: Verify Connection

Run the diagnostic script:
```bash
npm run verify:redis
```

It should now detect Redis in WSL and test the connection using the WSL IP.

---

## Detailed Steps

### 1. Verify Redis is Running in WSL

**From WSL Ubuntu terminal:**
```bash
redis-cli ping
```

**Expected output:**
```
PONG
```

If you get `PONG`, Redis is running correctly in WSL.

### 2. Get WSL IP Address from Windows

**From Windows PowerShell:**
```powershell
wsl hostname -I
```

**Note:** WSL IP address can change after restart. If it changes, update `.env.local`.

### 3. Test Connection from Windows

**From Windows PowerShell:**
```powershell
# Test if port 6379 is accessible from Windows
Test-NetConnection -ComputerName <WSL_IP> -Port 6379
```

Or use the diagnostic script:
```bash
npm run verify:redis
```

### 4. Update `.env.local`

```env
# Replace <WSL_IP> with the IP from Step 2
REDIS_URL=redis://<WSL_IP>:6379
```

**Example:**
```env
REDIS_URL=redis://172.24.64.1:6379
```

### 5. Restart Your Dev Server

```bash
# Stop your current dev server (Ctrl+C)
# Then restart:
npm run dev
```

---

## Troubleshooting

### ❌ "Connection refused" or "ECONNREFUSED"

**Cause:** WSL IP address changed or Redis not listening on all interfaces.

**Solution 1: Get current WSL IP**
```powershell
wsl hostname -I
```
Update `.env.local` with the new IP.

**Solution 2: Configure Redis to listen on all interfaces (WSL)**
```bash
# In WSL Ubuntu terminal:
sudo nano /etc/redis/redis.conf

# Find the line:
# bind 127.0.0.1 ::1

# Change to:
bind 0.0.0.0

# Save and restart Redis:
sudo service redis-server restart
```

### ❌ "Connection timeout"

**Cause:** Firewall blocking or WSL network not configured.

**Solution:**
1. Ensure WSL is running: `wsl --list --running`
2. Check if Redis is running: `wsl redis-cli ping`
3. Verify WSL IP: `wsl hostname -I`

### ❌ WSL IP Changes After Restart

**Cause:** WSL IP is dynamically assigned.

**Solution:**
- Option 1: Get IP dynamically in your app (advanced)
- Option 2: Use `localhost` forwarding (Windows 11/Windows 10 update)
- Option 3: Update `.env.local` manually after restart

### ✅ Using localhost (Windows 11 / Windows 10 with Update)

If you have Windows 11 or Windows 10 with the latest update, you can use `localhost` instead of WSL IP:

```env
REDIS_URL=redis://localhost:6379
```

This works because Windows automatically forwards `localhost` to WSL.

**Check if this works:**
```bash
npm run verify:redis
```

If `localhost:6379` passes, you can use `localhost` instead of the WSL IP.

---

## Alternative: Run Node.js App in WSL

Instead of connecting from Windows to WSL Redis, you can run your Node.js app inside WSL:

**From WSL Ubuntu terminal:**
```bash
cd /mnt/c/MyApps/Khatario
npm run dev
```

Then use:
```env
REDIS_URL=redis://127.0.0.1:6379
```

This is simpler but requires running your app inside WSL.

---

## Summary

**For Windows app → WSL Redis:**
1. Get WSL IP: `wsl hostname -I`
2. Update `.env.local`: `REDIS_URL=redis://<WSL_IP>:6379`
3. Run: `npm run verify:redis`
4. If all checks pass, you're ready! ✅

**If localhost works (Windows 11/10 with update):**
```env
REDIS_URL=redis://localhost:6379
```
