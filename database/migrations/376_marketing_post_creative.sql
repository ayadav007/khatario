-- How each marketing draft was written and which image layout it uses.
-- Daily drafts stay in status "draft" until an admin approves them.

ALTER TABLE marketing_posts
  ADD COLUMN IF NOT EXISTS image_style VARCHAR(20) NOT NULL DEFAULT 'square',
  ADD COLUMN IF NOT EXISTS writer VARCHAR(20) NOT NULL DEFAULT 'brief';

ALTER TABLE marketing_posts DROP CONSTRAINT IF EXISTS marketing_posts_image_style_chk;
ALTER TABLE marketing_posts
  ADD CONSTRAINT marketing_posts_image_style_chk CHECK (image_style IN ('square', 'poster'));

ALTER TABLE marketing_posts DROP CONSTRAINT IF EXISTS marketing_posts_writer_chk;
ALTER TABLE marketing_posts
  ADD CONSTRAINT marketing_posts_writer_chk CHECK (writer IN ('cloudflare', 'groq', 'brief'));

COMMENT ON COLUMN marketing_posts.image_style IS 'square photo with overlay, or taller poster whose headline is painted by the image model';
COMMENT ON COLUMN marketing_posts.writer IS 'cloudflare text model, else groq, else the standing brief';
