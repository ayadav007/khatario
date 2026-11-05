-- Minimal identity schema as left by migrations 019, 180 and 208: only the tables and columns
-- that POST /api/businesses/switch and the membership-role correction touch.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT
);
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  role_name VARCHAR(100) NOT NULL,
  role_key VARCHAR(50) NOT NULL,
  is_system_role BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  UNIQUE (business_id, role_key)
);
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  role_id UUID REFERENCES user_roles(id) ON DELETE SET NULL,
  is_primary_admin BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  auth_session_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_businesses_user_business_unique UNIQUE (user_id, business_id)
);
