-- Migration 111: Invoice Templates Table
-- Stores custom templates for invoice extraction

CREATE TABLE IF NOT EXISTS invoice_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    template_name VARCHAR(255) NOT NULL,
    vendor_pattern VARCHAR(255),
    template_yaml TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_global BOOLEAN DEFAULT false, -- Global templates available to all businesses
    usage_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_template_name_per_business UNIQUE(business_id, template_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_invoice_templates_business ON invoice_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_invoice_templates_active ON invoice_templates(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_invoice_templates_global ON invoice_templates(is_global) WHERE is_global = true;
CREATE INDEX IF NOT EXISTS idx_invoice_templates_vendor ON invoice_templates(vendor_pattern);

-- Add trigger to update updated_at
CREATE TRIGGER update_invoice_templates_updated_at
    BEFORE UPDATE ON invoice_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE invoice_templates IS 'Custom templates for invoice data extraction';
COMMENT ON COLUMN invoice_templates.template_yaml IS 'YAML template definition for invoice2data';
COMMENT ON COLUMN invoice_templates.vendor_pattern IS 'Pattern to match vendor name (for auto-selection)';
COMMENT ON COLUMN invoice_templates.is_global IS 'Whether template is available to all businesses';
COMMENT ON COLUMN invoice_templates.usage_count IS 'Number of times template has been used';
COMMENT ON COLUMN invoice_templates.success_count IS 'Number of successful extractions using this template';
