# Todo Reminder Worker Setup

## Prerequisites
- Redis installed and running
- PM2 installed globally: `npm install -g pm2`

## Start Worker
```bash
pm2 start scripts/start-todo-worker.js --name todo-reminder-worker
pm2 save
pm2 startup  # Auto-start on reboot
```

## Worker Management

```bash
pm2 list                    # View workers
pm2 logs todo-reminder-worker  # View logs
pm2 restart todo-reminder-worker  # Restart
pm2 stop todo-reminder-worker    # Stop
pm2 delete todo-reminder-worker  # Remove
```

## Environment Variables

Ensure `.env.local` contains:

```
REDIS_URL=redis://localhost:6379
```

## Verify Worker

- Check PM2: `pm2 list` should show `todo-reminder-worker`
- Check logs: `pm2 logs todo-reminder-worker`
- Create todo with reminder, verify job scheduled in Redis
