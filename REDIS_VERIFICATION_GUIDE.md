# Redis/Memurai Connection Verification Guide

## Quick Start

Run the diagnostic script to verify Redis connectivity:

```bash
npm run verify:redis
```

This will check:
1. ✅ Memurai service status (Windows)
2. ✅ Port 6379 listening status
3. ✅ Redis PING test via ioredis
4. ✅ Environment information (Docker/WSL/Native)

---

## Step-by-Step Verification

### Step 1: Check Memurai Service (Windows Only)

**Windows:**
```powershell
# Check if Memurai service is running
sc query Memurai
```

**Expected output if running:**
```
STATE              : 4 RUNNING
```

**If stopped, start it:**
- Open Services (`services.msc`)
- Find "Memurai" service
- Right-click → Start

**Or from Start Menu:**
- Search "Memurai" → Click to start

---

### Step 2: Verify Port 6379 is Listening

**Windows (PowerShell):**
```powershell
# Check if port 6379 is listening
netstat -an | findstr :6379
```

**Expected output:**
```
TCP    127.0.0.1:6379         0.0.0.0:0              LISTENING
```

**Linux/macOS:**
```bash
# Check if port 6379 is listening
netstat -an | grep :6379
# or
ss -tlnp | grep :6379
```

**Expected output:**
```
tcp    0    0 127.0.0.1:6379    0.0.0.0:*    LISTEN
```

---

### Step 3: Test Redis Connection via ioredis PING

**Run the verification script:**
```bash
npm run verify:redis
```

**Or test manually:**
```bash
npm run test:redis
```

**Expected output:**
```
✅ Connected to Redis/Memurai!
✅ Redis commands working correctly!
✅ PING successful - received: PONG
```

---

### Step 4: Verify Environment Variables

**Check `.env.local`:**
```env
REDIS_URL=redis://127.0.0.1:6379
```

**Important:** Use `127.0.0.1` instead of `localhost`:
- ✅ More reliable on Windows
- ✅ Works in Docker/WSL
- ✅ Avoids DNS resolution issues

---

### Step 5: Confirm Runtime Environment

The diagnostic script will automatically detect:
- **Native Node.js**: Running directly on Windows/Linux/macOS
- **Docker**: Running in a container
- **WSL**: Windows Subsystem for Linux

**Check manually:**
```bash
# Platform
node -e "console.log(process.platform)"

# Docker (if applicable)
cat /.dockerenv 2>/dev/null && echo "Running in Docker" || echo "Not Docker"

# WSL (if applicable)
uname -a | grep -i microsoft && echo "Running in WSL" || echo "Not WSL"
```

---

## Troubleshooting

### ❌ "Memurai service not found"

**Solution:**
1. Install Memurai from https://www.memurai.com/get-memurai
2. Start the service from Services (`services.msc`)

---

### ❌ "Port 6379 is not listening"

**Possible causes:**
1. Memurai/Redis is not running
2. Wrong port number
3. Firewall blocking connection

**Solutions:**
1. **Start Memurai/Redis:**
   - Windows: Start Memurai service
   - Linux: `sudo systemctl start redis`
   - macOS: `brew services start redis`

2. **Check if another service is using port 6379:**
   ```powershell
   # Windows
   netstat -ano | findstr :6379
   
   # Linux/macOS
   lsof -i :6379
   ```

3. **Check firewall:**
   - Windows: Allow port 6379 in Windows Firewall
   - Linux: `sudo ufw allow 6379`

---

### ❌ "Connection refused" or "ECONNREFUSED"

**Causes:**
1. Redis/Memurai not running
2. Wrong host/port
3. Firewall blocking

**Solutions:**
1. **Verify Redis is running:**
   ```bash
   # Windows
   sc query Memurai
   
   # Linux
   sudo systemctl status redis
   
   # macOS
   brew services list | grep redis
   ```

2. **Try 127.0.0.1 instead of localhost:**
   ```env
   REDIS_URL=redis://127.0.0.1:6379
   ```

3. **Check if Redis is listening on correct interface:**
   - Should listen on `127.0.0.1` or `0.0.0.0`
   - Not just `localhost` (DNS resolution issue)

---

### ❌ "Connection timeout"

**Causes:**
1. Firewall blocking
2. Redis not listening on expected interface
3. Network configuration issue

**Solutions:**
1. **Check Redis bind address:**
   - Memurai: Check configuration file
   - Redis: Check `bind` directive in `redis.conf`

2. **Try different addresses:**
   - `127.0.0.1:6379` (recommended)
   - `localhost:6379`
   - `0.0.0.0:6379` (if Redis is configured to listen on all interfaces)

---

### ❌ "PING failed" or "Unexpected response"

**Causes:**
1. Redis requires authentication
2. Connection to wrong service
3. Redis version incompatibility

**Solutions:**
1. **Check if Redis requires password:**
   ```env
   REDIS_URL=redis://:password@127.0.0.1:6379
   ```

2. **Verify you're connecting to Redis:**
   - Run `redis-cli ping` (should return `PONG`)
   - If different response, may be connecting to wrong service

---

## Docker/WSL Considerations

### Docker

If running in Docker:
- Use `host.docker.internal` (Docker Desktop) or container network
- Or use `127.0.0.1` if Redis is on host
- May need to expose port: `docker run -p 6379:6379 ...`

### WSL

If running in WSL:
- Use `127.0.0.1` (recommended)
- `localhost` may resolve to WSL host, not Windows host
- If Redis is on Windows host, use Windows IP address

---

## Next Steps

Once Redis PING works:

1. ✅ **Verify connection:**
   ```bash
   npm run verify:redis
   ```

2. ✅ **Update `.env.local`:**
   ```env
   REDIS_URL=redis://127.0.0.1:6379
   ```

3. ✅ **Test from Node.js:**
   ```bash
   npm run test:redis
   ```

4. ✅ **Only then proceed with BullMQ/Worker implementation**

---

## Summary

**Before implementing BullMQ/Worker:**
- ✅ Memurai/Redis service running
- ✅ Port 6379 listening
- ✅ Redis PING works from Node.js
- ✅ REDIS_URL set correctly in `.env.local`
- ✅ Using `127.0.0.1` instead of `localhost`

**Run diagnostic:**
```bash
npm run verify:redis
```

If all checks pass, Redis is ready for BullMQ/Worker implementation! 🎉
