-- Migration 055: Attendance & Time Tracking System
-- Includes face recognition, OTP login, and attendance tracking

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    shift_name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration INTEGER DEFAULT 0, -- minutes
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, shift_name)
);

-- Employee face recognition data
CREATE TABLE IF NOT EXISTS employee_face_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    face_encoding TEXT NOT NULL, -- JSON array of face descriptor values (128-dim vector)
    face_image_url TEXT, -- Reference image for enrollment
    enrollment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(employee_id)
);

-- Employee attendance
CREATE TABLE IF NOT EXISTS employee_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_id UUID REFERENCES shifts(id),
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    break_duration INTEGER DEFAULT 0, -- minutes
    total_hours DECIMAL(5,2),
    status VARCHAR(20) DEFAULT 'present', -- 'present', 'absent', 'half_day', 'leave', 'holiday'
    check_in_method VARCHAR(20), -- 'face_recognition', 'mobile_app', 'manual', 'kiosk', 'otp'
    check_out_method VARCHAR(20),
    check_in_location_lat DECIMAL(10,8), -- GPS coordinates
    check_in_location_lng DECIMAL(11,8),
    check_out_location_lat DECIMAL(10,8),
    check_out_location_lng DECIMAL(11,8),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date)
);

-- Attendance logs (for detailed check-in/out tracking)
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES employee_attendance(id) ON DELETE CASCADE,
    log_type VARCHAR(20) NOT NULL, -- 'check_in', 'check_out', 'break_start', 'break_end'
    log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    location_lat DECIMAL(10,8), -- GPS coordinates
    location_lng DECIMAL(11,8),
    device_info TEXT,
    ip_address VARCHAR(50),
    recognition_confidence DECIMAL(5,2), -- For face recognition matches (0-1)
    method VARCHAR(20) -- 'face_recognition', 'mobile_app', 'manual', 'kiosk', 'otp'
);

-- OTP for attendance-only login
CREATE TABLE IF NOT EXISTS attendance_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance sessions (for tracking active attendance sessions)
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON employee_attendance(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON employee_attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee ON attendance_logs(employee_id, log_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_otps_phone ON attendance_otps(phone, expires_at);
CREATE INDEX IF NOT EXISTS idx_attendance_otps_employee ON attendance_otps(employee_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_token ON attendance_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_employee ON attendance_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_business ON shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_face_data_employee ON employee_face_data(employee_id);

-- Trigger to update updated_at timestamp for shifts
CREATE TRIGGER update_shifts_updated_at
    BEFORE UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate total hours
CREATE OR REPLACE FUNCTION calculate_attendance_hours(
    p_check_in TIMESTAMP,
    p_check_out TIMESTAMP,
    p_break_duration INTEGER DEFAULT 0
)
RETURNS DECIMAL(5,2) AS $$
BEGIN
    IF p_check_in IS NULL OR p_check_out IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Calculate hours: (check_out - check_in) - break_duration in minutes, converted to hours
    RETURN ROUND(
        (EXTRACT(EPOCH FROM (p_check_out - p_check_in)) / 3600.0) - (p_break_duration / 60.0),
        2
    );
END;
$$ LANGUAGE plpgsql;

-- Function to auto-calculate total_hours when attendance is updated
CREATE OR REPLACE FUNCTION update_attendance_hours()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL THEN
        NEW.total_hours = calculate_attendance_hours(
            NEW.check_in_time,
            NEW.check_out_time,
            NEW.break_duration
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_attendance_hours_trigger
    BEFORE INSERT OR UPDATE ON employee_attendance
    FOR EACH ROW
    EXECUTE FUNCTION update_attendance_hours();

COMMENT ON TABLE shifts IS 'Work shifts for employees';
COMMENT ON TABLE employee_face_data IS 'Face recognition encodings for employees';
COMMENT ON TABLE employee_attendance IS 'Daily attendance records for employees';
COMMENT ON TABLE attendance_logs IS 'Detailed logs of check-in/out events';
COMMENT ON TABLE attendance_otps IS 'OTP codes for attendance-only employee login';
COMMENT ON TABLE attendance_sessions IS 'Active attendance sessions for OTP-based login';

