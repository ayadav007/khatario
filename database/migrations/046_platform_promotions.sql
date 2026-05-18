-- Migration: Platform Promotional Messaging System
-- Creates tables for managing in-app promotions and tracking business interactions

-- 1. Platform Promotions Table
CREATE TABLE IF NOT EXISTS platform_promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    message_type VARCHAR(50) NOT NULL, -- 'banner', 'carousel', 'modal', 'sidebar'
    image_url TEXT, -- Primarily for carousel and modal
    button_text VARCHAR(100),
    button_url TEXT,
    button_action VARCHAR(50) DEFAULT 'link', -- 'link', 'upgrade_modal', 'route'
    
    -- Display Settings
    display_position INTEGER DEFAULT 0, -- For ordering (especially carousel)
    priority INTEGER DEFAULT 0, -- Higher = more important
    is_active BOOLEAN DEFAULT true,
    
    -- Targeting
    target_audience VARCHAR(50) DEFAULT 'all', -- 'all', 'free', 'professional', 'business', 'enterprise'
    target_plan_ids UUID[] DEFAULT ARRAY[]::UUID[], -- Specific plans if target_audience is not enough
    exclude_business_ids UUID[] DEFAULT ARRAY[]::UUID[], -- Specific businesses to exclude
    
    -- Scheduling
    start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP WITH TIME ZONE, -- NULL means no end date
    
    -- Styling
    background_color VARCHAR(7) DEFAULT '#3b82f6', -- Default blue-500
    text_color VARCHAR(7) DEFAULT '#ffffff',
    
    -- Behavior
    dismissible BOOLEAN DEFAULT true,
    show_once_per_business BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL
);

-- 2. Promotion Views / Interactions Tracking
CREATE TABLE IF NOT EXISTS promotion_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    promotion_id UUID NOT NULL REFERENCES platform_promotions(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    dismissed_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(promotion_id, business_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON platform_promotions(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_type ON platform_promotions(message_type);
CREATE INDEX IF NOT EXISTS idx_promotion_views_business ON promotion_views(business_id);
CREATE INDEX IF NOT EXISTS idx_promotion_views_promo ON promotion_views(promotion_id);

-- Update trigger for platform_promotions
DROP TRIGGER IF EXISTS update_platform_promotions_updated_at ON platform_promotions;
CREATE TRIGGER update_platform_promotions_updated_at 
    BEFORE UPDATE ON platform_promotions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comment for table purpose
COMMENT ON TABLE platform_promotions IS 'Stores in-app promotional messages for businesses';
COMMENT ON TABLE promotion_views IS 'Tracks business interactions (views, clicks, dismissals) with promotions';

