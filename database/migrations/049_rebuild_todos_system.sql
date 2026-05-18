-- Migration: Business-grade Todo & Reminder System
-- This rebuilds the todo system with enhanced features

-- Drop history table first (it references todos)
DROP TABLE IF EXISTS todo_history CASCADE;

-- Handle existing todos table - migrate data if exists
DO $$ 
BEGIN
    -- Check if old todos table exists and has data
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'todos') THEN
        -- Backup old data (optional - uncomment if you want to preserve)
        -- CREATE TABLE todos_backup AS SELECT * FROM todos;
        
        -- Drop old todos table (data will be lost - user should back up first)
        DROP TABLE IF EXISTS todos CASCADE;
    END IF;
END $$;

-- Create enums
CREATE TYPE todo_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE todo_status AS ENUM ('pending', 'in_progress', 'completed', 'overdue');
CREATE TYPE todo_reminder_type AS ENUM ('none', 'once', 'recurring');
CREATE TYPE reminder_channel AS ENUM ('in_app', 'email', 'whatsapp');

-- Main todos table
CREATE TABLE todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Core fields
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ NOT NULL,
    priority todo_priority DEFAULT 'medium',
    status todo_status DEFAULT 'pending',
    
    -- Reminder configuration
    reminder_type todo_reminder_type DEFAULT 'once',
    reminder_time TIMESTAMPTZ, -- When to remind (can be before due_date)
    reminder_channels reminder_channel[] DEFAULT ARRAY['in_app']::reminder_channel[],
    reminder_sent BOOLEAN DEFAULT false,
    last_reminder_sent_at TIMESTAMPTZ,
    
    -- Business integration
    related_entity_type VARCHAR(50), -- 'invoice', 'gst_return', 'party', 'purchase', etc.
    related_entity_id UUID, -- ID of the related entity
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Constraints
    CONSTRAINT valid_reminder_time CHECK (
        reminder_type = 'none' OR reminder_time IS NOT NULL
    )
);

-- Todo history for audit trail
CREATE TABLE todo_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    todo_id UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'completed', 'rescheduled', 'priority_changed', 'status_changed', 'reminder_sent'
    old_value TEXT,
    new_value TEXT,
    action_date TIMESTAMPTZ DEFAULT NOW(),
    action_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Additional metadata for rescheduling
    old_due_date TIMESTAMPTZ,
    new_due_date TIMESTAMPTZ,
    reason TEXT
);

-- Indexes for performance
CREATE INDEX idx_todos_business_id ON todos(business_id);
CREATE INDEX idx_todos_assigned_to ON todos(assigned_to);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_todos_priority ON todos(priority);
CREATE INDEX idx_todos_reminder_time ON todos(reminder_time) WHERE reminder_sent = false AND status IN ('pending', 'in_progress');
CREATE INDEX idx_todos_related_entity ON todos(related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;
CREATE INDEX idx_todo_history_todo_id ON todo_history(todo_id);
CREATE INDEX idx_todo_history_action_date ON todo_history(action_date DESC);

-- Trigger for updated_at
CREATE TRIGGER update_todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-mark overdue todos
CREATE OR REPLACE FUNCTION mark_overdue_todos()
RETURNS void AS $$
BEGIN
    UPDATE todos
    SET status = 'overdue',
        updated_at = NOW()
    WHERE status IN ('pending', 'in_progress')
      AND due_date < NOW()
      AND status != 'overdue';
END;
$$ LANGUAGE plpgsql;

-- Function to create history entry
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

