// This script requires ts-node to run TypeScript files
// Run with: npx ts-node scripts/start-todo-worker.js
// Or: node --loader ts-node/esm scripts/start-todo-worker.js

require('dotenv').config({ path: '.env.local' });

// Register ts-node
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  }
});

// Import the worker
require('../lib/workers/todoReminderWorker');
