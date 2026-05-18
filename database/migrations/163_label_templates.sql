-- Migration 163: Label Templates
-- Stores reusable barcode label templates with absolute-positioned fields.
-- System templates (business_id IS NULL, is_system = TRUE) are read-only and
-- available to every business; businesses can also create / clone their own
-- custom templates.
--
-- Field layout is JSONB so the drag-and-drop designer can evolve without
-- breaking the schema. Each entry represents one renderable field on the
-- label cell and is positioned in millimeters relative to the top-left of
-- the cell.
--
-- field object shape:
--   {
--     "key":        "product_name" | "barcode" | "barcode_text" | "price" |
--                   "mrp" | "hsn" | "batch" | "mfg" | "expiry" |
--                   "net_quantity" | "fssai" | "country_of_origin" |
--                   "brand" | "business_name" | "variant_name",
--     "x_mm":       number,
--     "y_mm":       number,
--     "w_mm":       number,
--     "h_mm":       number,
--     "font_size":  number,   -- in pt
--     "bold":       boolean,
--     "align":      "left" | "center" | "right",
--     "visible":    boolean,
--     "prefix":     string | null,   -- optional text prefix, e.g. "MRP "
--     "suffix":     string | null
--   }

CREATE TABLE IF NOT EXISTS label_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- NULL for system-wide templates; non-null binds template to a single business
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    -- 'A4_SHEET' (multi-up on A4 page) | 'ROLL' (continuous / thermal roll)
    format VARCHAR(20) NOT NULL DEFAULT 'A4_SHEET',
    width_mm NUMERIC(6,2) NOT NULL,
    height_mm NUMERIC(6,2) NOT NULL,
    -- A4_SHEET-only layout knobs
    columns INTEGER,
    rows_count INTEGER,
    gap_x_mm NUMERIC(5,2) DEFAULT 0,
    gap_y_mm NUMERIC(5,2) DEFAULT 0,
    margin_top_mm NUMERIC(5,2) DEFAULT 0,
    margin_left_mm NUMERIC(5,2) DEFAULT 0,
    -- Barcode symbology preset applied when the line doesn't override.
    -- AUTO | EAN13 | EAN8 | UPCA | CODE128 | GS1_128 | QR | CODE39
    symbology VARCHAR(20) NOT NULL DEFAULT 'AUTO',
    -- Absolute-positioned field layout
    fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- System templates are seeded by this migration; they are read-only and
    -- visible to every business.
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT label_templates_format_chk
        CHECK (format IN ('A4_SHEET', 'ROLL')),
    CONSTRAINT label_templates_symbology_chk
        CHECK (symbology IN ('AUTO', 'EAN13', 'EAN8', 'UPCA', 'CODE128', 'GS1_128', 'QR', 'CODE39')),
    -- System rows must have business_id NULL; user rows must have a business_id.
    CONSTRAINT label_templates_scope_chk
        CHECK (
            (is_system = TRUE  AND business_id IS NULL) OR
            (is_system = FALSE AND business_id IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_label_templates_business
    ON label_templates(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_label_templates_active
    ON label_templates(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_label_templates_system
    ON label_templates(is_system) WHERE is_system = TRUE;

-- Unique name per business (system templates share the NULL scope, so we
-- apply a partial unique index specifically for system templates too).
CREATE UNIQUE INDEX IF NOT EXISTS ux_label_templates_name_per_business
    ON label_templates(business_id, name) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_label_templates_name_system
    ON label_templates(name) WHERE business_id IS NULL;

DROP TRIGGER IF EXISTS update_label_templates_updated_at ON label_templates;
CREATE TRIGGER update_label_templates_updated_at
    BEFORE UPDATE ON label_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  label_templates          IS 'Reusable barcode label templates with absolute-positioned fields';
COMMENT ON COLUMN label_templates.fields   IS 'Array of field objects: {key,x_mm,y_mm,w_mm,h_mm,font_size,bold,align,visible,prefix,suffix}';
COMMENT ON COLUMN label_templates.is_system IS 'System templates (business_id NULL) are seeded and read-only to end-users';

-- ===========================================================================
-- Seed 3 system templates for Indian food-retail scenarios
-- ===========================================================================

-- Helper: all layouts use mm units and pt font sizes. The renderer applies
-- these literally; the designer persists the same shape.

-- Template 1: A4 21-up — 63.5 x 38.1 mm (Avery L7160 / standard cheap sheets)
-- Fields are arranged in bands from top to bottom.
INSERT INTO label_templates (
    business_id, name, description, format,
    width_mm, height_mm, columns, rows_count,
    gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
    symbology, is_system, fields
) VALUES (
    NULL,
    'A4 21-up Food Retail',
    'Standard A4 sticker sheet (3 columns x 7 rows) sized 63.5 x 38.1 mm — tuned for packaged food retail with brand, net quantity, MFG / EXP, MRP and FSSAI.',
    'A4_SHEET',
    63.5, 38.1, 3, 7,
    2.5, 0, 10, 7.75,
    'AUTO', TRUE,
    $${
        "fields": []
    }$$::jsonb
) ON CONFLICT DO NOTHING;

-- Populate fields separately so the JSONB stays readable. We update by name
-- so re-runs (the ON CONFLICT DO NOTHING on the insert above becomes a no-op
-- but we still want the fields to reflect current code).
UPDATE label_templates
SET fields = $$[
    { "key": "business_name",    "x_mm": 2,   "y_mm": 1.0, "w_mm": 59.5, "h_mm": 3.0,  "font_size": 6, "bold": false, "align": "left",   "visible": true  },
    { "key": "brand",            "x_mm": 2,   "y_mm": 4.0, "w_mm": 59.5, "h_mm": 3.5,  "font_size": 7, "bold": true,  "align": "left",   "visible": true  },
    { "key": "product_name",     "x_mm": 2,   "y_mm": 7.5, "w_mm": 59.5, "h_mm": 4.0,  "font_size": 9, "bold": true,  "align": "left",   "visible": true  },
    { "key": "net_quantity",     "x_mm": 2,   "y_mm": 11.5,"w_mm": 30,   "h_mm": 3,    "font_size": 7, "bold": false, "align": "left",   "visible": true, "prefix": "Net: " },
    { "key": "barcode",          "x_mm": 4,   "y_mm": 15,  "w_mm": 55,   "h_mm": 11,   "font_size": 0, "bold": false, "align": "center", "visible": true  },
    { "key": "barcode_text",     "x_mm": 2,   "y_mm": 26.5,"w_mm": 59.5, "h_mm": 3,    "font_size": 7, "bold": true,  "align": "center", "visible": true  },
    { "key": "price",            "x_mm": 2,   "y_mm": 30,  "w_mm": 30,   "h_mm": 4,    "font_size": 9, "bold": true,  "align": "left",   "visible": true  },
    { "key": "mrp",              "x_mm": 32,  "y_mm": 30,  "w_mm": 29.5, "h_mm": 4,    "font_size": 7, "bold": false, "align": "right",  "visible": true, "prefix": "MRP " },
    { "key": "mfg",              "x_mm": 2,   "y_mm": 34,  "w_mm": 20,   "h_mm": 2.5,  "font_size": 5, "bold": false, "align": "left",   "visible": true, "prefix": "MFG " },
    { "key": "expiry",           "x_mm": 22,  "y_mm": 34,  "w_mm": 20,   "h_mm": 2.5,  "font_size": 5, "bold": false, "align": "left",   "visible": true, "prefix": "EXP " },
    { "key": "country_of_origin","x_mm": 42,  "y_mm": 34,  "w_mm": 19.5, "h_mm": 2.5,  "font_size": 5, "bold": false, "align": "right",  "visible": true  },
    { "key": "fssai",            "x_mm": 2,   "y_mm": 36,  "w_mm": 59.5, "h_mm": 2,    "font_size": 5, "bold": false, "align": "center", "visible": true, "prefix": "FSSAI " }
]$$::jsonb
WHERE is_system = TRUE AND name = 'A4 21-up Food Retail';

-- Template 2: Roll 50 x 25 mm — classic thermal receipt roll label
INSERT INTO label_templates (
    business_id, name, description, format,
    width_mm, height_mm, columns, rows_count,
    gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
    symbology, is_system, fields
) VALUES (
    NULL,
    'Roll 50x25mm Retail',
    'Compact continuous-roll label (50 x 25 mm) for thermal printers. Shows brand, name, barcode, price and batch info.',
    'ROLL',
    50, 25, NULL, NULL,
    0, 0, 0, 0,
    'AUTO', TRUE,
    '[]'::jsonb
) ON CONFLICT DO NOTHING;

UPDATE label_templates
SET fields = $$[
    { "key": "brand",        "x_mm": 1.5, "y_mm": 0.5, "w_mm": 47,   "h_mm": 2.5, "font_size": 6, "bold": true,  "align": "left",   "visible": true  },
    { "key": "product_name", "x_mm": 1.5, "y_mm": 3.0, "w_mm": 47,   "h_mm": 3.0, "font_size": 8, "bold": true,  "align": "left",   "visible": true  },
    { "key": "net_quantity", "x_mm": 1.5, "y_mm": 6.0, "w_mm": 25,   "h_mm": 2.5, "font_size": 6, "bold": false, "align": "left",   "visible": true, "prefix": "Net: " },
    { "key": "barcode",      "x_mm": 3,   "y_mm": 8.5, "w_mm": 44,   "h_mm": 8,   "font_size": 0, "bold": false, "align": "center", "visible": true  },
    { "key": "barcode_text", "x_mm": 1.5, "y_mm": 16.5,"w_mm": 47,   "h_mm": 2.5, "font_size": 6, "bold": true,  "align": "center", "visible": true  },
    { "key": "price",        "x_mm": 1.5, "y_mm": 19,  "w_mm": 23,   "h_mm": 3.5, "font_size": 9, "bold": true,  "align": "left",   "visible": true  },
    { "key": "mrp",          "x_mm": 24.5,"y_mm": 19.5,"w_mm": 24,   "h_mm": 2.5, "font_size": 6, "bold": false, "align": "right",  "visible": true, "prefix": "MRP " },
    { "key": "expiry",       "x_mm": 1.5, "y_mm": 22.5,"w_mm": 47,   "h_mm": 2,   "font_size": 5, "bold": false, "align": "center", "visible": true, "prefix": "EXP " }
]$$::jsonb
WHERE is_system = TRUE AND name = 'Roll 50x25mm Retail';

-- Template 3: Food Retail Premium 70 x 40 mm — larger format with full
-- compliance footprint (brand, FSSAI, MFG, EXP, net qty, country of origin).
INSERT INTO label_templates (
    business_id, name, description, format,
    width_mm, height_mm, columns, rows_count,
    gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
    symbology, is_system, fields
) VALUES (
    NULL,
    'Food Retail Premium 70x40',
    'Larger 70 x 40 mm roll label tuned for packaged food: prominent brand, net quantity, MRP, MFG / EXP, FSSAI number and country of origin.',
    'ROLL',
    70, 40, NULL, NULL,
    0, 0, 0, 0,
    'AUTO', TRUE,
    '[]'::jsonb
) ON CONFLICT DO NOTHING;

UPDATE label_templates
SET fields = $$[
    { "key": "brand",            "x_mm": 2,   "y_mm": 1.0, "w_mm": 66, "h_mm": 4.5, "font_size": 10, "bold": true,  "align": "left",   "visible": true  },
    { "key": "product_name",     "x_mm": 2,   "y_mm": 5.5, "w_mm": 66, "h_mm": 5.0, "font_size": 11, "bold": true,  "align": "left",   "visible": true  },
    { "key": "net_quantity",     "x_mm": 2,   "y_mm": 10.5,"w_mm": 33, "h_mm": 3.5, "font_size": 8,  "bold": false, "align": "left",   "visible": true, "prefix": "Net: " },
    { "key": "country_of_origin","x_mm": 35,  "y_mm": 10.5,"w_mm": 33, "h_mm": 3.5, "font_size": 8,  "bold": false, "align": "right",  "visible": true, "prefix": "Origin: " },
    { "key": "barcode",          "x_mm": 4,   "y_mm": 14.5,"w_mm": 62, "h_mm": 12,  "font_size": 0,  "bold": false, "align": "center", "visible": true  },
    { "key": "barcode_text",     "x_mm": 2,   "y_mm": 26.5,"w_mm": 66, "h_mm": 3,   "font_size": 8,  "bold": true,  "align": "center", "visible": true  },
    { "key": "price",            "x_mm": 2,   "y_mm": 30,  "w_mm": 33, "h_mm": 4.5, "font_size": 11, "bold": true,  "align": "left",   "visible": true  },
    { "key": "mrp",              "x_mm": 35,  "y_mm": 30.5,"w_mm": 33, "h_mm": 3.5, "font_size": 8,  "bold": false, "align": "right",  "visible": true, "prefix": "MRP " },
    { "key": "mfg",              "x_mm": 2,   "y_mm": 35,  "w_mm": 22, "h_mm": 2.5, "font_size": 6,  "bold": false, "align": "left",   "visible": true, "prefix": "MFG " },
    { "key": "expiry",           "x_mm": 24,  "y_mm": 35,  "w_mm": 22, "h_mm": 2.5, "font_size": 6,  "bold": false, "align": "left",   "visible": true, "prefix": "EXP " },
    { "key": "batch",            "x_mm": 46,  "y_mm": 35,  "w_mm": 22, "h_mm": 2.5, "font_size": 6,  "bold": false, "align": "right",  "visible": true, "prefix": "BATCH " },
    { "key": "fssai",            "x_mm": 2,   "y_mm": 37.5,"w_mm": 66, "h_mm": 2.5, "font_size": 6,  "bold": false, "align": "center", "visible": true, "prefix": "FSSAI " }
]$$::jsonb
WHERE is_system = TRUE AND name = 'Food Retail Premium 70x40';
