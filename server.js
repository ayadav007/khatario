const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Global error handlers to catch unexpected exits
process.on('uncaughtException', (err) => {
  console.error('\n❌ UNCAUGHT EXCEPTION:');
  console.error(err);
  console.error('\nStack trace:');
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  if (reason && reason.stack) {
    console.error('Stack trace:');
    console.error(reason.stack);
  }
  process.exit(1);
});

console.log('\n🚀 Starting Khatario server...');
console.log('═══════════════════════════════════════\n');

// Check for production mode via NODE_ENV or --production flag
// Production mode if NODE_ENV is 'production' OR --production flag is passed
const isProductionArg = process.argv.includes('--production');
const dev = !(process.env.NODE_ENV === 'production' || isProductionArg);
/** Address the HTTPS server binds to (`0.0.0.0` = reachable on LAN, e.g. phone PWA). */
const bindHost =
  process.env.HOST || process.env.BIND_HOST || process.env.HOSTNAME || 'localhost';
/** Hostname passed to Next.js (URLs / cookies); keep `localhost` when binding all interfaces. */
const nextHostname =
  process.env.NEXT_HOSTNAME || (bindHost === '0.0.0.0' ? 'localhost' : bindHost);
const port = parseInt(process.env.PORT || '3000', 10);

function listLanUrls(portNumber) {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const net of ifaces) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`https://${net.address}:${portNumber}`);
      }
    }
  }
  return urls;
}

// Check if build exists
const hasBuild = fs.existsSync(path.join(__dirname, '.next'));

if (dev) {
  console.log('Starting in development mode...');
  console.log(`✓ Mode: DEVELOPMENT`);
} else {
  console.log('Starting in production mode...');
  console.log(`✓ Mode: PRODUCTION`);
  console.log(`✓ Checking for .next directory...`);
  if (!hasBuild) {
    console.error('\n❌ Error: Production build not found!');
    console.error('   The ".next" folder is missing. You must build the app first.');
    console.error('\n   Run this command to build:');
    console.error('   npm run build\n');
    console.error('   Then run "npm run start" again.\n');
    process.exit(1);
  }
  console.log(`✓ Found .next directory`);
  
  // Check for BUILD_ID file specifically
  const buildIdPath = path.join(__dirname, '.next', 'BUILD_ID');
  if (fs.existsSync(buildIdPath)) {
    const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
    console.log(`✓ BUILD_ID found: ${buildId}`);
  } else {
    console.error('❌ Warning: BUILD_ID file not found in .next directory');
    console.error('   The build might be incomplete. Try running:');
    console.error('   npm run build\n');
  }
}

// SSL certificate paths
const keyPath = path.join(__dirname, 'certs', 'localhost-key.pem');
const certPath = path.join(__dirname, 'certs', 'localhost.pem');

console.log(`✓ Checking SSL certificates...`);
// Check if certificates exist
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('❌ SSL certificates not found!');
  console.error('   Please run: npm run setup:https');
  console.error('   This will generate the required SSL certificates.');
  process.exit(1);
}
console.log(`✓ SSL certificates found`);

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

console.log(`✓ Initializing Next.js app...`);
console.log(`  - bind: ${bindHost}`);
console.log(`  - next hostname: ${nextHostname}`);
console.log(`  - port: ${port}`);
console.log(`  - dev: ${dev}`);

const app = next({ 
  dev, 
  hostname: nextHostname, 
  port
});
const handle = app.getRequestHandler();

console.log(`✓ Next.js app instance created`);

console.log(`✓ Preparing Next.js app (this may take a moment)...`);

