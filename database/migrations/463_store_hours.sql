-- Store opening hours, India time: {"mon": {"open": "07:00", "close": "22:00"}, "sun": null, ...}; null = not set (lib/store/store-hours.ts).
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_hours JSONB;
