import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldAutoRestoreSession,
  findActivePatientAppointment,
  saveSessionState,
  loadSessionState,
  clearSessionState
} from './authStateGuard.js';

function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

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

test('persists and retrieves session state within a tab storage container', () => {
  const tabStorage = createMockStorage();
  const patientUser = { id: 'pat-1', name: 'Sarah Mitchell', role: 'patient' };

  assert.equal(saveSessionState(patientUser, 'patient', tabStorage), true);

  const restored = loadSessionState(tabStorage);
  assert.deepEqual(restored, {
    user: patientUser,
    role: 'patient'
  });

  assert.equal(clearSessionState(tabStorage), true);
  assert.equal(loadSessionState(tabStorage), null);
});

test('isolates authentication between multiple browser tabs independently', () => {
  const tab1Storage = createMockStorage(); // Tab 1: Patient
  const tab2Storage = createMockStorage(); // Tab 2: Doctor

  const patient = { id: 'pat-1', name: 'Sarah Mitchell' };
  const doctor = { id: 'doc-1', name: 'Dr. Vikram', specialty: 'General Medicine' };

  // Step 1: Sign in as Patient in Tab 1
  saveSessionState(patient, 'patient', tab1Storage);
  assert.equal(loadSessionState(tab1Storage).role, 'patient');
  assert.equal(loadSessionState(tab2Storage), null);

  // Step 2: Sign in as Doctor in Tab 2
  saveSessionState(doctor, 'doctor', tab2Storage);
  assert.equal(loadSessionState(tab2Storage).role, 'doctor');

  // Step 3: Verify Tab 1 STILL retains its Patient session and is not altered by Tab 2
  const tab1After = loadSessionState(tab1Storage);
  assert.equal(tab1After.role, 'patient');
  assert.equal(tab1After.user.name, 'Sarah Mitchell');

  // Step 4: Signing out of Tab 2 leaves Tab 1 completely unaffected
  clearSessionState(tab2Storage);
  assert.equal(loadSessionState(tab2Storage), null);
  assert.equal(loadSessionState(tab1Storage).role, 'patient');
});
