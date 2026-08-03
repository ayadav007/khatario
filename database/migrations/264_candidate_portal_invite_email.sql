-- Candidate portal invite email template (subject/body sections) per business
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS candidate_portal_invite_email JSONB;

COMMENT ON COLUMN business_settings.candidate_portal_invite_email IS
  'Recruitment: customizable invite email (subject, intro, footer, toggles for task table and login steps)';
