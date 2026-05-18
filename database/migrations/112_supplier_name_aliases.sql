-- Migration 112: Supplier Name Aliases Table
-- Stores alternative names for suppliers to improve fuzzy matching

CREATE TABLE IF NOT EXISTS supplier_name_aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    alias_name VARCHAR(255) NOT NULL,
    alias_type VARCHAR(50) DEFAULT 'manual', -- 'manual', 'auto_learned', 'extracted'
    confidence_score DECIMAL(5,2), -- 0-100, for auto-learned aliases
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_alias_per_supplier UNIQUE(supplier_id, alias_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_supplier_aliases_supplier ON supplier_name_aliases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_aliases_name ON supplier_name_aliases(alias_name);
CREATE INDEX IF NOT EXISTS idx_supplier_aliases_type ON supplier_name_aliases(alias_type);

-- Add comments
COMMENT ON TABLE supplier_name_aliases IS 'Alternative names for suppliers to improve matching during invoice extraction';
COMMENT ON COLUMN supplier_name_aliases.alias_name IS 'Alternative name or variation of supplier name';
COMMENT ON COLUMN supplier_name_aliases.alias_type IS 'How the alias was created: manual, auto_learned, extracted';
COMMENT ON COLUMN supplier_name_aliases.confidence_score IS 'Confidence score for auto-learned aliases (0-100)';

-- Add some helper functions

-- Function to find supplier by name or alias
CREATE OR REPLACE FUNCTION find_supplier_by_name(
    p_business_id UUID,
    p_name VARCHAR,
    p_threshold INTEGER DEFAULT 3
) RETURNS TABLE (
    supplier_id UUID,
    match_type VARCHAR,
    similarity_score INTEGER
) AS $$
BEGIN
    -- Exact match on supplier name
    RETURN QUERY
    SELECT 
        s.id,
        'exact'::VARCHAR,
        0::INTEGER
    FROM suppliers s
    WHERE s.business_id = p_business_id
    AND LOWER(s.name) = LOWER(p_name)
    LIMIT 1;
    
    -- If no exact match, try aliases
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            sna.supplier_id,
            'alias'::VARCHAR,
            0::INTEGER
        FROM supplier_name_aliases sna
        JOIN suppliers s ON s.id = sna.supplier_id
        WHERE s.business_id = p_business_id
        AND LOWER(sna.alias_name) = LOWER(p_name)
        LIMIT 1;
    END IF;
    
    -- If still no match, try fuzzy match (Levenshtein distance)
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            s.id,
            'fuzzy'::VARCHAR,
            levenshtein(LOWER(s.name), LOWER(p_name))::INTEGER as distance
        FROM suppliers s
        WHERE s.business_id = p_business_id
        AND levenshtein(LOWER(s.name), LOWER(p_name)) <= p_threshold
        ORDER BY distance
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_supplier_by_name IS 'Find supplier by name with exact, alias, and fuzzy matching';
