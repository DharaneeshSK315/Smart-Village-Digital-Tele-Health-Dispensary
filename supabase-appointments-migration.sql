-- ============================================================================
-- SMART VILLAGE TELE-HEALTH DISPENSARY: SMART QUEUE & APPOINTMENT MIGRATION
-- ============================================================================

-- 1. Extend appointments table with slot scheduling metadata
ALTER TABLE IF EXISTS appointments
  ADD COLUMN IF NOT EXISTS slot_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scheduled_date VARCHAR(20),
  ADD COLUMN IF NOT EXISTS scheduled_start_time VARCHAR(20),
  ADD COLUMN IF NOT EXISTS scheduled_end_time VARCHAR(20),
  ADD COLUMN IF NOT EXISTS slot_duration_mins INT DEFAULT 15,
  ADD COLUMN IF NOT EXISTS booking_time TIMESTAMPTZ DEFAULT NOW();

-- 2. Update status constraint for all 7 lifecycle states
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check') THEN
    ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
  END IF;
END $$;

ALTER TABLE IF EXISTS appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'Queued',
    'Awaiting Selection',
    'Confirmed',
    'In Progress',
    'Active',
    'Waiting',
    'Completed',
    'Cancelled',
    'Rescheduled'
  ));

-- 3. Create Doctor Schedules table
CREATE TABLE IF NOT EXISTS doctor_schedules (
  doctor_id VARCHAR(50) PRIMARY KEY,
  work_start VARCHAR(10) DEFAULT '09:00',
  work_end VARCHAR(10) DEFAULT '17:00',
  slot_duration_mins INT DEFAULT 15,
  work_days JSONB DEFAULT '[1,2,3,4,5,6]'::jsonb,
  breaks JSONB DEFAULT '[{"start":"13:00","end":"14:00"}]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default schedules for demo doctors
INSERT INTO doctor_schedules (doctor_id, work_start, work_end, slot_duration_mins, work_days, breaks)
VALUES
  ('doc-1', '09:00', '17:00', 15, '[1,2,3,4,5,6]'::jsonb, '[{"start":"13:00","end":"14:00"}]'::jsonb),
  ('doc-2', '09:00', '17:00', 15, '[1,2,3,4,5,6]'::jsonb, '[{"start":"13:00","end":"14:00"}]'::jsonb),
  ('doc-3', '09:00', '17:00', 15, '[1,2,3,4,5,6]'::jsonb, '[{"start":"13:00","end":"14:00"}]'::jsonb)
ON CONFLICT (doctor_id) DO NOTHING;

-- 4. Create Booked Slots table with UNIQUE constraint preventing double-booking
CREATE TABLE IF NOT EXISTS booked_slots (
  slot_id VARCHAR(100) PRIMARY KEY,
  doctor_id VARCHAR(50) NOT NULL,
  date VARCHAR(20) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  token VARCHAR(50) NOT NULL,
  patient_id VARCHAR(50) NOT NULL,
  patient_name VARCHAR(100),
  status VARCHAR(30) DEFAULT 'booked',
  booked_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_doctor_slot UNIQUE (doctor_id, date, start_time)
);

-- Index for high-performance slot querying
CREATE INDEX IF NOT EXISTS idx_booked_slots_lookup ON booked_slots(doctor_id, date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_status ON appointments(patient_id, status);
