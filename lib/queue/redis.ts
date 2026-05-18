import Redis from 'ioredis';

let redis: Redis | null = null;
let connectionAttempted = false;
let hasLoggedError = false;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

export function getRedisConnection(): Redis | null {
  // Only create Redis connection if explicitly needed
  if (!redis && !connectionAttempted) {
    connectionAttempted = true;
    
    // Check if Redis URL is explicitly set (optional feature)
    const redisUrl = process.env.REDIS_URL;
    
    // If REDIS_URL is not set, Redis is disabled
    if (!redisUrl) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Redis] REDIS_URL not set - Redis features disabled. Add REDIS_URL=redis://localhost:6379 to .env.local to enable.');
      }
      return null;
    }
    
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null, // Required by BullMQ - must be null for blocking commands
        lazyConnect: true,
        retryStrategy: () => null, // Don't retry on connection failure
        enableOfflineQueue: false, // Don't queue commands when offline
        connectTimeout: 5000, // 5 second timeout
      });
      
      // Track connection status
      redis.on('connect', () => {
        connectionStatus = 'connecting';
        if (process.env.NODE_ENV === 'development') {
          console.log('[Redis] Connecting to Memurai/Redis...');
        }
      });
      
      redis.on('ready', () => {
        connectionStatus = 'connected';
        hasLoggedError = false; // Reset on successful connection
        if (process.env.NODE_ENV === 'development') {
          console.log('[Redis] ✅ Connected successfully to Memurai/Redis');
        }
      });
      
      // Only log errors once, not on every retry
      redis.on('error', (err: any) => {
        connectionStatus = 'error';
        if (!hasLoggedError) {
          hasLoggedError = true;
          console.warn('[Redis] ❌ Connection failed:', err.message);
          console.warn('[Redis] 💡 To fix:');
          console.warn('   1. Ensure Memurai/Redis is running');
          console.warn('   2. Check REDIS_URL in .env.local (should be: redis://localhost:6379)');
          console.warn('   3. Run: npx ts-node scripts/test-redis-connection.ts');
          console.warn('[Redis] Todo reminders need Redis + worker (npm run worker:todo), or use /api/cron/send-todo-reminders on a schedule.');
        }
      });
      
      // Try to connect immediately to verify connection (non-blocking)
      redis.connect().catch(() => {
        // Connection will fail silently if Redis is not running
        // Error handler above will log it once
      });
    } catch (error: any) {
      console.warn('[Redis] Failed to initialize:', error.message);
      return null;
    }
  }
  
  return redis;
}

export function getRedisStatus(): 'disconnected' | 'connecting' | 'connected' | 'error' | 'not_configured' {
  if (!process.env.REDIS_URL) {
    return 'not_configured';
  }
  if (!redis) {
    return 'disconnected';
  }
  return connectionStatus;
}

/**
 * BullMQ scheduling calls this before add/remove. Without it, the first API request after
 * process start often runs while ioredis is still `connecting` (lazyConnect), so getQueue()
 * returns null and reminder jobs are never enqueued — worker stays idle and no SSE/popup.
 */
export async function waitForRedisReady(timeoutMs = 10_000): Promise<boolean> {
  const client = getRedisConnection();
  if (!client) {
    return false;
  }
  if (client.status === 'ready') {
    return true;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      resolve(client.status === 'ready');
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      resolve(true);
    };
    const onError = () => {
      clearTimeout(timer);
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      resolve(false);
    };
    client.once('ready', onReady);
    client.once('error', onError);
  });
}
