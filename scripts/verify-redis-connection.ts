/**
 * Redis/Memurai Connection Verification Script
 * 
 * This script verifies Redis connectivity step by step:
 * 1. Check if Memurai service is running (Windows)
 * 2. Check if port 6379 is listening
 * 3. Test Redis connection via ioredis PING
 * 4. Use 127.0.0.1 instead of localhost
 * 
 * Run with: npm run verify:redis
 */

import dotenv from 'dotenv';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import * as net from 'net';

const execAsync = promisify(exec);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface DiagnosticResult {
  step: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: string;
}

const results: DiagnosticResult[] = [];

function addResult(step: string, status: 'pass' | 'fail' | 'skip', message: string, details?: string) {
  results.push({ step, status, message, details });
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⏭️';
  console.log(`${icon} ${step}: ${message}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

async function checkMemuraiService(): Promise<boolean> {
  try {
    // Check if running on Windows
    if (process.platform !== 'win32') {
      addResult('Step 1: Memurai Service Check', 'skip', 'Not Windows - skipping Memurai service check');
      return true;
    }

    // Check if Memurai service is running
    try {
      const { stdout } = await execAsync('sc query Memurai');
      if (stdout.includes('RUNNING')) {
        addResult('Step 1: Memurai Service Check', 'pass', 'Memurai service is running');
        return true;
      } else if (stdout.includes('STOPPED')) {
        addResult('Step 1: Memurai Service Check', 'fail', 'Memurai service is stopped', 'Start it from Services (services.msc) or Start Menu');
        return false;
      } else {
        addResult('Step 1: Memurai Service Check', 'fail', 'Memurai service not found', 'Install Memurai from https://www.memurai.com/get-memurai');
        return false;
      }
    } catch (error: any) {
      if (error.message.includes('does not exist')) {
        addResult('Step 1: Memurai Service Check', 'fail', 'Memurai service not installed', 'Install Memurai from https://www.memurai.com/get-memurai');
      } else {
        addResult('Step 1: Memurai Service Check', 'fail', 'Could not check Memurai service', error.message);
      }
      return false;
    }
  } catch (error: any) {
    addResult('Step 1: Memurai Service Check', 'skip', 'Could not check service status', error.message);
    return true; // Continue with other checks
  }
}

async function checkPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 2000; // 2 second timeout

    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      socket.destroy();
      addResult(`Step 2: Port ${port} Check (${host})`, 'pass', `Port ${port} is listening on ${host}`);
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      addResult(`Step 2: Port ${port} Check (${host})`, 'fail', `Port ${port} is not listening on ${host}`, 'Redis/Memurai may not be running or listening on this address');
      resolve(false);
    });

    socket.on('error', (err: any) => {
      if (err.code === 'ECONNREFUSED') {
        addResult(`Step 2: Port ${port} Check (${host})`, 'fail', `Connection refused on ${host}:${port}`, 'Redis/Memurai is not running or not listening on this address');
      } else {
        addResult(`Step 2: Port ${port} Check (${host})`, 'fail', `Error checking port: ${err.message}`);
      }
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function testRedisConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n🔌 Attempting to connect to Redis at ${host}:${port}...`);
    
    const redis = new Redis({
      host,
      port,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: () => null, // Don't retry
      enableOfflineQueue: false,
    });

    let connected = false;

    redis.on('connect', () => {
      console.log(`   → Connected to ${host}:${port}`);
    });

    redis.on('ready', async () => {
      if (!connected) {
        connected = true;
        try {
          const result = await redis.ping();
          if (result === 'PONG') {
            addResult(`Step 3: Redis PING Test (${host}:${port})`, 'pass', `PING successful - received: ${result}`);
            await redis.quit();
            resolve(true);
          } else {
            addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', `Unexpected PING response: ${result}`);
            await redis.quit();
            resolve(false);
          }
        } catch (error: any) {
          addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', `PING failed: ${error.message}`);
          await redis.quit();
          resolve(false);
        }
      }
    });

    redis.on('error', (err: any) => {
      if (!connected) {
        if (err.message.includes('ECONNREFUSED')) {
          addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', `Connection refused`, 'Redis/Memurai is not running or not accessible on this address');
        } else if (err.message.includes('ETIMEDOUT')) {
          addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', `Connection timeout`, 'Redis/Memurai may be behind a firewall or not listening');
        } else {
          addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', `Connection error: ${err.message}`);
        }
        resolve(false);
      }
    });

    // Try to connect
    redis.connect().catch(() => {
      // Error will be handled by error event
    });

    // Timeout after 6 seconds
    setTimeout(() => {
      if (!connected) {
        redis.disconnect();
        addResult(`Step 3: Redis PING Test (${host}:${port})`, 'fail', 'Connection timeout after 6 seconds');
        resolve(false);
      }
    }, 6000);
  });
}

