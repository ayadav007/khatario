-- Migration 142: Backup Management System
-- Creates tables for user self-service backup and restore functionality

-- Backup History: Track all backups created
CREATE TABLE IF NOT EXISTS backup_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    backup_type VARCHAR(20) NOT NULL, -- 'manual', 'scheduled'
    backup_version VARCHAR(10) DEFAULT '2.0',
    file_size BIGINT, -- Size in bytes
    record_counts JSONB, -- Statistics of what was backed up
    storage_location VARCHAR(50), -- 'local', 'google_drive', 'dropbox'
    cloud_file_id TEXT, -- ID in cloud storage (if applicable)
    cloud_file_path TEXT, -- Path in cloud storage
    status VARCHAR(20) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_backup_history_business ON backup_history(business_id);
CREATE INDEX idx_backup_history_created_at ON backup_history(created_at DESC);
CREATE INDEX idx_backup_history_status ON backup_history(status);

-- Backup Schedules: User-configured automatic backups
CREATE TABLE IF NOT EXISTS backup_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT true,
    frequency VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
    time_of_day TIME NOT NULL, -- When to run (e.g., '02:00:00')
    timezone VARCHAR(50) DEFAULT 'UTC',
    day_of_week INTEGER, -- 0-6 for weekly (0 = Sunday), NULL for daily/monthly
    day_of_month INTEGER, -- 1-31 for monthly, NULL for daily/weekly
    storage_destination VARCHAR(50) NOT NULL, -- 'google_drive', 'dropbox', 'local'
    retention_days INTEGER DEFAULT 30, -- Auto-delete backups older than this
    notification_email VARCHAR(255),
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP NOT NULL,
    consecutive_failures INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id) -- One schedule per business
);

CREATE INDEX idx_backup_schedules_next_run ON backup_schedules(next_run_at) WHERE is_enabled = true;
CREATE INDEX idx_backup_schedules_business ON backup_schedules(business_id);

-- Cloud Storage Connections: Store encrypted OAuth tokens
CREATE TABLE IF NOT EXISTS cloud_storage_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL, -- 'google_drive', 'dropbox'
    access_token_encrypted TEXT, -- Encrypted with app secret
    refresh_token_encrypted TEXT NOT NULL, -- Encrypted refresh token
    token_expires_at TIMESTAMP,
    provider_user_id VARCHAR(255), -- User ID from provider
    provider_user_email VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, provider) -- One connection per provider per business
);

CREATE INDEX idx_cloud_storage_business ON cloud_storage_connections(business_id);
CREATE INDEX idx_cloud_storage_provider ON cloud_storage_connections(provider, is_active);

-- Restore Operations: Track restore operations for audit
CREATE TABLE IF NOT EXISTS restore_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    initiated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    backup_history_id UUID REFERENCES backup_history(id) ON DELETE SET NULL,
    restore_mode VARCHAR(20) NOT NULL, -- 'replace_all', 'merge_smart', 'selective'
    selected_modules JSONB, -- For selective restore
    status VARCHAR(20) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed', 'rolled_back'
    records_restored JSONB, -- Statistics of what was restored
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_restore_operations_business ON restore_operations(business_id);
CREATE INDEX idx_restore_operations_started_at ON restore_operations(started_at DESC);

-- Comments for documentation
COMMENT ON TABLE backup_history IS 'Tracks all backup operations including manual and scheduled backups';
COMMENT ON TABLE backup_schedules IS 'User-configured automatic backup schedules';
COMMENT ON TABLE cloud_storage_connections IS 'Stores encrypted OAuth tokens for cloud storage providers';
COMMENT ON TABLE restore_operations IS 'Audit trail of all restore operations';

COMMENT ON COLUMN backup_schedules.time_of_day IS 'Time to run backup in user timezone (24-hour format)';
COMMENT ON COLUMN backup_schedules.day_of_week IS '0=Sunday, 1=Monday, ..., 6=Saturday';
COMMENT ON COLUMN backup_schedules.retention_days IS 'Auto-delete backups older than this many days';
COMMENT ON COLUMN cloud_storage_connections.access_token_encrypted IS 'Encrypted with AES-256 using app secret key';
COMMENT ON COLUMN cloud_storage_connections.refresh_token_encrypted IS 'Encrypted OAuth refresh token';
