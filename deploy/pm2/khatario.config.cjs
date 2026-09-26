/** Production PM2 app. cwd is the second git clone on the VPS. */
module.exports = {
  apps: [
    {
      name: 'khatario',
      cwd: process.env.KHATARIO_PROD_ROOT || '/var/www/khatario-prod',
      script: 'npm',
      args: 'run start:http -- -H 127.0.0.1',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '1536M',
      kill_timeout: 8000,
    },
  ],
};
