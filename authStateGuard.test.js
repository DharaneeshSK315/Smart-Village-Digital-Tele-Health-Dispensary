import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoRestoreSession, findActivePatientAppointment } from './authStateGuard.js';

test('ignores auth restore during sign-out', () => {
  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: true, event: 'SIGNED_IN', session: { user: { email: 'doc.vikram@villagemed.in' } } }),
    false
  );
});

test('restores session only for valid signed-in events', () => {
  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: false, event: 'INITIAL_SESSION', session: { user: { email: 'doc.vikram@villagemed.in' } } }),
    true
  );

  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: false, event: 'SIGNED_OUT', session: null }),
    false
  );
});

test('finds the active appointment for the patient even when earlier records exist', () => {
  const appointments = [
    { token: 'VIL-A-100', patientId: 'pat-1', status: 'Completed' },
    { token: 'VIL-A-200', patientId: 'pat-2', status: 'Waiting' },
    { token: 'VIL-A-300', patientId: 'pat-1', status: 'Active' }
  ];

  assert.deepEqual(findActivePatientAppointment(appointments, 'pat-1'), {
    token: 'VIL-A-300',
    patientId: 'pat-1',
    status: 'Active'
  });
});

test('does not treat a completed appointment as active', () => {
  assert.equal(
    findActivePatientAppointment([{ token: 'VIL-A-100', patientId: 'pat-1', status: 'Completed' }], 'pat-1'),
    null
  );

  assert.equal(
    findActivePatientAppointment([{ token: 'VIL-A-100', patientId: 'pat-1', status: 'Completed' }], 'pat-1', 'VIL-A-100'),
    null
  );
});
