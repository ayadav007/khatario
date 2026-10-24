-- 383: Khatario Staff app — check-in from a staff phone that is bound to one employee.
-- Office sites (several per business, each with its own radius and trusted Wi-Fi),
-- one-time pairing codes shown by the owner, device keys kept in the phone's keystore,
-- single-use check-in challenges, and every punch with the signals and the server's verdict.
-- Read through lib/hr/staff-app/*.

CREATE TABLE IF NOT EXISTS attendance_sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    lat DECIMAL(10,8) NOT NULL,
    lng DECIMAL(11,8) NOT NULL,
    radius_m INTEGER NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 20 AND 5000),
    -- When true, a check-in must also see one of this site's Wi-Fi networks.
    require_wifi BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_sites_business ON attendance_sites (business_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS attendance_site_wifi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES attendance_sites(id) ON DELETE CASCADE,
    bssid VARCHAR(17) NOT NULL, -- lower-case aa:bb:cc:dd:ee:ff
    ssid VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (site_id, bssid)
);

-- No rows for an employee = they may check in at any active site of the business.
CREATE TABLE IF NOT EXISTS employee_attendance_sites (
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES attendance_sites(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id, site_id)
);

CREATE TABLE IF NOT EXISTS staff_app_pairing_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL UNIQUE, -- sha256 hex; the code itself is never stored
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_app_pairing_employee ON staff_app_pairing_codes (employee_id) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_app_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL, -- base64 DER SubjectPublicKeyInfo, EC P-256
    hardware_backed BOOLEAN NOT NULL DEFAULT false,
    device_model VARCHAR(120),
    os_version VARCHAR(40),
    app_version VARCHAR(40),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP,
    revoked_at TIMESTAMP,
    revoked_reason VARCHAR(40)
);
-- One linked phone per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_app_devices_active_employee
    ON staff_app_devices (employee_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_app_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES staff_app_devices(id) ON DELETE CASCADE,
    nonce VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_app_challenges_device ON staff_app_challenges (device_id, created_at);

CREATE TABLE IF NOT EXISTS staff_attendance_punches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    device_id UUID REFERENCES staff_app_devices(id) ON DELETE SET NULL,
    attendance_id UUID REFERENCES employee_attendance(id) ON DELETE SET NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('check_in', 'check_out')),
    decision VARCHAR(10) NOT NULL CHECK (decision IN ('accepted', 'review', 'rejected')),
    risk_score INTEGER NOT NULL DEFAULT 0,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    site_id UUID REFERENCES attendance_sites(id) ON DELETE SET NULL,
    distance_m INTEGER,
    lat DECIMAL(10,8),
    lng DECIMAL(11,8),
    accuracy_m DECIMAL(8,2),
    wifi_matched BOOLEAN NOT NULL DEFAULT false,
    samples JSONB,
    wifi JSONB,
    signals JSONB,
    ip_address VARCHAR(64),
    review_decision VARCHAR(10) CHECK (review_decision IN ('approved', 'rejected')),
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_punches_review
    ON staff_attendance_punches (business_id, created_at DESC)
    WHERE decision = 'review' AND review_decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_punches_employee ON staff_attendance_punches (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_punches_site_wifi
    ON staff_attendance_punches (site_id, created_at DESC) WHERE decision = 'accepted';
