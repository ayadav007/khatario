-- Quick fix: Add missing columns to todos table
-- Run this if migration 049 didn't complete successfully

-- First, update the todo_status enum to include new values if it exists
DO $$
BEGIN
    -- Check if enum exists
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'todo_status') THEN
        -- Try to add missing values (PostgreSQL allows adding to end of enum)
        BEGIN
            -- Check if 'in_progress' exists, if not add it
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum 
                WHERE enumlabel = 'in_progress' 
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'todo_status')
            ) THEN
                ALTER TYPE todo_status ADD VALUE 'in_progress';
            END IF;
            
            -- Check if 'overdue' exists, if not add it
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum 
                WHERE enumlabel = 'overdue' 
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'todo_status')
            ) THEN
                ALTER TYPE todo_status ADD VALUE 'overdue';
            END IF;
            
            RAISE NOTICE 'Updated todo_status enum';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not update enum: %', SQLERRM;
        END;
    END IF;
END $$;

-- First, check what columns exist and add missing ones
DO $$ 
BEGIN
    -- Add assigned_to if missing (may have old user_id column)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'assigned_to'
    ) THEN
        -- If user_id exists, copy it to assigned_to
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'todos' AND column_name = 'user_id'
        ) THEN
            ALTER TABLE todos ADD COLUMN assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
            UPDATE todos SET assigned_to = user_id WHERE user_id IS NOT NULL;
        ELSE
            ALTER TABLE todos ADD COLUMN assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
        END IF;
    END IF;
    
    -- Add reminder_type if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'reminder_type'
    ) THEN
        ALTER TABLE todos ADD COLUMN reminder_type VARCHAR(20) DEFAULT 'once';
        -- Copy from reminder_at if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'todos' AND column_name = 'reminder_at'
        ) THEN
            UPDATE todos SET reminder_type = 'once' WHERE reminder_at IS NOT NULL;
        END IF;
    END IF;
    
    -- Add reminder_time if missing (may have old reminder_at)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'reminder_time'
    ) THEN
        ALTER TABLE todos ADD COLUMN reminder_time TIMESTAMPTZ;
        -- Copy from reminder_at if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'todos' AND column_name = 'reminder_at'
        ) THEN
            UPDATE todos SET reminder_time = reminder_at WHERE reminder_at IS NOT NULL;
        END IF;
    END IF;
    
    -- Add reminder_channels if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'reminder_channels'
    ) THEN
        ALTER TABLE todos ADD COLUMN reminder_channels VARCHAR[] DEFAULT ARRAY['in_app'];
    END IF;
    
    -- Add last_reminder_sent_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'last_reminder_sent_at'
    ) THEN
        ALTER TABLE todos ADD COLUMN last_reminder_sent_at TIMESTAMPTZ;
    END IF;
    
    -- Add related_entity_type if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'related_entity_type'
    ) THEN
        ALTER TABLE todos ADD COLUMN related_entity_type VARCHAR(50);
    END IF;
    
    -- Add related_entity_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'related_entity_id'
    ) THEN
        ALTER TABLE todos ADD COLUMN related_entity_id UUID;
    END IF;
    
    -- Add completed_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'completed_at'
    ) THEN
        ALTER TABLE todos ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;
    
    -- Add created_by if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'todos' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE todos ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    
    RAISE NOTICE 'Added missing columns to todos table';
END $$;

-- Create todo_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS todo_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    todo_id UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    action_date TIMESTAMPTZ DEFAULT NOW(),
    action_by UUID REFERENCES users(id) ON DELETE SET NULL,
    old_due_date TIMESTAMPTZ,
    new_due_date TIMESTAMPTZ,
    reason TEXT
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_todo_history_todo_id ON todo_history(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_history_action_date ON todo_history(action_date DESC);

-- Create or replace the create_todo_history function
CREATE OR REPLACE FUNCTION create_todo_history(
    p_todo_id UUID,
    p_action VARCHAR,
    p_old_value TEXT DEFAULT NULL,
    p_new_value TEXT DEFAULT NULL,
    p_action_by UUID DEFAULT NULL,
    p_old_due_date TIMESTAMPTZ DEFAULT NULL,
    p_new_due_date TIMESTAMPTZ DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    INSERT INTO todo_history (
        todo_id, action, old_value, new_value, action_by,
        old_due_date, new_due_date, reason
    ) VALUES (
        p_todo_id, p_action, p_old_value, p_new_value, p_action_by,
        p_old_due_date, p_new_due_date, p_reason
    );
END;
$$ LANGUAGE plpgsql;

-- Create the mark_overdue_todos function
CREATE OR REPLACE FUNCTION mark_overdue_todos()
RETURNS void AS $$
BEGIN
    -- Update todos that are pending or in_progress and past due date to overdue
    UPDATE todos
    SET status = 'overdue',
        updated_at = NOW()
    WHERE status IN ('pending', 'in_progress')
      AND due_date < NOW();
END;
$$ LANGUAGE plpgsql;

