-- Turns on the assistant for messages to Khatario's own WhatsApp number (prospects, and how-to
-- help for registered users). Only sets the key when it has never been chosen, so an admin who
-- switched it off keeps it off.

INSERT INTO assistant_settings (scope, settings)
VALUES ('platform', '{"channels": {"web": true, "signup": true, "trial_app": true, "in_app": true, "whatsapp": true}}'::jsonb)
ON CONFLICT (scope) DO UPDATE
   SET settings = assistant_settings.settings
         || jsonb_build_object('channels', COALESCE(assistant_settings.settings -> 'channels', '{}'::jsonb) || '{"whatsapp": true}'::jsonb),
       updated_at = NOW()
 WHERE NOT (COALESCE(assistant_settings.settings -> 'channels', '{}'::jsonb) ? 'whatsapp');
