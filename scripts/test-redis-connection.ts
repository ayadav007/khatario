/**
 * Test Redis/Memurai Connection
 * 
 * This script tests if Redis/Memurai is running and accessible.
 * Run with: npx ts-node scripts/test-redis-connection.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import Redis from 'ioredis';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testRedisConnection() {
  console.log('🔍 Testing Redis/Memurai Connection...\n');

  // Check if REDIS_URL is set
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL is not set in environment variables');
    console.log('\n📝 To fix this, add to your .env.local file:');
    console.log('   REDIS_URL=redis://127.0.0.1:6379');
    console.log('\n   Note: Using 127.0.0.1 instead of localhost is recommended');
    process.exit(1);
  }

  console.log(`✅ REDIS_URL found: ${redisUrl}`);
  console.log('   (This is hidden for security)\n');

  // Try to connect
  console.log('🔌 Attempting to connect to Redis/Memurai...');
  
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  });

  try {
    // Set up event listeners
    redis.on('connect', () => {
      console.log('✅ Connected to Redis/Memurai!');
    });

    redis.on('ready', () => {
      console.log('✅ Redis/Memurai is ready!');
    });

    redis.on('error', (err: any) => {
      console.error('❌ Redis connection error:', err.message);
      console.error('\n💡 Troubleshooting:');
      console.error('   1. Is Memurai/Redis running?');
      console.error('   2. Check if the port is correct (default: 6379)');
      console.error('   3. Try starting Memurai from Windows Start Menu');
      console.error('   4. Or install Redis: https://redis.io/download');
    });

    // Try to connect
    await redis.connect();
    
    // Test a simple command
    console.log('\n🧪 Testing Redis commands...');
    await redis.set('test:connection', 'ok');
    const value = await redis.get('test:connection');
    
    if (value === 'ok') {
      console.log('✅ Redis commands working correctly!');
      await redis.del('test:connection');
    } else {
      console.error('❌ Redis command test failed');
    }

    // Get Redis info
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    
    console.log(`\n📊 Redis/Memurai Info:`);
    console.log(`   Version: ${version}`);
    console.log(`   Status: ${redis.status}`);
    
    // Close connection
    await redis.quit();
    console.log('\n✅ Connection test completed successfully!');
    console.log('   Redis/Memurai is ready to use for todo reminders.\n');
    
  } catch (error: any) {
    console.error('\n❌ Failed to connect to Redis/Memurai');
    console.error('   Error:', error.message);
    console.error('\n💡 Solutions:');
    console.error('   1. Start Memurai from Windows Start Menu');
    console.error('   2. Or install and start Redis');
    console.error('   3. Check if port 6379 is available');
    console.error('   4. Verify REDIS_URL in .env.local is correct');
    process.exit(1);
  }
}

testRedisConnection().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
