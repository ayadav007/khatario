-- Fix WhatsApp addon start_date to current date (or earlier)
-- This will make the addon active immediately

UPDATE whatsapp_addons
SET start_date = CURRENT_DATE,
    updated_at = CURRENT_TIMESTAMP
WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebce...'  -- Replace with your business_id
  AND addon_type = 'whatsapp_bot'
  AND start_date > CURRENT_DATE;

-- Verify the update
SELECT 
  id,
  business_id,
  addon_type,
  status,
  start_date,
  end_date,
  CASE 
    WHEN status = 'active' 
         AND (start_date IS NULL OR start_date <= CURRENT_DATE)
         AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    THEN 'ACTIVE NOW'
    ELSE 'INACTIVE'
  END as current_status
FROM whatsapp_addons
WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebce...';  -- Replace with your business_id

