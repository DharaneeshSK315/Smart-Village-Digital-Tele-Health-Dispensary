-- Run this migration in the Supabase SQL editor before deploying the app.
alter table public.consultations
  add column if not exists "patientId" text,
  add column if not exists "doctorId" text,
  add column if not exists token text,
  add column if not exists status text,
  add column if not exists advice text,
  add column if not exists "completedAt" timestamptz;

create index if not exists consultations_patient_id_idx
  on public.consultations ("patientId");

create index if not exists consultations_doctor_id_idx
  on public.consultations ("doctorId");