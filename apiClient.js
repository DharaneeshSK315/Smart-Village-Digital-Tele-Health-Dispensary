const API_BASE = "/api";

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = sessionStorage.getItem("telehealth_access_token");
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  login: credentials => request("/auth/login", { method: "POST", body: JSON.stringify(credentials) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  state: () => request("/state"),
  saveState: state => request("/state", { method: "PUT", body: JSON.stringify(state) }),
  completeConsultation: consultation => request("/consultations", { method: "POST", body: JSON.stringify(consultation) }),
  deletePatient: id => request(`/patients/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteDoctor: id => request(`/doctors/${encodeURIComponent(id)}`, { method: "DELETE" })
};
