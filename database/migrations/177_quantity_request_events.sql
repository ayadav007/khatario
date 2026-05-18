-- Audit trail for B2B quantity requests (workflow history)

CREATE TABLE IF NOT EXISTS quantity_request_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quantity_request_id UUID NOT NULL REFERENCES quantity_requests(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quantity_request_events_request
  ON quantity_request_events(quantity_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quantity_request_events_business
  ON quantity_request_events(business_id, created_at DESC);

COMMENT ON TABLE quantity_request_events IS
  'Append-only audit log: created, responded, mapping_updated, document_linked, spawn_upstream';
