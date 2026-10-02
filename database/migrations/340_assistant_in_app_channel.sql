-- Opens the in-app assistant to every plan: paid businesses use the `in_app` channel
-- (trial businesses keep `trial_app`). Only sets the key when it has never been chosen,
-- so an admin who switched it off keeps it off.

INSERT INTO assistant_settings (scope, settings)
VALUES ('platform', '{"channels": {"web": true, "signup": true, "trial_app": true, "in_app": true}}'::jsonb)
ON CONFLICT (scope) DO UPDATE
   SET settings = assistant_settings.settings
         || jsonb_build_object('channels', COALESCE(assistant_settings.settings -> 'channels', '{}'::jsonb) || '{"in_app": true}'::jsonb),
       updated_at = NOW()
 WHERE NOT (COALESCE(assistant_settings.settings -> 'channels', '{}'::jsonb) ? 'in_app');
