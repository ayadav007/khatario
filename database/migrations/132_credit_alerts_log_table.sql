-- Migration: Credit Alerts Log (Phase 5.4)
-- Purpose: Prevent duplicate WhatsApp credit alerts for same threshold crossing

-- Create credit_alerts_log table
CREATE TABLE IF NOT EXISTS credit_alerts_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
    entity_id UUID NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold IN (70, 90, 100)),
    last_alert_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- One alert per entity per threshold
    UNIQUE(business_id, entity_type, entity_id, threshold)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_credit_alerts_log_business ON credit_alerts_log(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_alerts_log_entity ON credit_alerts_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_credit_alerts_log_threshold ON credit_alerts_log(threshold);
CREATE INDEX IF NOT EXISTS idx_credit_alerts_log_sent_at ON credit_alerts_log(last_alert_sent_at DESC);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_credit_alerts_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_credit_alerts_log_updated_at
    BEFORE UPDATE ON credit_alerts_log
    FOR EACH ROW
    EXECUTE FUNCTION update_credit_alerts_log_updated_at();

COMMENT ON TABLE credit_alerts_log IS 'Tracks WhatsApp credit alerts sent to prevent duplicates';
COMMENT ON COLUMN credit_alerts_log.threshold IS 'Credit utilization threshold: 70, 90, or 100 percent';
COMMENT ON COLUMN credit_alerts_log.last_alert_sent_at IS 'Timestamp when alert was last sent for this threshold';
