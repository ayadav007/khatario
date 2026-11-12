/** Production PM2 app. cwd is the second git clone on the VPS. */
const fs = require('fs');
const path = require('path');

const root = process.env.KHATARIO_PROD_ROOT || '/var/www/khatario-prod';

function readEnvPort() {
  try {
    const text = fs.readFileSync(path.join(root, '.env.production'), 'utf8');
    const line = text.split(/\r?\n/).reverse().find((l) => /^PORT=/.test(l));
    const value = line ? line.slice(5).trim().replace(/^["']|["']$/g, '') : '';
    if (/^\d+$/.test(value)) return value;
  } catch {
    /* fall through */
  }
  return process.env.PORT || '3100';
}

const port = readEnvPort();

module.exports = {
  apps: [
    {
      name: 'khatario',
      cwd: root,
      script: 'npm',
      // The hostname must be the word "localhost", not 127.0.0.1. Next's middleware always sees
      // its own origin as "localhost", while the router uses the -H value; when the two differ,
      // the store-subdomain rewrite to /store is taken for an external URL and proxied to
      // https://localhost:<port> (nginx sends X-Forwarded-Proto https), which fails on this plain
      // HTTP port and every storefront returns 500.
      args: `run start:http -- -H localhost -p ${port}`,
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: port,
        // "localhost" resolves to ::1 first on the VPS; nginx's upstream is 127.0.0.1, so bind IPv4.
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
      max_memory_restart: '1536M',
      kill_timeout: 8000,
    },
  ],
};
