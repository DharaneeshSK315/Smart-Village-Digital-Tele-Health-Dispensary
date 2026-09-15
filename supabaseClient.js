const storage = (() => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (error) {
    console.warn('localStorage unavailable, using in-memory fallback.', error);
  }

  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear()
  };
})();

function readDb() {
  try {
    const raw = storage.getItem('telehealth_db');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Unable to parse telehealth_db from storage. Resetting.', error);
    storage.removeItem('telehealth_db');
    return {};
  }
}

function saveDb(db) {
  storage.setItem('telehealth_db', JSON.stringify(db));
}

function tableRows(tableName) {
  const db = readDb();
  const table = db[tableName] || [];
  return Array.isArray(table) ? table : [];
}

function persistRows(tableName, rows) {
  const db = readDb();
  db[tableName] = rows;
  saveDb(db);
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

function buildResult(data, error = null) {
  const result = { data, error };
  result.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return result;
}

function getRowIdentity(row) {
  if (!row || typeof row !== 'object') return null;
  return row.id ?? row.token ?? row.email ?? row.name ?? row.patientId ?? row.doctorId ?? null;
}

function resolveUserFromEmail(email) {
  const db = readDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const adminList = Array.isArray(db.authConfig?.admins) ? db.authConfig.admins.map((item) => String(item).trim().toLowerCase()) : [];
  const vhwList = Array.isArray(db.authConfig?.vhws) ? db.authConfig.vhws.map((item) => String(item).trim().toLowerCase()) : [];
  const doctors = Array.isArray(db.doctors) ? db.doctors : [];
  const patients = Array.isArray(db.patients) ? db.patients : [];

  if (adminList.includes(normalizedEmail)) {
    return {
      id: `admin-${normalizedEmail.replace(/[^a-z0-9]/g, '')}`,
      email: normalizedEmail,
      user_metadata: { full_name: 'System Admin' }
    };
  }

  if (vhwList.includes(normalizedEmail)) {
    return {
      id: `vhw-${normalizedEmail.replace(/[^a-z0-9]/g, '')}`,
      email: normalizedEmail,
      user_metadata: { full_name: 'Nurse Anjali' }
    };
  }

  const doctor = doctors.find((entry) => String(entry.email || '').trim().toLowerCase() === normalizedEmail);
  if (doctor) {
    return {
      id: doctor.id || `doc-${normalizedEmail.replace(/[^a-z0-9]/g, '')}`,
      email: doctor.email || normalizedEmail,
      user_metadata: { full_name: doctor.name || 'Doctor User' }
    };
  }

  const patient = patients.find((entry) => {
    const emailMatch = String(entry.email || '').trim().toLowerCase() === normalizedEmail;
    const phoneMatch = String(entry.phone || '').trim() === normalizedEmail;
    const nameMatch = String(entry.name || '').trim().toLowerCase() === normalizedEmail;
    return emailMatch || phoneMatch || nameMatch;
  });

  if (patient) {
    return {
      id: patient.id || `pat-${normalizedEmail.replace(/[^a-z0-9]/g, '')}`,
      email: patient.email || normalizedEmail,
      user_metadata: { full_name: patient.name || 'Patient User' }
    };
  }

  return null;
}

function createLocalQuery(tableName) {
  const table = String(tableName || '').trim();

  return {
    select: (columns = '*') => {
      const rows = tableRows(table);
      return buildResult(rows, null);
    },
    upsert: (rows) => {
      const existing = tableRows(table);
      const incoming = normalizeRows(rows);
      const merged = [...existing];

      incoming.forEach((row) => {
        const key = getRowIdentity(row);
        if (key === null || key === undefined || key === '') {
          merged.push(row);
          return;
        }

        const index = merged.findIndex((entry) => getRowIdentity(entry) === key);
        if (index >= 0) {
          merged[index] = { ...merged[index], ...row };
        } else {
          merged.push(row);
        }
      });

      persistRows(table, merged);
      return buildResult(merged, null);
    },
    delete: () => ({
      eq: (field, value) => {
        const existing = tableRows(table).filter((row) => row[field] !== value);
        persistRows(table, existing);
        return buildResult(existing, null);
      }
    })
  };
}

export const supabase = {
  from: (tableName) => createLocalQuery(tableName),
  channel: () => ({
    on: () => this,
    subscribe: () => true
  }),
  auth: {
    currentUser: null,
    onAuthStateChange: (callback) => {
      if (typeof callback === 'function') {
        callback('INITIAL_SESSION', supabase.auth.currentUser);
      }
      return { data: { subscription: null } };
    },
    signInWithPassword: async ({ email, password }) => {
      const user = resolveUserFromEmail(email);
      if (!user) {
        return { data: { user: null }, error: { message: 'Invalid credentials' } };
      }

      supabase.auth.currentUser = user;
      return { data: { user }, error: null };
    },
    signUp: async ({ email, password, options = {} }) => {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return { data: { user: null }, error: { message: 'Email is required' } };
      }

      const user = {
        id: `user-${Date.now()}`,
        email: normalizedEmail,
        user_metadata: { full_name: options?.data?.full_name || normalizedEmail.split('@')[0] }
      };

      supabase.auth.currentUser = user;
      return { data: { user }, error: null };
    },
    signOut: async () => {
      supabase.auth.currentUser = null;
      return { data: { user: null }, error: null };
    },
    signInWithOAuth: async () => {
      return { data: { provider: 'google' }, error: null };
    }
  }
};

if (typeof window !== 'undefined') {
  window.supabase = supabase;
}

export default supabase;