app.prepare()
  .then(() => {
    console.log(`✓ Next.js app prepared successfully`);
    console.log(`✓ Creating HTTPS server...`);
    
    const server = createServer(httpsOptions, async (req, res) => {
      try {
        // Normalize the URL - strip any recursive localhost:3000 patterns
        // This handles cases where the browser sends malformed URLs like /localhost:3000/localhost:3000/...
        let requestUrl = req.url || '/';
        
        // Remove any occurrences of /localhost:3000 (with optional port) from anywhere in the path
        // Match /localhost:3000 or /localhost:PORT patterns
        requestUrl = requestUrl.replace(/\/localhost:\d+/g, '') || '/';
        // Ensure it starts with / if empty
        if (!requestUrl.startsWith('/')) {
          requestUrl = '/' + requestUrl;
        }
        
        // Additional safety: if URL still contains localhost:3000 after normalization, force to root
        if (requestUrl.includes('localhost:3000')) {
          requestUrl = '/';
        }
        
        // Use url.parse() as Next.js custom servers expect (deprecation warning is acceptable)
        // Next.js handle() expects: { pathname, query, search }
        const parsedUrl = parse(requestUrl, true);
        
        // Log API route requests for debugging
        if (parsedUrl.pathname?.startsWith('/api/')) {
          console.log(`[API Request] ${req.method} ${parsedUrl.pathname}`);
        }
        
        // Track response status and redirects
        const originalWriteHead = res.writeHead;
        const originalSetHeader = res.setHeader;
        let redirectLocation = null;
        
        res.setHeader = function(name, value) {
          if (name.toLowerCase() === 'location') {
            redirectLocation = value;
            // Normalize redirect location - ensure it's a relative path, not absolute
            let normalizedLocation = value;
            // If it's an absolute URL, extract just the path
            if (normalizedLocation.startsWith('http://') || normalizedLocation.startsWith('https://')) {
              try {
                const url = new URL(normalizedLocation);
                normalizedLocation = url.pathname + (url.search || '');
              } catch (e) {
                // If URL parsing fails, try to extract path manually
                const match = normalizedLocation.match(/https?:\/\/[^\/]+(\/.*)/);
                if (match) normalizedLocation = match[1];
              }
            }
            // Remove any recursive localhost:PORT patterns
            normalizedLocation = normalizedLocation.replace(/\/localhost:\d+/g, '') || '/';
            
            // Ensure it's a valid relative path starting with /
            if (!normalizedLocation.startsWith('/')) {
              normalizedLocation = '/' + normalizedLocation;
            }
            
            // Set the normalized location
            return originalSetHeader.call(this, name, normalizedLocation);
          }
          return originalSetHeader.apply(this, arguments);
        };
        
        res.writeHead = function(statusCode, ...args) {
          if (parsedUrl.pathname?.startsWith('/api/')) {
            console.log(`[API Response] ${req.method} ${parsedUrl.pathname} -> ${statusCode}`);
          } else if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
            console.log(`[Redirect] ${req.method} ${parsedUrl.pathname} -> ${statusCode} ${redirectLocation}`);
          }
          return originalWriteHead.apply(this, [statusCode, ...args]);
        };
        
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('❌ Error occurred handling', req.url, err);
        console.error('Error stack:', err.stack);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('internal server error');
        }
      }
    });
    
    console.log(`✓ Starting server on port ${port}...`);
    
    server.listen(port, bindHost, (err) => {
      if (err) {
        console.error('❌ Failed to start server:');
        console.error(err);
        throw err;
      }
      console.log(`\n✅ Server ready!`);
      console.log(`   > Local:    https://localhost:${port}`);
      if (bindHost === '0.0.0.0') {
        const lan = listLanUrls(port);
        if (lan.length) {
          console.log(`   > Network (use on phone / other devices):`);
          for (const u of lan) console.log(`      ${u}`);
        } else {
          console.log(`   > Network:  https://<your-pc-lan-ip>:${port}`);
        }
        console.log(`   > Tip:      Accept the self-signed cert warning on mobile.`);
      } else if (bindHost !== 'localhost' && bindHost !== '127.0.0.1') {
        console.log(`   > Bind:     https://${bindHost}:${port}`);
      } else {
        console.log(`   > LAN:      Set HOST=0.0.0.0 or run npm run start:lan for phone access`);
      }
      console.log(`   > Mode:     ${dev ? 'development' : 'production'}`);
      console.log(`   > Ready to accept connections\n`);
    });
    
    // Handle server errors
    server.on('error', (err) => {
      console.error('❌ Server error:');
      console.error(err);
      if (err.code === 'EADDRINUSE') {
        console.error(`\n   Port ${port} is already in use.`);
        console.error(`   Either stop the other process or use a different port.\n`);
      }
      process.exit(1);
    });
    
  })
  .catch((err) => {
    console.error('❌ Failed to prepare Next.js app:');
    console.error(err);
    console.error('\nError details:', err.message);
    console.error('\nStack trace:');
    console.error(err.stack);
    process.exit(1);
  });
