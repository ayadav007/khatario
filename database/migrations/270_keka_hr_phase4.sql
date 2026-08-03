-- Migration 270: Keka-style HR — employee mgmt, engagement, documents, exit

-- ---------------------------------------------------------------------------
-- 1. Employee management settings (probation, ID series, visibility)
-- ---------------------------------------------------------------------------
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS hr_employee_settings JSONB NOT NULL DEFAULT '{
    "probation_period_value": 3,
    "probation_period_unit": "months",
    "probation_auto_confirm": false,
    "employee_id_prefix": "EMP",
    "employee_id_padding": 3,
    "employee_id_next_number": null,
    "show_new_joiners": true,
    "show_work_anniversaries": true,
    "show_department_heads": true
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS hr_exit_settings JSONB NOT NULL DEFAULT '{
    "default_notice_period_days": 30,
    "seniority_notice_rules": [],
    "exit_reasons": ["Better opportunity", "Personal reasons", "Relocation", "Performance", "Misconduct", "Other"]
  }'::jsonb;

COMMENT ON COLUMN business_settings.hr_employee_settings IS
  'Probation, employee ID series, portal visibility toggles';
COMMENT ON COLUMN business_settings.hr_exit_settings IS
  'Exit workflow defaults: notice periods, reasons for leaving';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_end_date DATE,
  ADD COLUMN IF NOT EXISTS probation_status VARCHAR(20) DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS portal_registered_at TIMESTAMPTZ;

COMMENT ON COLUMN employees.probation_status IS
  'not_applicable | in_probation | confirmed | extended';
COMMENT ON COLUMN employees.portal_registered_at IS
  'First successful employee portal login';

-- ---------------------------------------------------------------------------
-- 2. Engagement — extend announcements, articles, polls
-- ---------------------------------------------------------------------------
ALTER TABLE hr_announcements
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audience JSONB NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS hr_engagement_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  author_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  author_name VARCHAR(255),
  allow_employee_posts BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hr_engagement_articles_business
  ON hr_engagement_articles(business_id, published_at DESC);

CREATE TABLE IF NOT EXISTS hr_engagement_polls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  attachment_url TEXT,
  audience JSONB NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  allow_multiple BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hr_engagement_poll_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES hr_engagement_polls(id) ON DELETE CASCADE,
  option_text VARCHAR(500) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hr_engagement_poll_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES hr_engagement_polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES hr_engagement_poll_options(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (poll_id, employee_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_poll_votes_poll ON hr_engagement_poll_votes(poll_id);

-- ---------------------------------------------------------------------------
-- 3. Document generation templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  document_type VARCHAR(50) NOT NULL DEFAULT 'appointment_letter',
  body_html TEXT NOT NULL DEFAULT '',
  margin_mm JSONB NOT NULL DEFAULT '{"top":20,"right":20,"bottom":20,"left":20}'::jsonb,
  show_border BOOLEAN NOT NULL DEFAULT false,
  show_logo BOOLEAN NOT NULL DEFAULT true,
  attribute_map JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hr_document_templates_business
  ON hr_document_templates(business_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS hr_document_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES hr_document_templates(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  generated_html TEXT NOT NULL,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 4. Exit process
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_exit_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  task_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_exits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  exit_type VARCHAR(20) NOT NULL DEFAULT 'resignation',
  status VARCHAR(30) NOT NULL DEFAULT 'initiated',
  reason VARCHAR(255),
  notice_period_days INTEGER,
  last_working_date DATE,
  rehire_eligible BOOLEAN,
  resignation_submitted_at DATE,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  fnf_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  fnf_amount_due DECIMAL(12,2),
  fnf_amount_recovery DECIMAL(12,2),
  fnf_settled_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT employee_exits_type_chk CHECK (exit_type IN ('resignation', 'termination')),
  CONSTRAINT employee_exits_status_chk CHECK (
    status IN ('initiated', 'pending_approval', 'approved', 'in_notice', 'completed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_exits_business ON employee_exits(business_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_exits_active
  ON employee_exits(employee_id)
  WHERE status NOT IN ('completed', 'cancelled');

CREATE TABLE IF NOT EXISTS hr_exit_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exit_id UUID NOT NULL REFERENCES employee_exits(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT hr_exit_tasks_status_chk CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_hr_exit_tasks_exit ON hr_exit_tasks(exit_id);
