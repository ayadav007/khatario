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
      args: `run start:http -- -H 127.0.0.1 -p ${port}`,
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: port,
      },
      max_memory_restart: '1536M',
      kill_timeout: 8000,
    },
  ],
};
