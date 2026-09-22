-- Run this migration in the Supabase SQL editor to ensure all consultations table columns exist.
alter table public.consultations
  add column if not exists "patientId" text,
  add column if not exists "doctorId" text,
  add column if not exists token text,
  add column if not exists status text,
  add column if not exists date text,
  add column if not exists advice text,
  add column if not exists diagnosis text,
  add column if not exists "patientName" text,
  add column if not exists "doctorName" text,
  add column if not exists village text,
  add column if not exists medicines text,
  add column if not exists "failoverState" text,
  add column if not exists referral boolean,
  add column if not exists "completedAt" timestamptz;

create index if not exists consultations_patient_id_idx
  on public.consultations ("patientId");

create index if not exists consultations_doctor_id_idx
  on public.consultations ("doctorId");