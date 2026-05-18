-- Migration 164: Label print audit log
-- Append-only log of every successful label print job. Powers the
-- "Label Printing Activity" report under Reports and lets admins prove to
-- auditors who printed what and when.

CREATE TABLE IF NOT EXISTS label_print_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- 'standalone' | 'purchase' | 'item_create' | 'unknown'
    purpose VARCHAR(30) NOT NULL DEFAULT 'standalone',
    -- NULL when caller used default layout (no saved template)
    template_id UUID REFERENCES label_templates(id) ON DELETE SET NULL,
    template_name VARCHAR(200),           -- snapshot in case template is deleted later
    -- Link back to the triggering purchase when purpose = 'purchase'
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    format VARCHAR(10) NOT NULL DEFAULT 'pdf',      -- pdf | html | zpl
    layout VARCHAR(20),                              -- A4_SHEET | ROLL
    symbology VARCHAR(20),
    -- Aggregates
    line_count INTEGER NOT NULL DEFAULT 0,
    total_labels INTEGER NOT NULL DEFAULT 0,
    -- Full per-line detail so auditors can reconstruct exactly what was printed.
    -- Shape: [{ item_id, variant_id, batch_id, name, barcode, copies, price, mrp }, ...]
    lines_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_label_print_log_business
    ON label_print_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_label_print_log_user
    ON label_print_log(user_id);
CREATE INDEX IF NOT EXISTS idx_label_print_log_purchase
    ON label_print_log(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_label_print_log_template
    ON label_print_log(template_id) WHERE template_id IS NOT NULL;

COMMENT ON TABLE label_print_log IS 'Append-only audit trail of label print jobs';
COMMENT ON COLUMN label_print_log.lines_snapshot IS 'Full per-line detail, captured at print time, so audit trail survives later edits';
