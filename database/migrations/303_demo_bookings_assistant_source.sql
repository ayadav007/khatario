-- Demo bookings made from the AI assistant widget are tagged lead_source = 'assistant'.
ALTER TABLE demo_bookings DROP CONSTRAINT IF EXISTS demo_bookings_lead_source_check;
ALTER TABLE demo_bookings
    ADD CONSTRAINT demo_bookings_lead_source_check
    CHECK (lead_source IN ('organic', 'google_ads', 'referral', 'social_media', 'direct', 'other', 'assistant'));
