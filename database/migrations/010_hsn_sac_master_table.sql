-- Migration: HSN/SAC Master Table
-- Purpose: Create lookup table for HSN/SAC codes with descriptions and GST rates
-- This enables automatic HSN/SAC code lookup when adding products

-- Create HSN/SAC Master Table
CREATE TABLE IF NOT EXISTS hsn_sac_master (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  gst_rate DECIMAL(5,2),
  category VARCHAR(255),
  is_service BOOLEAN DEFAULT false, -- true for SAC, false for HSN
  keywords TEXT[], -- Array of search keywords for faster lookup
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for fast searches
CREATE INDEX IF NOT EXISTS idx_hsn_sac_code ON hsn_sac_master(code);
CREATE INDEX IF NOT EXISTS idx_hsn_sac_description ON hsn_sac_master USING gin(to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS idx_hsn_sac_keywords ON hsn_sac_master USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_hsn_sac_category ON hsn_sac_master(category);

-- Insert some common HSN/SAC codes for initial data
-- These are frequently used codes across industries

-- Common Goods (HSN)
INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords) VALUES
('19053100', 'Biscuits and similar baked products', 5.00, 'Food & Beverages', false, ARRAY['biscuit', 'cookie', 'snack', 'baked']),
('21069099', 'Food preparations not elsewhere specified', 5.00, 'Food & Beverages', false, ARRAY['food', 'preparation']),
('30049099', 'Medicines and pharmaceutical products', 12.00, 'Healthcare', false, ARRAY['medicine', 'pharmaceutical', 'drug', 'tablet']),
('49019900', 'Books, printed matter', 0.00, 'Education', false, ARRAY['book', 'printed', 'education']),
('69111000', 'Tableware and kitchenware, of porcelain or china', 28.00, 'Household', false, ARRAY['tableware', 'kitchenware', 'porcelain']),
('85171200', 'Telephones for cellular networks', 18.00, 'Electronics', false, ARRAY['mobile', 'phone', 'smartphone', 'cellphone']),
('87032100', 'Passenger cars with spark-ignition internal combustion reciprocating piston engine', 28.00, 'Automobiles', false, ARRAY['car', 'vehicle', 'automobile', 'passenger']),
('94032000', 'Other metal furniture', 18.00, 'Furniture', false, ARRAY['furniture', 'metal', 'table', 'chair']),
('84211200', 'Washing machines', 28.00, 'Appliances', false, ARRAY['washing machine', 'appliance']),
('85287200', 'Monitors and projectors', 18.00, 'Electronics', false, ARRAY['monitor', 'display', 'projector'])
ON CONFLICT (code) DO NOTHING;

-- Common Services (SAC)
INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords) VALUES
('998311', 'Software development services', 18.00, 'IT Services', true, ARRAY['software', 'development', 'IT', 'service', 'programming']),
('998312', 'Information technology (IT) consulting services', 18.00, 'IT Services', true, ARRAY['IT', 'consulting', 'technology']),
('998314', 'Data processing, hosting and related services', 18.00, 'IT Services', true, ARRAY['data', 'hosting', 'cloud', 'server']),
('998315', 'Web design and development services', 18.00, 'IT Services', true, ARRAY['web', 'design', 'website', 'development']),
('998316', 'Maintenance, repair and installation services', 18.00, 'IT Services', true, ARRAY['maintenance', 'repair', 'installation']),
('998334', 'Management consulting services', 18.00, 'Consulting', true, ARRAY['management', 'consulting', 'advisory']),
('998341', 'Accounting, auditing and bookkeeping services', 18.00, 'Professional Services', true, ARRAY['accounting', 'auditing', 'bookkeeping', 'CA']),
('998342', 'Legal services', 18.00, 'Professional Services', true, ARRAY['legal', 'lawyer', 'advocate', 'law']),
('998344', 'Architectural services', 18.00, 'Professional Services', true, ARRAY['architecture', 'architect', 'design']),
('998391', 'Advertising services', 18.00, 'Marketing', true, ARRAY['advertising', 'marketing', 'promotion']),
('998513', 'Telecommunication services', 18.00, 'Telecom', true, ARRAY['telecom', 'communication', 'phone', 'internet']),
('998614', 'Restaurant and catering services', 5.00, 'Food Services', true, ARRAY['restaurant', 'catering', 'food service', 'dining']),
('998621', 'Hotel accommodation services', 18.00, 'Hospitality', true, ARRAY['hotel', 'accommodation', 'lodging']),
('998717', 'Real estate services', 18.00, 'Real Estate', true, ARRAY['real estate', 'property', 'brokerage'])
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE hsn_sac_master IS 'Master table for HSN/SAC codes lookup. Used for automatic code suggestion when adding products.';
COMMENT ON COLUMN hsn_sac_master.code IS 'HSN code (8 digits) or SAC code (6 digits)';
COMMENT ON COLUMN hsn_sac_master.is_service IS 'true for SAC (services), false for HSN (goods)';
COMMENT ON COLUMN hsn_sac_master.keywords IS 'Array of search keywords for fuzzy matching';

