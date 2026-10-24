-- Optional topic chosen from the merchant's contact-form dropdown.
ALTER TABLE store_enquiries ADD COLUMN IF NOT EXISTS topic VARCHAR(40);
