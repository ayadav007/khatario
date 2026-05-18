-- Migration: HSN AI Cache and Usage Stats
-- Purpose: Create tables for caching AI suggestions and tracking HSN usage patterns

-- AI Suggestions Cache Table
CREATE TABLE IF NOT EXISTS hsn_ai_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_key VARCHAR(255) NOT NULL, -- normalized product name + category
  hsn_code VARCHAR(10),
  description TEXT,
  gst_rate DECIMAL(5,2),
  confidence VARCHAR(20), -- 'high', 'medium', 'low'
  reasoning TEXT,
  category VARCHAR(255),
  is_service BOOLEAN DEFAULT false,
  source VARCHAR(50) DEFAULT 'groq_ai',
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index on product_key (one suggestion per product)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsn_ai_product_key_unique ON hsn_ai_suggestions(product_key);

-- Additional indexes for AI cache
CREATE INDEX IF NOT EXISTS idx_hsn_ai_usage_count ON hsn_ai_suggestions(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_hsn_ai_last_used ON hsn_ai_suggestions(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_hsn_ai_code ON hsn_ai_suggestions(hsn_code);

-- Usage tracking for learning
CREATE TABLE IF NOT EXISTS hsn_usage_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  hsn_sac_code VARCHAR(10),
  gst_rate DECIMAL(5,2),
  product_name VARCHAR(255),
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, hsn_sac_code, gst_rate, product_name)
);

-- Indexes for usage stats
CREATE INDEX IF NOT EXISTS idx_hsn_usage_stats_code ON hsn_usage_stats(hsn_sac_code);
CREATE INDEX IF NOT EXISTS idx_hsn_usage_stats_business ON hsn_usage_stats(business_id);
CREATE INDEX IF NOT EXISTS idx_hsn_usage_stats_last_used ON hsn_usage_stats(last_used_at DESC);

COMMENT ON TABLE hsn_ai_suggestions IS 'Cache table for AI-generated HSN/SAC suggestions from Groq API';
COMMENT ON TABLE hsn_usage_stats IS 'Tracks actual HSN/SAC code usage patterns per business for learning';

