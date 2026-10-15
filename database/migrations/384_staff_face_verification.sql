-- 384: Face check for the Khatario Staff app.
-- A manager opens an enrollment, the employee agrees to the consent text on their linked phone and
-- takes 3–5 angles, and the manager approves what was captured. Only face templates (numbers made by
-- the SFace model) are kept after that; photos live here only until a manager has looked at them.
-- Every check-in is matched one-to-one against that employee's own templates.
-- Read through lib/hr/staff-app/face/*.

CREATE TABLE IF NOT EXISTS employee_face_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- open: waiting for the phone; captured: waiting for the manager; active: in use;
    -- replaced / rejected / cancelled / expired / deleted: kept as a record without templates or photos.
    status VARCHAR(12) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'captured', 'active', 'replaced', 'rejected', 'cancelled', 'expired', 'deleted')),
    opened_by UUID NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    device_id UUID REFERENCES staff_app_devices(id) ON DELETE SET NULL,
    consent_version VARCHAR(20),
    consent_at TIMESTAMP,
    captured_at TIMESTAMP,
    -- Per angle detector score and the lowest similarity between angles, for the manager.
    quality JSONB,
    decided_by UUID,
    decided_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- At most one enrollment in progress and one in use per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_enrollment_pending
    ON employee_face_enrollments (employee_id) WHERE status IN ('open', 'captured');
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_enrollment_active
    ON employee_face_enrollments (employee_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS employee_face_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES employee_face_enrollments(id) ON DELETE CASCADE,
    angle VARCHAR(10) NOT NULL CHECK (angle IN ('front', 'left', 'right', 'up', 'down')),
    model VARCHAR(40) NOT NULL,
    embedding REAL[] NOT NULL CHECK (array_length(embedding, 1) = 128),
    detector_score REAL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, angle)
);
CREATE INDEX IF NOT EXISTS idx_face_templates_employee ON employee_face_templates (employee_id);

-- Short-lived photos a manager must see: enrollment angles before approval, and check-ins sent
-- to review because of the face. Deleted when the manager decides, or by expires_at.
CREATE TABLE IF NOT EXISTS staff_face_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    enrollment_id UUID REFERENCES employee_face_enrollments(id) ON DELETE CASCADE,
    punch_id UUID REFERENCES staff_attendance_punches(id) ON DELETE CASCADE,
    label VARCHAR(16) NOT NULL,
    jpeg BYTEA NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((enrollment_id IS NULL) <> (punch_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_face_photos_enrollment ON staff_face_photos (enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_face_photos_punch ON staff_face_photos (punch_id) WHERE punch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_face_photos_expiry ON staff_face_photos (expires_at);

-- The liveness steps the server asked for with this challenge (null = no face check).
ALTER TABLE staff_app_challenges ADD COLUMN IF NOT EXISTS liveness JSONB;

ALTER TABLE staff_attendance_punches ADD COLUMN IF NOT EXISTS face_similarity REAL;
ALTER TABLE staff_attendance_punches ADD COLUMN IF NOT EXISTS liveness_passed BOOLEAN;
-- sha256 of each photo sent, so the same photo cannot be sent twice.
ALTER TABLE staff_attendance_punches ADD COLUMN IF NOT EXISTS face_photo_hashes TEXT[];
CREATE INDEX IF NOT EXISTS idx_staff_punches_photo_hashes
    ON staff_attendance_punches USING GIN (face_photo_hashes) WHERE face_photo_hashes IS NOT NULL;

-- An employee who leaves keeps no face data, whichever screen or script deactivated them.
CREATE OR REPLACE FUNCTION staff_face_purge_inactive_employee() RETURNS trigger AS $$
BEGIN
    IF NEW.is_active = false AND COALESCE(OLD.is_active, true) = true THEN
        DELETE FROM staff_face_photos WHERE employee_id = NEW.id;
        DELETE FROM employee_face_templates WHERE employee_id = NEW.id;
        UPDATE employee_face_enrollments
           SET status = 'deleted',
               quality = NULL, decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP)
         WHERE employee_id = NEW.id AND status IN ('open', 'captured', 'active');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_face_purge_inactive ON employees;
CREATE TRIGGER trg_staff_face_purge_inactive
    AFTER UPDATE OF is_active ON employees
    FOR EACH ROW EXECUTE FUNCTION staff_face_purge_inactive_employee();
