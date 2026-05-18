# WhatsApp Auto-Reconnection Improvements

## Problem

WhatsApp connections were disconnecting while the server was running, and the system wasn't automatically reconnecting in some cases, especially when:
- Disconnection happened without a clear error code (silent disconnects)
- Network interruptions occurred
- WebSocket connections died without triggering explicit disconnect events

## Solution Implemented

### 1. **Connection Health Monitoring**

Added a **periodic health check** that runs every 2 minutes for all connected sessions:

```typescript
function startConnectionHealthCheck(businessId: string, sessionRecord: SessionRecord)
```

**What it does:**
- Checks if the socket is still valid every 2 minutes
- If socket is dead/invalid, automatically triggers reconnection
- Logs health check failures for debugging
- Updates database with reconnection status

**Benefits:**
- Detects dead connections that didn't trigger disconnect events
- Proactively reconnects before users notice the issue
- Provides better visibility into connection health

### 2. **Improved Automatic Reconnection Logic**

Enhanced the disconnect handler to handle **unknown/silent disconnects**:

**Before:**
- Only retried if disconnect reason matched specific error codes
- Unknown disconnects would stop retrying after 3 attempts
- No reconnection for silent disconnects

**After:**
- Checks if `auth_state` (credentials) still exist in database
- If credentials are valid, assumes network issue and retries automatically
- Uses exponential backoff: 30s, 60s, 90s, up to 5 minutes max
- Continues retrying indefinitely as long as credentials are valid

**Code Location:** Lines 1215-1250 in `lib/whatsapp.ts`

### 3. **Better Error Logging**

Unknown disconnections now log:
- Disconnect reason (even if unknown)
- Retry attempt number
- Next retry time
- Database status during disconnect

This makes debugging easier by providing more context about why disconnections occur.

### 4. **Health Check Timer Cleanup**

Properly cleans up health check timers when:
- Connection disconnects
- Session is manually disconnected
- Invalid socket is detected

Prevents memory leaks and unnecessary health checks.

## How It Works

### Connection Lifecycle

1. **Connection Established:**
   - Socket is created and connected
   - Health check timer starts (runs every 2 minutes)
   - Message listener attached

2. **During Normal Operation:**
   - Health check runs every 2 minutes
   - Verifies socket is still valid
   - If valid, schedules next check
   - If invalid, triggers reconnection

3. **On Disconnect:**
   - Health check timer stops
   - Disconnect reason is evaluated
   - If unknown but credentials exist → automatic retry
   - If logged out → stop and clear credentials
   - If network issue → retry with backoff

### Automatic Reconnection Flow

```
Connection Disconnects
    ↓
Check disconnect reason
    ↓
Is it logged out? → Stop (user must reconnect)
    ↓
Is it connection replaced? → Stop (user must reconnect)
    ↓
Is it QR expired? → Stop (user must reconnect)
    ↓
Unknown/Silent disconnect?
    ↓
Check: Do we have valid auth_state in DB?
    ↓
YES → Network issue, retry automatically
    ↓
NO → Stop retrying (credentials invalid)
```

## Configuration

**Health Check Interval:** 2 minutes (120,000ms)
- Can be adjusted by changing `HEALTH_CHECK_INTERVAL` constant
- Balance between quick detection and server load

**Reconnection Delays:**
- Initial retry: 30 seconds
- Second retry: 60 seconds
- Third retry: 90 seconds
- Maximum delay: 5 minutes
- Formula: `min(300000, (retryCount + 1) * 30000)`

**Keep-Alive:**
- Baileys keep-alive: 30 seconds (unchanged)
- Health check: 2 minutes (new)
- Both work together to maintain connection

## Benefits

### ✅ Prevents Silent Disconnects

- Health check detects dead connections that didn't trigger events
- Automatic reconnection without user intervention
- Better connection reliability

### ✅ Handles Network Issues Gracefully

- Automatic retry for temporary network problems
- Exponential backoff prevents server overload
- Continues retrying as long as credentials are valid

### ✅ Better Debugging

- More detailed error logs
- Health check status tracking
- Clearer distinction between different disconnect types

### ✅ Improved User Experience

- Users don't need to manually reconnect for network issues
- Faster recovery from temporary problems
- More stable connections overall

## Testing

To verify the improvements work:

1. **Test Health Check:**
   - Connect WhatsApp
   - Monitor logs for health check messages every 2 minutes
   - Should see: Health checks running, socket valid

2. **Test Silent Disconnect:**
   - Simulate network interruption (block connection temporarily)
   - Should see: Health check detects invalid socket, triggers reconnection
   - Connection should recover automatically

3. **Test Unknown Disconnect:**
   - Force a disconnect without clear error code
   - Should see: Automatic retry messages in logs
   - Should reconnect within 30-60 seconds

## Monitoring

Watch for these log messages:

```
[WA] Health check: Socket is invalid for <businessId>. Connection may be dead. Reconnecting...
[WA] Unknown disconnect with valid auth_state. Will retry in 30s (attempt 1)
[WA] Connection health check failed - socket invalid. Reconnecting...
```

## Notes

- Health checks only run for `connected` sessions
- Health check automatically stops when connection disconnects
- Reconnection attempts continue indefinitely if credentials are valid
- Maximum retry delay is capped at 5 minutes to prevent excessive delays

## Future Improvements (Optional)

1. **Configurable Health Check Interval:**
   - Allow per-business or global configuration
   - Adjust based on network reliability

2. **Connection Quality Metrics:**
   - Track disconnection frequency
   - Alert on excessive disconnections
   - Connection uptime statistics

3. **Health Check Webhook:**
   - Notify external systems of connection issues
   - Integration with monitoring tools

4. **Smart Retry Logic:**
   - Adjust retry delays based on success rate
   - Learn from connection patterns

