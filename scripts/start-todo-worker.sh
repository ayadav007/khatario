#!/bin/bash
# Start the Todo Reminder Worker
# This worker processes Redis queue jobs for todo reminders

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Start the worker using ts-node
npx ts-node --transpile-only lib/workers/todoReminderWorker.ts