async function checkEnvironment(): Promise<void> {
  console.log('\n📋 Environment Information:');
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Node.js: ${process.version}`);
  console.log(`   Architecture: ${process.arch}`);
  
  // Check if running in Docker
  try {
    const fs = require('fs');
    if (fs.existsSync('/.dockerenv')) {
      console.log('   Container: Docker detected');
    } else {
      console.log('   Container: Native Node.js (not Docker)');
    }
  } catch {
    console.log('   Container: Native Node.js');
  }

  // Check if running in WSL
  try {
    const { stdout } = await execAsync('uname -a 2>/dev/null || echo ""');
    if (stdout.includes('Microsoft') || stdout.includes('WSL')) {
      console.log('   WSL: Windows Subsystem for Linux detected');
    } else {
      console.log('   WSL: Not detected (app running on Windows, not WSL)');
    }
  } catch {
    // Not WSL
    if (process.platform === 'win32') {
      console.log('   WSL: Not detected (app running on Windows, not WSL)');
    }
  }

  // Check REDIS_URL
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    console.log(`   REDIS_URL: ${redisUrl.replace(/:[^:@]*@/, ':****@')}`); // Hide password if present
  } else {
    console.log('   REDIS_URL: Not set');
  }
}

async function getWslIpAddress(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('wsl hostname -I 2>/dev/null || echo ""');
    const wslIp = stdout.trim().split(' ')[0];
    if (wslIp && /^\d+\.\d+\.\d+\.\d+$/.test(wslIp)) {
      return wslIp;
    }
  } catch {
    // Could not get WSL IP
  }
  return null;
}

async function checkWslRedis(): Promise<{ running: boolean; ip?: string }> {
  try {
    // Check if Redis is running in WSL
    const { stdout } = await execAsync('wsl redis-cli ping 2>/dev/null || echo "FAILED"');
    if (stdout.includes('PONG')) {
      const wslIp = await getWslIpAddress();
      return { running: true, ip: wslIp || undefined };
    }
  } catch {
    // Could not check WSL Redis
  }
  return { running: false };
}

async function main() {
  console.log('🔍 Redis/Memurai Connection Diagnostic Tool\n');
  console.log('='.repeat(60));

  // Check environment
  await checkEnvironment();

  console.log('\n' + '='.repeat(60));
  console.log('Running Diagnostic Checks...\n');

  // Check if Redis is running in WSL (when app is on Windows)
  let wslRedis: { running: boolean; ip?: string } = { running: false };
  if (process.platform === 'win32') {
    console.log('🔍 Checking if Redis is running in WSL...\n');
    wslRedis = await checkWslRedis();
    if (wslRedis.running) {
      addResult('Step 0: WSL Redis Check', 'pass', 'Redis is running in WSL Ubuntu', wslRedis.ip ? `WSL IP: ${wslRedis.ip}` : 'WSL detected');
    } else {
      addResult('Step 0: WSL Redis Check', 'skip', 'Redis not detected in WSL or WSL not accessible', 'If Redis is in WSL, ensure WSL is running');
    }
  }

  // Step 1: Check Memurai service (Windows only)
  const memuraiRunning = await checkMemuraiService();

  // Step 2: Check if port 6379 is listening
  console.log('\n');
  const localhostListening = await checkPortListening('127.0.0.1', 6379);
  const localhostNameListening = await checkPortListening('localhost', 6379);

  // Step 3: Test Redis PING
  console.log('\n');
  let pingSuccess = false;
  let workingHost = '';
  
  // If WSL Redis is available, try WSL IP first
  if (wslRedis.running && wslRedis.ip) {
    console.log(`\n🔌 Testing connection to WSL Redis at ${wslRedis.ip}:6379...\n`);
    const wslPortListening = await checkPortListening(wslRedis.ip, 6379);
    if (wslPortListening) {
      pingSuccess = await testRedisConnection(wslRedis.ip, 6379);
      if (pingSuccess) {
        workingHost = wslRedis.ip;
      }
    }
  }
  
  // Try 127.0.0.1 (for Windows native Redis)
  if (!pingSuccess && localhostListening) {
    console.log('\n');
    pingSuccess = await testRedisConnection('127.0.0.1', 6379);
    if (pingSuccess) {
      workingHost = '127.0.0.1';
    }
  }
  
  // If 127.0.0.1 failed but localhost works, try localhost
  if (!pingSuccess && localhostNameListening && !localhostListening) {
    console.log('\n');
    pingSuccess = await testRedisConnection('localhost', 6379);
    if (pingSuccess) {
      workingHost = 'localhost';
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Diagnostic Summary:\n');

  const failedSteps = results.filter(r => r.status === 'fail');
  const criticalFailedSteps = failedSteps.filter(r => 
    !r.step.includes('Memurai Service') && !r.step.includes('WSL Redis Check')
  );

  // SUCCESS: If PING works, Redis is ready (Memurai service check is optional)
  if (pingSuccess) {
    console.log('✅ Redis is working! PING test successful.\n');
    if (workingHost) {
      console.log(`💡 Recommended REDIS_URL: redis://${workingHost}:6379\n`);
      if (wslRedis.running && wslRedis.ip && workingHost === wslRedis.ip) {
        console.log('📝 Note: Redis is running in WSL. Using WSL IP address to connect from Windows.\n');
      }
    } else {
      console.log('💡 Recommended REDIS_URL: redis://127.0.0.1:6379\n');
    }
    
    // Show warnings for non-critical failures (but don't fail the test)
    const nonCriticalFailures = failedSteps.filter(r => 
      r.step.includes('Memurai Service') || r.step.includes('WSL Redis Check')
    );
    if (nonCriticalFailures.length > 0) {
      console.log('⚠️  Non-critical warnings (Redis is working anyway):\n');
      nonCriticalFailures.forEach(r => {
        console.log(`   • ${r.step}: ${r.message}`);
      });
      console.log('');
    }
    
    console.log('🚀 Ready to proceed with BullMQ/Worker implementation!\n');
    process.exit(0);
  } else {
    console.log(`❌ ${failedSteps.length} check(s) failed:\n`);
    failedSteps.forEach(r => {
      console.log(`   • ${r.step}: ${r.message}`);
      if (r.details) {
        console.log(`     ${r.details}`);
      }
    });
    
    console.log('\n💡 Next Steps:');
    
    // WSL-specific guidance
    if (wslRedis.running && wslRedis.ip && !pingSuccess) {
      console.log('🔧 Redis is running in WSL but connection failed:');
      console.log(`   1. Get WSL IP: wsl hostname -I`);
      console.log(`   2. Update .env.local with WSL IP:`);
      console.log(`      REDIS_URL=redis://${wslRedis.ip}:6379`);
      console.log(`   3. Ensure WSL firewall allows port 6379 (if enabled)`);
      console.log(`   4. Verify Redis bind in WSL: wsl redis-cli config get bind\n`);
    } else if (process.platform === 'win32' && !wslRedis.running && !memuraiRunning) {
      console.log('🔧 To connect to Redis in WSL from Windows:');
      console.log('   1. Ensure WSL is running: wsl --list --running');
      console.log('   2. Get WSL IP address: wsl hostname -I');
      console.log('   3. Update .env.local: REDIS_URL=redis://<WSL_IP>:6379');
      console.log('   4. Or run your Node.js app inside WSL\n');
    }
    
    if (!memuraiRunning && process.platform === 'win32' && !wslRedis.running) {
      console.log('   1. Start Memurai service (Windows):');
      console.log('      - Open Services (services.msc)');
      console.log('      - Find "Memurai" service');
      console.log('      - Right-click → Start');
      console.log('   2. Or start from Windows Start Menu → Memurai\n');
    }
    if (!localhostListening && !localhostNameListening && !wslRedis.running) {
      console.log('   1. Ensure Redis/Memurai is running');
      console.log('   2. Check if it\'s listening on port 6379');
      console.log('   3. Verify firewall settings\n');
    }
    if (!pingSuccess) {
      if (wslRedis.running && wslRedis.ip) {
        console.log('   1. Update REDIS_URL in .env.local to use WSL IP:');
        console.log(`      REDIS_URL=redis://${wslRedis.ip}:6379`);
      } else {
        console.log('   1. Verify REDIS_URL in .env.local:');
        console.log('      REDIS_URL=redis://127.0.0.1:6379');
        console.log('   2. Try using 127.0.0.1 instead of localhost');
      }
      console.log('   3. Check if Redis requires authentication\n');
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Unexpected error:', err);
  process.exit(1);
});
