const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const certsDir = path.join(__dirname, '..', 'certs');

/**
 * Collect every LAN IPv4 address on this machine so the generated cert
 * covers them. This is what lets other devices (phones) on the same
 * Wi-Fi hit https://192.168.x.y:3000 without an extra cert warning
 * beyond the usual "untrusted CA" one (which goes away once you install
 * the mkcert root CA on the phone).
 */
function collectLanAddresses() {
  const addrs = new Set();
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.add(net.address);
      }
    }
  }
  return Array.from(addrs);
}

// Create certs directory if it doesn't exist
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
  console.log('Created certs directory');
}

// Check if mkcert is installed
let mkcertCommand = 'mkcert';
try {
  execSync(`${mkcertCommand} --version`, { stdio: 'ignore' });
  console.log('✓ mkcert is installed');
} catch (error) {
  // Try common Windows paths
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const possiblePaths = [
      path.join(process.env.USERPROFILE || '', 'bin', 'mkcert.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'bin', 'mkcert.exe'),
      'C:\\bin\\mkcert.exe',
    ];
    
    let found = false;
    for (const mkcertPath of possiblePaths) {
      if (fs.existsSync(mkcertPath)) {
        mkcertCommand = mkcertPath;
        found = true;
        console.log(`✓ Found mkcert at: ${mkcertPath}`);
        break;
      }
    }
    
    if (!found) {
      console.error('✗ mkcert is not installed');
      console.log('\nPlease install mkcert first:');
      console.log('  Option 1: Run the installation script (as Administrator):');
      console.log('    .\\scripts\\install-mkcert-windows.ps1');
      console.log('  Option 2: Download manually from:');
      console.log('    https://github.com/FiloSottile/mkcert/releases/latest');
      console.log('    Download: mkcert-v1.4.4-windows-amd64.exe');
      console.log('    Rename to mkcert.exe and add to PATH');
      console.log('\nAfter installing, run: mkcert -install');
      process.exit(1);
    }
  } else {
    console.error('✗ mkcert is not installed');
    console.log('\nPlease install mkcert first:');
    console.log('  macOS: brew install mkcert');
    console.log('  Linux: See https://github.com/FiloSottile/mkcert#linux');
    console.log('\nAfter installing, run: mkcert -install');
    process.exit(1);
  }
}

// Check if certificates already exist
const keyPath = path.join(certsDir, 'localhost-key.pem');
const certPath = path.join(certsDir, 'localhost.pem');

// Allow forcing regeneration via `--force` so adding a new LAN IP is painless.
const forceRegen = process.argv.includes('--force');

const lanIps = collectLanAddresses();

if (fs.existsSync(keyPath) && fs.existsSync(certPath) && !forceRegen) {
  console.log('✓ SSL certificates already exist');
  console.log(
    '  To include new LAN IPs, run: node scripts/setup-https.js --force'
  );
} else {
  if (forceRegen) {
    console.log('Regenerating SSL certificates (--force)...');
  } else {
    console.log('Generating SSL certificates...');
  }
  try {
    const hosts = ['localhost', '127.0.0.1', '::1', ...lanIps];
    if (lanIps.length) {
      console.log('  Including LAN IPs in cert: ' + lanIps.join(', '));
    }
    execSync(
      `"${mkcertCommand}" -key-file "${keyPath}" -cert-file "${certPath}" ${hosts.join(' ')}`,
      {
        stdio: 'inherit',
        cwd: certsDir,
      }
    );
    console.log('✓ SSL certificates generated successfully!');
    console.log(`  Key: ${keyPath}`);
    console.log(`  Cert: ${certPath}`);
  } catch (error) {
    console.error('✗ Failed to generate certificates');
    console.error(error.message);
    process.exit(1);
  }
}

// Show the mkcert CA root folder so users can copy rootCA.pem to their
// phone and install it as a user certificate (needed so Chrome on
// Android trusts this dev server fully — without this, Web Bluetooth
// won't work even if the site loads).
try {
  const caRoot = execSync(`"${mkcertCommand}" -CAROOT`, { encoding: 'utf8' })
    .trim();
  if (caRoot) {
    console.log('\n✓ mkcert root CA directory: ' + caRoot);
    console.log(
      '  To trust this dev server on a phone, copy rootCA.pem from that'
    );
    console.log(
      '  folder to the device and install it (Android: Settings → Security'
    );
    console.log('   → Install certificate → CA certificate).');
  }
} catch {
  // Non-fatal; mkcert -CAROOT not supported in the found binary.
}

console.log('\n✓ HTTPS setup complete!');
console.log('  Run: npm run dev:https');
if (lanIps.length) {
  console.log('  Then access from this PC:     https://localhost:3000');
  console.log(
    '  From a phone on the same Wi-Fi: https://' +
      lanIps[0] +
      ':3000'
  );
  console.log(
    '  Make sure the HTTPS server binds to 0.0.0.0 (HOSTNAME env var).'
  );
} else {
  console.log('  Then access: https://localhost:3000');
}
