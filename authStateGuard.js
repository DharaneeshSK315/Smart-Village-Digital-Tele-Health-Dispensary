const SESSION_USER_KEY = 'vm_session_user';
const SESSION_ROLE_KEY = 'vm_session_role';

function resolveStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

export function saveSessionState(user, role, customStorage = null) {
  const storage = resolveStorage(customStorage);
  if (!storage) return false;

  try {
    if (user && role) {
      storage.setItem(SESSION_USER_KEY, JSON.stringify(user));
      storage.setItem(SESSION_ROLE_KEY, role);
      return true;
    }
  } catch (e) {
    console.warn('Failed to save session state:', e);
  }
  return false;
}

export function loadSessionState(customStorage = null) {
  const storage = resolveStorage(customStorage);
  if (!storage) return null;

  try {
    const rawUser = storage.getItem(SESSION_USER_KEY);
    const role = storage.getItem(SESSION_ROLE_KEY);
    if (rawUser && role) {
      const user = JSON.parse(rawUser);
      return { user, role };
    }
  } catch (e) {
    console.warn('Failed to load session state:', e);
    clearSessionState(storage);
  }
  return null;
}

export function clearSessionState(customStorage = null) {
  const storage = resolveStorage(customStorage);
  if (!storage) return false;

  try {
    storage.removeItem(SESSION_USER_KEY);
    storage.removeItem(SESSION_ROLE_KEY);
    return true;
  } catch (e) {
    console.warn('Failed to clear session state:', e);
  }
  return false;
}

export function shouldAutoRestoreSession({ isSigningOut, event, session, currentRole = 'guest', hasOAuthCallback = false }) {
  if (isSigningOut) return false;
  if (!session || !session.user) return false;
  const allowedEvents = ['SIGNED_IN', 'INITIAL_SESSION'];
  if (!allowedEvents.includes(event)) return false;

  // Tab Isolation Guard:
  // If this tab already has an active authenticated role and is NOT handling an explicit OAuth redirect callback,
  // do NOT allow background or cross-tab auth state events to overwrite or switch this tab's role.
  if (currentRole && currentRole !== 'guest' && currentRole !== 'login' && !hasOAuthCallback) {
    return false;
  }

  return true;
}

export function findActivePatientAppointment(appointments, patientId, token = null) {
  if (!Array.isArray(appointments) || !patientId) return null;

  const byPatient = appointments.filter((appointment) => appointment
    && appointment.patientId === patientId
    && appointment.status !== 'Completed');
  if (!byPatient.length) {
    if (!token) return null;
    return appointments.find((appointment) => appointment
      && appointment.token === token
      && appointment.patientId === patientId
      && appointment.status !== 'Completed') || null;
  }

  const active = byPatient.find((appointment) => appointment.status === 'Active')
    || byPatient.find((appointment) => appointment.status === 'Waiting')
    || byPatient[0];

  if (token && active && active.token !== token) {
    const exact = appointments.find((appointment) => appointment
      && appointment.token === token
      && appointment.patientId === patientId
      && appointment.status !== 'Completed') || null;
    return exact || active;
  }

  return active || null;
}
