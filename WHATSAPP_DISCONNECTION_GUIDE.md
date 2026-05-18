# WhatsApp Disconnection Guide

## Quick Answer

**There is NO automatic disconnection after a time period** in your code. The connection should stay active indefinitely unless there's an external event.

However, WhatsApp can disconnect for several reasons outside your control. This guide explains all possible causes.

---

## Disconnection Reasons

### 1. **User Actions (Most Common)**

#### Logged Out from Phone
- **When**: User logs out of WhatsApp on their phone, or logs in on a new device
- **Error**: `DisconnectReason.loggedOut` (401)
- **Solution**: User must reconnect via QR code
- **Code Location**: Lines 1054-1067 in `lib/whatsapp.ts`

#### Connection Replaced (Multi-Device Conflict)
- **When**: Another WhatsApp Web session is opened on the same phone
- **Error**: Status code `440`
- **Message**: "Connection replaced by another session"
- **Solution**: Close other WhatsApp Web sessions, then reconnect
- **Code Location**: Lines 1069-1083 in `lib/whatsapp.ts`

---

### 2. **QR Code Issues**

#### QR Code Expired
- **When**: QR code wasn't scanned within ~60 seconds
- **Error**: Status code `408` or "QR code expired"
- **Solution**: Generate a new QR code by clicking "Connect" again
- **Code Location**: Lines 1085-1105 in `lib/whatsapp.ts`

---

### 3. **Network & Server Issues**

#### Network Interruption
- **When**: Internet connection drops, firewall blocks connection, or proxy issues
- **Error**: WebSocket connection closed (error code 1006)
- **Solution**: Check internet connection, firewall settings, or proxy configuration
- **Code Location**: Lines 1686-1689 in `lib/whatsapp.ts`

#### WhatsApp Server-Side Timeout
- **When**: WhatsApp's servers disconnect inactive connections (this is outside your control)
- **Typical Duration**: WhatsApp may disconnect after several hours of complete inactivity
- **Prevention**: The `keepAliveIntervalMs: 30000` (30 seconds) sends heartbeat packets to prevent this
- **Code Location**: Line 882 in `lib/whatsapp.ts`

---

### 4. **Rate Limiting**

#### Too Many Messages Too Fast
- **When**: Sending messages too frequently triggers WhatsApp's rate limits
- **Error**: Status code `479`
- **Warning**: If repeated frequently, this can cause device disconnection
- **Solution**: Reduce message sending rate, add delays between bulk sends
- **Code Location**: Lines 1274-1277 in `lib/whatsapp.ts`

---

### 5. **Initialization Errors**

#### Connection Closes Quickly After Opening
- **When**: Connection opens but closes within 10 seconds
- **Cause**: Often due to init query errors or authentication issues
- **Solution**: Check server logs for init query errors, try reconnecting
- **Code Location**: Lines 1038-1051 in `lib/whatsapp.ts`

#### Restart Required
- **When**: WhatsApp requires a connection restart
- **Error**: Status code `515` or "restart required" / "Stream Errored"
- **Behavior**: Code automatically retries up to 3 times
- **Code Location**: Lines 1107-1166 in `lib/whatsapp.ts`

---

### 6. **Server Restart / Code Deployment**

#### Server Restart
- **When**: Your server restarts, deployment, or crashes
- **Impact**: All in-memory sessions are lost
- **Recovery**: Code attempts to revive sessions if DB shows `connected` status
- **Revival Logic**: Lines 1418-1434 in `lib/whatsapp.ts`
- **Note**: Revival only happens if `auth_state` is still in the database

---

## Connection Settings

Your current configuration:

```typescript
keepAliveIntervalMs: 30000,      // Sends heartbeat every 30 seconds to prevent server timeout
connectTimeoutMs: 60000,          // 60 seconds timeout for initial connection
defaultQueryTimeoutMs: 60000,     // 60 seconds timeout for queries
maxMsgRetryCount: 5,              // Retry failed messages up to 5 times
```

**Important**: The `keepAliveIntervalMs` setting sends heartbeat packets every 30 seconds to keep the connection alive. This prevents WhatsApp from disconnecting due to inactivity.

---

## How to Check Why You Got Disconnected

1. **Check the Database**: Look at `whatsapp_sessions.last_error` column
   ```sql
   SELECT status, last_error, updated_at 
   FROM whatsapp_sessions 
   WHERE business_id = 'your-business-id';
   ```

2. **Check Server Logs**: Look for `[WA] Connection CLOSED` messages with reason codes

3. **Common Error Messages**:
   - `"Logged out"` → User logged out from phone
   - `"Connection replaced by another session"` → Multi-device conflict
   - `"QR code expired"` → QR wasn't scanned in time
   - `"Connection lost. Retrying..."` → Network issue, auto-retrying
   - `"Connection failed after multiple attempts"` → Max retries reached

---

## Prevention Tips

### ✅ To Keep Connection Stable:

1. **Don't Log Out on Phone**: Keep WhatsApp logged in on the phone
2. **Close Other WhatsApp Web Sessions**: Only have one active session
3. **Stable Internet Connection**: Use reliable network connection
4. **Avoid Rate Limiting**: Don't send messages too quickly (max 20-30 per minute recommended)
5. **Server Uptime**: Keep your server running (use PM2, systemd, or similar)
6. **Monitor Logs**: Watch for error patterns

### ❌ What Will Cause Disconnection:

- Logging out of WhatsApp on phone
- Opening WhatsApp Web on another device/browser
- Network disconnection for extended period
- Server restart without session revival
- Repeated rate limit violations
- WhatsApp server-side timeout (rare, but possible)

---

## Automatic Recovery

Your code has automatic retry logic:

1. **Transient Errors**: Automatically retries up to 3 times with increasing delays
2. **Session Revival**: If server restarts, code attempts to revive sessions from database
3. **Restart Required**: Automatically handles restart requests from WhatsApp

However, these scenarios require manual reconnection:
- User logged out (`DisconnectReason.loggedOut`)
- Connection replaced (`440`)
- QR code expired (`408`)

---

## Summary

**Your code does NOT disconnect after a time period.** The connection should stay active indefinitely if:
- User stays logged in on phone
- No other WhatsApp Web sessions are opened
- Network connection is stable
- No rate limit violations occur
- Server stays running

Most disconnections are due to **user actions** (logging out, opening another session) or **network issues** (internet drop, firewall, etc.).

