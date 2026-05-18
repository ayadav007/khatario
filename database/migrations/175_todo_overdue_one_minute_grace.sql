-- Give todos a 1-minute grace after due_date before flipping to overdue.
-- Example: due at 9:44 → status becomes overdue at 9:45, so a 9:44 reminder can still run while status is pending/in_progress.

CREATE OR REPLACE FUNCTION mark_overdue_todos()
RETURNS void AS $$
BEGIN
    UPDATE todos
    SET status = 'overdue',
        updated_at = NOW()
    WHERE status IN ('pending', 'in_progress')
      AND due_date + INTERVAL '1 minute' <= NOW();
END;
$$ LANGUAGE plpgsql;
