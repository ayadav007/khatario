-- Migration: Demo Booking CRM System
-- Creates tables for demo bookings, time slots, and activity tracking

-- 1. Booking Time Slots (Admin configurable)
CREATE TABLE IF NOT EXISTS booking_time_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 6=Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    max_bookings_per_slot INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Demo Bookings
CREATE TABLE IF NOT EXISTS demo_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., DEMO-001
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    message TEXT,
    
    -- Booking details
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    time_slot_id UUID REFERENCES booking_time_slots(id) ON DELETE SET NULL,
    
    -- CRM fields
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'converted', 'lost')),
    lead_source VARCHAR(50) DEFAULT 'organic' CHECK (lead_source IN ('organic', 'google_ads', 'referral', 'social_media', 'direct', 'other')),
    demo_type VARCHAR(50) DEFAULT 'product_walkthrough' CHECK (demo_type IN ('product_walkthrough', 'custom_demo', 'quick_demo')),
    outcome VARCHAR(50) CHECK (outcome IN ('converted_to_paid', 'still_evaluating', 'not_interested', 'follow_up_required')),
    assigned_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    
    -- Notes and follow-up
    internal_notes TEXT,
    next_follow_up_date TIMESTAMP WITH TIME ZONE,
    
    -- Conversion tracking
    converted_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    
    -- Metadata
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Booking Activities (CRM Timeline)
CREATE TABLE IF NOT EXISTS booking_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES demo_bookings(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN ('status_change', 'note_added', 'call_logged', 'email_sent', 'whatsapp_sent', 'follow_up_set')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    performed_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}', -- Store additional data (WhatsApp message ID, call duration, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_booking_time_slots_day ON booking_time_slots(day_of_week, is_active);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_status ON demo_bookings(status);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_scheduled_date ON demo_bookings(scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_assigned_admin ON demo_bookings(assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_email ON demo_bookings(email);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_phone ON demo_bookings(phone);
CREATE INDEX IF NOT EXISTS idx_booking_activities_booking_id ON booking_activities(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_activities_created_at ON booking_activities(created_at DESC);

-- Update triggers
DROP TRIGGER IF EXISTS update_booking_time_slots_updated_at ON booking_time_slots;
CREATE TRIGGER update_booking_time_slots_updated_at 
    BEFORE UPDATE ON booking_time_slots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_demo_bookings_updated_at ON demo_bookings;
CREATE TRIGGER update_demo_bookings_updated_at 
    BEFORE UPDATE ON demo_bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sequence for booking numbers
CREATE SEQUENCE IF NOT EXISTS demo_booking_number_seq START 1;

-- Function to generate booking number
CREATE OR REPLACE FUNCTION generate_booking_number() RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
    booking_num TEXT;
BEGIN
    next_num := nextval('demo_booking_number_seq');
    booking_num := 'DEMO-' || LPAD(next_num::TEXT, 4, '0');
    RETURN booking_num;
END;
$$ LANGUAGE plpgsql;

-- Add phone number to platform_admins if it doesn't exist (for WhatsApp notifications)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'platform_admins' AND column_name = 'phone'
    ) THEN
        ALTER TABLE platform_admins ADD COLUMN phone VARCHAR(20);
    END IF;
END $$;

-- Comments
COMMENT ON TABLE demo_bookings IS 'Stores demo booking requests from visitors';
COMMENT ON TABLE booking_time_slots IS 'Admin-configurable available time slots for demo bookings';
COMMENT ON TABLE booking_activities IS 'CRM activity timeline for each booking (notes, calls, messages, status changes)';

