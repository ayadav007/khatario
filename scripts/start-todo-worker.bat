@echo off
REM Start the Todo Reminder Worker for Windows
REM This worker processes Redis queue jobs for todo reminders

echo Starting Todo Reminder Worker...
echo.

REM Load environment variables from .env.local if it exists
if exist .env.local (
    for /f "tokens=1* delims==" %%a in (.env.local) do (
        set "%%a=%%b"
    )
)

REM Start the worker using ts-node
npx ts-node --transpile-only lib/workers/todoReminderWorker.ts

pause
