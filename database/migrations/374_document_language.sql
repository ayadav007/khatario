-- Language for printed documents (invoices, challans, reports, payslips, letters).
-- The app UI stays in English. Names, notes, and GST codes are not translated.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS document_language VARCHAR(16) NOT NULL DEFAULT 'en';

ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_document_language_check;

ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_document_language_check
  CHECK (document_language IN (
    'en', 'hi', 'hinglish', 'mr', 'gu', 'ta', 'te', 'kn', 'ml', 'bn', 'pa', 'or', 'ur'
  ));

COMMENT ON COLUMN business_settings.document_language IS
  'Language of fixed headings on PDFs and printouts. en is English.';
