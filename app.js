// Smart Village Tele-Health Dispensary Dashboard Controller

// --- MOCK DATABASE CONFIGURATION ---
const DEFAULT_VILLAGES = ["Village Clinic A", "Village Clinic B", "Village Clinic C"];

const DEFAULT_DOCTORS = [
  { id: "doc-1", name: "Dr. Vikram", specialty: "General Medicine", email: "doc.vikram@villagemed.in", password: "password", online: true },
  { id: "doc-2", name: "Dr. Dharani", specialty: "Cardiology", email: "doc.dharani@villagemed.in", password: "password", online: true },
  { id: "doc-3", name: "Dr. Naveen", specialty: "Neurology", email: "doc.naveen@villagemed.in", password: "password", online: true }
];

const DEFAULT_PATIENTS = [
  { id: "pat-1", name: "Sarah Mitchell", age: 67, gender: "Female", phone: "9876543210", village: "Village Clinic A", history: [
    { date: "2026-05-12", clinic: "Cardiology", diagnosis: "Mild Hypertension", medicines: "Metoprolol 50mg (1-0-1)", doctor: "Dr. Dharani" }
  ]},
  { id: "pat-2", name: "Fatima Al-Hassan", age: 61, gender: "Female", phone: "9845612307", village: "Village Clinic B", history: [
    { date: "2026-04-30", clinic: "General Medicine", diagnosis: "Type 2 Diabetes Checkup", medicines: "Metformin 500mg (1-0-0)", doctor: "Dr. Vikram" }
  ]},
  { id: "pat-3", name: "James Rodriguez", age: 45, gender: "Male", phone: "8123456789", village: "Village Clinic A", history: [] },
  { id: "pat-4", name: "Robert Okafor", age: 78, gender: "Male", phone: "9012345678", village: "Village Clinic C", history: [] }
];

const DEFAULT_APPOINTMENTS = [
  {
    token: "VIL-A-101",
    patientId: "pat-1",
    symptoms: "Chest pressure, shortness of breath",
    urgency: "Severe",
    specialty: "Cardiology",
    assignedDoctorId: "doc-2",
    status: "Waiting",
    vitals: { bpSystolic: 155, bpDiastolic: 95, sugar: 140, temp: 37.2, spo2: 89, hr: 110, pain: 8, photo: null }
  },
  {
    token: "VIL-B-102",
    patientId: "pat-2",
    symptoms: "Extreme fatigue, hyperglycemic symptoms",
    urgency: "Moderate",
    specialty: "General Medicine",
    assignedDoctorId: "doc-1",
    status: "Waiting",
    vitals: { bpSystolic: 130, bpDiastolic: 85, sugar: 280, temp: 36.8, spo2: 96, hr: 90, pain: 4, photo: null }
  }
];

const DEFAULT_CONSULTATIONS = [
  { id: "con-1", date: "2026-06-28", patientName: "Sarah Mitchell", village: "Village Clinic A", doctorName: "Dr. Dharani", diagnosis: "Hypertensive episode due to salt intake", medicines: "Metoprolol 50mg (1-0-1), Paracetamol 500mg (1-0-1)", failoverState: "Low Quality Video", referral: false },
  { id: "con-2", date: "2026-06-29", patientName: "Robert Okafor", village: "Village Clinic C", doctorName: "Dr. Naveen", diagnosis: "Chronic migraine management", medicines: "Paracetamol 500mg (1-1-1)", failoverState: "Audio Call + Chat", referral: false },
  { id: "con-3", date: "2026-06-30", patientName: "James Rodriguez", village: "Village Clinic A", doctorName: "Dr. Vikram", diagnosis: "Common seasonal fever", medicines: "Paracetamol 500mg (1-0-1), Cough Syrup 10ml (1-1-1)", failoverState: "HD Video", referral: false }
];

const DEFAULT_FAILOVER_LOGS = {
  hd: 15,
  low: 28,
  audio: 8
};

// State Variables
let db = {};
let currentUser = null;
let currentRole = "guest";
let activeCall = null; // { token, patient, doctor, networkQuality, autoFluctuate, chat: [], files: [], animationId: null }
let activeCallPrescriptionMeds = [];

// Agora WebRTC State
let agoraConfig = { enabled: false, appid: "", token: "", channel: "telehealth-room" };
let agoraClient = null;
let localAudioTrack = null;
let localVideoTrack = null;

// Initialize Database
function initDB() {
  if (!localStorage.getItem("telehealth_db")) {
    db = {
      villages: DEFAULT_VILLAGES,
      doctors: DEFAULT_DOCTORS,
      patients: DEFAULT_PATIENTS,
      appointments: DEFAULT_APPOINTMENTS,
      consultations: DEFAULT_CONSULTATIONS,
      failoverLogs: DEFAULT_FAILOVER_LOGS
    };
    saveDB();
  } else {
    db = JSON.parse(localStorage.getItem("telehealth_db"));
  }

  // Load Agora Config
  agoraConfig = JSON.parse(localStorage.getItem("agora_config")) || { enabled: false, appid: "", token: "", channel: "telehealth-room" };
  
  // Populate UI inputs on load
  setTimeout(() => {
    const appidInput = document.getElementById("agora-appid");
    const tokenInput = document.getElementById("agora-token");
    const chanInput = document.getElementById("agora-channel");
    const enableCheck = document.getElementById("agora-enabled");
    
    if (appidInput) appidInput.value = agoraConfig.appid || "";
    if (tokenInput) tokenInput.value = agoraConfig.token || "";
    if (chanInput) chanInput.value = agoraConfig.channel || "telehealth-room";
    if (enableCheck) enableCheck.checked = agoraConfig.enabled || false;
  }, 500);
}

function saveDB() {
  localStorage.setItem("telehealth_db", JSON.stringify(db));
}

// Clock updates
function startClock() {
  const clockEl = document.getElementById("live-clock");
  setInterval(() => {
    const now = new Date();
    clockEl.innerText = now.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }, 1000);
}

// Toast alerts utility
function showToast(message, type = "info") {
  const container = document.getElementById("toast-bin");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// View switcher
window.switchView = function(viewId, roleName) {
  document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
  document.querySelectorAll(".dev-btn").forEach(btn => btn.classList.remove("active"));
  
  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.add("active");
  
  const devBtn = document.getElementById(`dev-btn-${roleName}`);
  if (devBtn) devBtn.classList.add("active");

  currentRole = roleName;
  updateHeaderProfile();

  // Load dashboards based on role
  if (roleName === "patient") {
    loadPatientDashboard();
  } else if (roleName === "vhw") {
    loadVhwDashboard();
  } else if (roleName === "doctor") {
    loadDoctorDashboard();
  } else if (roleName === "admin") {
    loadAdminDashboard();
  }
};

window.quickLogin = function(role) {
  if (role === "patient") {
    currentUser = db.patients[0]; // Sarah Mitchell
  } else if (role === "vhw") {
    currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A" };
  } else if (role === "doctor") {
    currentUser = db.doctors[0]; // Dr. Vikram
  } else if (role === "admin") {
    currentUser = { name: "System Admin", role: "Admin" };
  }
  switchView(`view-${role}`, role);
};

window.logout = function() {
  currentUser = null;
  currentRole = "guest";
  document.getElementById("header-user-profile").style.display = "none";
  switchView("view-login", "login");
};

function updateHeaderProfile() {
  const profileEl = document.getElementById("header-user-profile");
  if (!currentUser || currentRole === "guest") {
    profileEl.style.display = "none";
    return;
  }
  profileEl.style.display = "flex";
  document.getElementById("header-user-name").innerText = currentUser.name;
  document.getElementById("header-user-role").innerText = currentRole;
  document.getElementById("header-user-avatar").innerText = currentUser.name.split(" ").map(n => n[0]).join("");
}

// Authentication
window.handleLogin = function(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const role = document.getElementById("login-role").value;

  if (role === "doctor") {
    const doctor = db.doctors.find(d => d.email === email);
    if (doctor) {
      currentUser = doctor;
      switchView("view-doctor", "doctor");
      showToast(`Welcome back, ${doctor.name}`, "success");
    } else {
      showToast("Doctor account not found", "danger");
    }
  } else if (role === "vhw") {
    currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A" };
    switchView("view-vhw", "vhw");
    showToast("VHW Nurse Console authenticated", "success");
  } else if (role === "patient") {
    const patient = db.patients.find(p => p.phone === email || p.name.toLowerCase().includes(email.toLowerCase()));
    if (patient) {
      currentUser = patient;
      switchView("view-patient", "patient");
      showToast(`Logged in as patient: ${patient.name}`, "success");
    } else {
      // Auto-register mock patient if not exists
      const newPat = { id: `pat-${Date.now()}`, name: email, age: 30, gender: "Male", phone: "9999999999", village: "Village Clinic A", history: [] };
      db.patients.push(newPat);
      saveDB();
      currentUser = newPat;
      switchView("view-patient", "patient");
      showToast(`New patient registered: ${email}`, "success");
    }
  } else if (role === "admin") {
    currentUser = { name: "System Admin", role: "Admin" };
    switchView("view-admin", "admin");
    showToast("Admin Console authenticated", "success");
  }
};

// --- TRIAGE URGENCY EVALUATOR ---
function evaluateTriageUrgency(vitals) {
  if (!vitals) return { flag: "Normal", score: 0 };
  let score = 0;
  
  // SpO2
  if (vitals.spo2 < 90) score += 50;
  else if (vitals.spo2 < 94) score += 20;

  // Systolic BP
  if (vitals.bpSystolic > 160 || vitals.bpSystolic < 85) score += 30;
  else if (vitals.bpSystolic > 140 || vitals.bpSystolic < 95) score += 15;

  // Heart Rate
  if (vitals.hr > 120 || vitals.hr < 50) score += 15;
  else if (vitals.hr > 100 || vitals.hr < 60) score += 5;

  // Temperature
  if (vitals.temp > 39 || vitals.temp < 35.5) score += 15;
  else if (vitals.temp > 38) score += 5;

  // Pain Level
  if (vitals.pain >= 8) score += 10;
  else if (vitals.pain >= 5) score += 5;

  let flag = "Normal";
  if (score >= 40) flag = "Critical";
  else if (score >= 15) flag = "High Warning";
  
  return { flag, score };
}

// --- PATIENT DASHBOARD ---
function loadPatientDashboard() {
  if (currentRole !== "patient") return;
  
  // Active appointment check
  const activeApp = db.appointments.find(a => a.patientId === currentUser.id);
  
  const tokenVal = document.getElementById("pat-token-val");
  const tokenSub = document.getElementById("pat-token-sub");
  const waitVal = document.getElementById("pat-wait-val");
  const docVal = document.getElementById("pat-doc-val");
  const callCard = document.getElementById("pat-active-call-card");
  const cancelBtn = document.getElementById("pat-cancel-appointment-btn");

  if (activeApp) {
    tokenVal.innerText = activeApp.token;
    tokenSub.innerText = `Symptom: ${activeApp.symptoms}`;
    cancelBtn.style.display = "block";

    // Calculate queue index
    const queueIndex = db.appointments.filter(a => a.status === "Waiting").findIndex(a => a.token === activeApp.token);
    waitVal.innerText = queueIndex >= 0 ? `${(queueIndex + 1) * 12} mins` : "In Call";
    
    const doc = db.doctors.find(d => d.id === activeApp.assignedDoctorId);
    docVal.innerText = doc ? doc.name : "Assigned Clinic";

    if (activeApp.status === "Active") {
      callCard.style.display = "block";
      document.getElementById("pat-active-doc-name").innerText = doc ? doc.name : "Consultant";
    } else {
      callCard.style.display = "none";
    }
  } else {
    tokenVal.innerText = "No Token";
    tokenSub.innerText = "No active appointment";
    waitVal.innerText = "-- mins";
    docVal.innerText = "None";
    callCard.style.display = "none";
    cancelBtn.style.display = "none";
  }

  // Profile forms
  document.getElementById("pat-prof-name").value = currentUser.name;
  document.getElementById("pat-prof-age").value = `${currentUser.age} yrs / ${currentUser.gender}`;
  document.getElementById("pat-prof-phone").value = currentUser.phone || "";
  document.getElementById("pat-prof-address").value = currentUser.village || "";

  // Consultation history
  const historyTbody = document.getElementById("pat-history-tbody");
  historyTbody.innerHTML = "";
  const historical = db.consultations.filter(c => c.patientName === currentUser.name);
  
  if (historical.length === 0) {
    historyTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No past consultation reports found</td></tr>`;
  } else {
    historical.forEach(h => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${h.date}</td>
        <td>${h.doctorName}</td>
        <td><button class="btn-action" onclick="viewDigitalPrescriptionPopup('${h.id}')">View Rx</button></td>
      `;
      historyTbody.appendChild(tr);
    });
  }
}

window.bookPatientAppointment = function(e) {
  e.preventDefault();
  const symptoms = document.getElementById("pat-book-symptoms").value;
  const specialty = document.getElementById("pat-book-specialty").value;
  const urgency = document.getElementById("pat-book-urgency").value;

  const existingApp = db.appointments.find(a => a.patientId === currentUser.id);
  if (existingApp) {
    showToast("You already have an active appointment or token pending.", "warning");
    return;
  }

  // Assign doctor based on specialty
  const doc = db.doctors.find(d => d.specialty === specialty) || db.doctors[0];

  const prefix = currentUser.village.includes("A") ? "VIL-A" : currentUser.village.includes("B") ? "VIL-B" : "VIL-C";
  const num = Math.floor(100 + Math.random() * 900);
  const token = `${prefix}-${num}`;

  const newApp = {
    token,
    patientId: currentUser.id,
    symptoms,
    urgency,
    specialty,
    assignedDoctorId: doc.id,
    status: "Waiting",
    vitals: null // Patient-booked bookings need VHW to check vitals
  };

  db.appointments.push(newApp);
  saveDB();
  showToast(`Appointment booked successfully! Token: ${token}. Please visit your local health worker for vitals check-in.`, "success");
  loadPatientDashboard();
  
  document.getElementById("pat-book-symptoms").value = "";
};

window.cancelActiveAppointment = function() {
  const activeAppIndex = db.appointments.findIndex(a => a.patientId === currentUser.id);
  if (activeAppIndex >= 0) {
    db.appointments.splice(activeAppIndex, 1);
    saveDB();
    showToast("Appointment and token cancelled.", "warning");
    loadPatientDashboard();
  }
};

window.updatePatientProfile = function(e) {
  e.preventDefault();
  const phone = document.getElementById("pat-prof-phone").value.trim();
  const address = document.getElementById("pat-prof-address").value.trim();

  const idx = db.patients.findIndex(p => p.id === currentUser.id);
  if (idx >= 0) {
    db.patients[idx].phone = phone;
    db.patients[idx].village = address;
    currentUser = db.patients[idx];
    saveDB();
    showToast("Profile details updated successfully", "success");
    loadPatientDashboard();
  }
};

// --- VILLAGE HEALTH WORKER (VHW) MODULE ---
let filteredPatients = [];

function loadVhwDashboard() {
  if (currentRole !== "vhw") return;

  // VHW Stats
  document.getElementById("vhw-stat-registered").innerText = `${db.patients.length} Patients`;
  const waitSize = db.appointments.filter(a => a.status === "Waiting").length;
  document.getElementById("vhw-stat-queue").innerText = `${waitSize} Patients`;

  let alerts = 0;
  db.appointments.forEach(a => {
    if (a.vitals) {
      const triage = evaluateTriageUrgency(a.vitals);
      if (triage.flag === "Critical") alerts++;
    }
  });
  document.getElementById("vhw-stat-alerts").innerText = `${alerts} Alerts`;

  // Render villages options
  const villageSelect = document.getElementById("vhw-reg-village");
  villageSelect.innerHTML = "";
  db.villages.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.innerText = v;
    if (currentUser && currentUser.village === v) opt.selected = true;
    villageSelect.appendChild(opt);
  });

  // Render Patient Directory
  renderVhwPatientList();

  // Render queue
  renderVhwQueue();
}

function renderVhwPatientList(searchQuery = "") {
  const tbody = document.getElementById("vhw-patient-list-tbody");
  tbody.innerHTML = "";
  
  let list = db.patients;
  if (searchQuery) {
    list = db.patients.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.phone.includes(searchQuery) || 
      p.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No patients found</td></tr>`;
    return;
  }

  list.forEach(p => {
    // Check if patient already has active appointment
    const activeApp = db.appointments.find(a => a.patientId === p.id);
    let buttonHtml = "";

    if (activeApp) {
      if (activeApp.vitals === null) {
        buttonHtml = `<button class="btn-action success" onclick="openVitalsModal('${p.id}')">🩺 Record Vitals</button>`;
      } else if (activeApp.status === "Active") {
        buttonHtml = `<button class="btn-action" style="background-color:var(--primary); color:white;" onclick="joinVhwCall('${activeApp.token}')">🎥 Join Consultation</button>`;
      } else {
        buttonHtml = `<span class="badge badge-info">Token: ${activeApp.token}</span>`;
      }
    } else {
      buttonHtml = `<button class="btn-action success" onclick="openVitalsModal('${p.id}')">🎫 Dispatch Token</button>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.id}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.age} yrs / ${p.gender}</td>
      <td>${p.village}</td>
      <td>
        <div style="display:flex; gap:6px;">
          ${buttonHtml}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.vhwSearchPatients = function(val) {
  renderVhwPatientList(val.trim());
};

window.vhwRegisterPatient = function(e) {
  e.preventDefault();
  const name = document.getElementById("vhw-reg-name").value.trim();
  const age = parseInt(document.getElementById("vhw-reg-age").value);
  const gender = document.getElementById("vhw-reg-gender").value;
  const phone = document.getElementById("vhw-reg-phone").value.trim();
  const village = document.getElementById("vhw-reg-village").value;

  const id = `pat-${Math.floor(1000 + Math.random() * 9000)}`;
  const newPat = { id, name, age, gender, phone, village, history: [] };

  db.patients.push(newPat);
  saveDB();
  showToast(`Patient registered! Account ID: ${id}`, "success");
  
  document.getElementById("vhw-reg-name").value = "";
  document.getElementById("vhw-reg-age").value = "";
  document.getElementById("vhw-reg-phone").value = "";

  loadVhwDashboard();
};

window.openVitalsModal = function(patientId) {
  const p = db.patients.find(pat => pat.id === patientId);
  if (!p) return;

  document.getElementById("vitals-pat-id").value = patientId;
  document.getElementById("vitals-modal-title").innerText = `Log Vitals for ${p.name}`;
  
  // Pre-fill symptom if they booked from app
  const app = db.appointments.find(a => a.patientId === patientId);
  document.getElementById("vitals-symptoms").value = app ? app.symptoms : "";

  document.getElementById("vitals-bp-systolic").value = "";
  document.getElementById("vitals-bp-diastolic").value = "";
  document.getElementById("vitals-sugar").value = "";
  document.getElementById("vitals-temp").value = "";
  document.getElementById("vitals-spo2").value = "";
  document.getElementById("vitals-hr").value = "";
  document.getElementById("vitals-pain").value = 0;
  document.getElementById("pain-lbl-val").innerText = 0;

  document.getElementById("vitals-modal").classList.add("active");
};

window.closeVitalsModal = function() {
  document.getElementById("vitals-modal").classList.remove("active");
};

window.vhwSubmitVitals = function(e) {
  e.preventDefault();
  const patientId = document.getElementById("vitals-pat-id").value;
  const symptoms = document.getElementById("vitals-symptoms").value.trim();
  const bpSystolic = parseInt(document.getElementById("vitals-bp-systolic").value);
  const bpDiastolic = parseInt(document.getElementById("vitals-bp-diastolic").value);
  const sugar = parseInt(document.getElementById("vitals-sugar").value);
  const temp = parseFloat(document.getElementById("vitals-temp").value);
  const spo2 = parseInt(document.getElementById("vitals-spo2").value);
  const hr = parseInt(document.getElementById("vitals-hr").value);
  const pain = parseInt(document.getElementById("vitals-pain").value);
  const specialty = document.getElementById("vitals-specialty").value;

  const vitals = { bpSystolic, bpDiastolic, sugar, temp, spo2, hr, pain, photo: null };

  const p = db.patients.find(pat => pat.id === patientId);
  const doc = db.doctors.find(d => d.specialty === specialty) || db.doctors[0];

  // Image upload mock
  const photoInput = document.getElementById("vitals-photo");
  if (photoInput.files && photoInput.files[0]) {
    vitals.photo = `Wound Image (Shared: ${photoInput.files[0].name})`;
  }

  // Triage assessment
  const triage = evaluateTriageUrgency(vitals);

  // Check if existing booked app
  const appIndex = db.appointments.findIndex(a => a.patientId === patientId);
  
  if (appIndex >= 0) {
    db.appointments[appIndex].vitals = vitals;
    db.appointments[appIndex].symptoms = symptoms;
    db.appointments[appIndex].urgency = triage.flag;
    db.appointments[appIndex].assignedDoctorId = doc.id;
    db.appointments[appIndex].specialty = specialty;
  } else {
    // New token
    const prefix = p.village.includes("A") ? "VIL-A" : p.village.includes("B") ? "VIL-B" : "VIL-C";
    const num = Math.floor(100 + Math.random() * 900);
    const token = `${prefix}-${num}`;
    
    db.appointments.push({
      token,
      patientId,
      symptoms,
      urgency: triage.flag,
      specialty,
      assignedDoctorId: doc.id,
      status: "Waiting",
      vitals
    });
  }

  saveDB();
  closeVitalsModal();
  showToast(`Vitals recorded! Patient placed in ${specialty} Queue. Triage level: ${triage.flag}`, triage.flag === "Critical" ? "danger" : "success");
  loadVhwDashboard();
};

function renderVhwQueue() {
  const tbody = document.getElementById("vhw-queue-tbody");
  tbody.innerHTML = "";

  const list = db.appointments;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No active appointment tokens currently active</td></tr>`;
    return;
  }

  list.forEach(a => {
    const p = db.patients.find(pat => pat.id === a.patientId);
    const doc = db.doctors.find(d => d.id === a.assignedDoctorId);
    
    let vitalsHtml = "Pending Vitals Logging";
    let priorityBadge = `<span class="badge badge-info">Routine</span>`;

    if (a.vitals) {
      vitalsHtml = `${a.vitals.bpSystolic}/${a.vitals.bpDiastolic} mmHg | Sugar: ${a.vitals.sugar} | SpO2: ${a.vitals.spo2}%`;
      const triage = evaluateTriageUrgency(a.vitals);
      if (triage.flag === "Critical") {
        priorityBadge = `<span class="badge badge-critical">🚨 Critical</span>`;
      } else if (triage.flag === "High Warning") {
        priorityBadge = `<span class="badge badge-warning">⚠️ High</span>`;
      } else {
        priorityBadge = `<span class="badge badge-success">Normal</span>`;
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${a.token}</strong></td>
      <td>${p ? p.name : "Unknown"}</td>
      <td>${a.symptoms}</td>
      <td>${vitalsHtml}</td>
      <td>${priorityBadge}</td>
      <td>${doc ? doc.name : "None"}</td>
      <td>
        <button class="btn-action danger" onclick="vhwCancelToken('${a.token}')">Cancel</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.vhwCancelToken = function(token) {
  const idx = db.appointments.findIndex(a => a.token === token);
  if (idx >= 0) {
    db.appointments.splice(idx, 1);
    saveDB();
    showToast(`Token ${token} cancelled.`, "warning");
    loadVhwDashboard();
  }
};

// --- DOCTOR DASHBOARD ---
function loadDoctorDashboard() {
  if (currentRole !== "doctor") return;

  // Vitals stats count
  const myQueue = db.appointments.filter(a => a.assignedDoctorId === currentUser.id && a.vitals !== null);
  document.getElementById("doc-stat-queue").innerText = `${myQueue.length} Waiting`;

  let criticalCount = 0;
  myQueue.forEach(q => {
    const triage = evaluateTriageUrgency(q.vitals);
    if (triage.flag === "Critical") criticalCount++;
  });
  document.getElementById("doc-stat-critical").innerText = `${criticalCount} Cases`;

  const consultedCount = db.consultations.filter(c => c.doctorName === currentUser.name).length;
  document.getElementById("doc-stat-consulted").innerText = `${consultedCount} Patients`;

  renderDoctorQueue();
  renderDoctorCompletedLogs();
  renderDoctorAlertsStrip(myQueue);
}

function renderDoctorAlertsStrip(queue) {
  const container = document.getElementById("doc-critical-alerts-strip");
  container.innerHTML = "";

  const criticals = queue.filter(q => evaluateTriageUrgency(q.vitals).flag === "Critical");
  if (criticals.length === 0) return;

  const banner = document.createElement("div");
  banner.className = "alert-banner";
  banner.innerHTML = `
    <span><strong>CRITICAL ALERT:</strong> ${criticals.length} patient(s) in queue require immediate attention due to abnormal vitals (SpO2/BP).</span>
  `;
  container.appendChild(banner);
}

function renderDoctorQueue(searchQuery = "") {
  const tbody = document.getElementById("doc-queue-tbody");
  tbody.innerHTML = "";

  let list = db.appointments.filter(a => a.assignedDoctorId === currentUser.id && a.vitals !== null);

  // Sorting: Critical (Urgency Score High) -> High Warning -> Normal
  list.sort((a, b) => {
    const triageA = evaluateTriageUrgency(a.vitals);
    const triageB = evaluateTriageUrgency(b.vitals);
    return triageB.score - triageA.score; // Descending score
  });

  if (searchQuery) {
    list = list.filter(a => {
      const p = db.patients.find(pat => pat.id === a.patientId);
      return (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.token.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.symptoms.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No patients currently waiting in your queue.</td></tr>`;
    return;
  }

  list.forEach(a => {
    const p = db.patients.find(pat => pat.id === a.patientId);
    const triage = evaluateTriageUrgency(a.vitals);
    
    let triageBadge = `<span class="badge badge-success">Normal</span>`;
    if (triage.flag === "Critical") triageBadge = `<span class="badge badge-critical">🚨 Critical</span>`;
    else if (triage.flag === "High Warning") triageBadge = `<span class="badge badge-warning">⚠️ High</span>`;

    const vitalsStr = `BP: ${a.vitals.bpSystolic}/${a.vitals.bpDiastolic} | SpO2: ${a.vitals.spo2}% | HR: ${a.vitals.hr} | Temp: ${a.vitals.temp}°C`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${a.token}</strong></td>
      <td><strong>${p ? p.name : "Unknown"}</strong></td>
      <td>${p ? p.age : "--"} yrs / ${p ? p.gender : "--"}</td>
      <td>${p ? p.village : "--"}</td>
      <td>
        <div style="font-size:12px; font-weight:600;">${vitalsStr}</div>
        <div style="font-size:11px; color:var(--text-muted); font-style:italic;">Symptoms: ${a.symptoms}</div>
      </td>
      <td>${triageBadge}</td>
      <td>
        <button class="btn-action success" onclick="startDoctorConsultation('${a.token}')">🎥 Start Call</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.docSearchQueue = function(val) {
  renderDoctorQueue(val.trim());
};

function renderDoctorCompletedLogs() {
  const tbody = document.getElementById("doc-completed-tbody");
  tbody.innerHTML = "";

  const myLogs = db.consultations.filter(c => c.doctorName === currentUser.name);
  if (myLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No completed consultations logged yet.</td></tr>`;
    return;
  }

  myLogs.forEach(l => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.date}</td>
      <td>${l.id}</td>
      <td><strong>${l.patientName}</strong></td>
      <td>${l.diagnosis}</td>
      <td>${l.medicines}</td>
      <td>${l.referral ? `<span class="badge badge-critical">Yes (District Hospital)</span>` : `<span class="badge badge-success">No</span>`}</td>
      <td><button class="btn-action" onclick="viewDigitalPrescriptionPopup('${l.id}')">🖨️ View / Print</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// --- TELEMEDICINE ENGINE & BANDWIDTH FAILOVER ---
const NETWORK_STATES = {
  good: { label: "HD Video Call Active", bars: 4, bitrate: "4.8 Mbps", latency: "25 ms", class: "good-signal" },
  poor: { label: "Low Quality (Pixelated failover)", bars: 2, bitrate: "320 Kbps", latency: "140 ms", class: "poor-signal" },
  verypoor: { label: "Audio + Medical Chat failover", bars: 1, bitrate: "45 Kbps", latency: "420 ms", class: "very-poor-signal" }
};

function initSimulatedCallState(token, role) {
  const app = db.appointments.find(a => a.token === token);
  const patient = db.patients.find(p => p.id === app.patientId);
  const doctor = db.doctors.find(d => d.id === app.assignedDoctorId);

  activeCall = {
    token,
    patient,
    doctor,
    role,
    networkQuality: "good",
    autoFluctuate: false,
    micActive: true,
    camActive: true,
    chat: [
      { sender: "system", text: "Encrypted rural tele-health session established." },
      { sender: "worker", text: `Hello ${doctor.name}, Nurse Anjali here assisting ${patient.name}. Vitals have been synchronized.` }
    ],
    files: [
      { name: "Clinical Vitals Record.pdf", size: "45 KB", type: "pdf" }
    ],
    animationFrameId: null
  };

  // Add wound image if VHW uploaded one
  if (app.vitals && app.vitals.photo) {
    activeCall.files.push({ name: app.vitals.photo, size: "1.2 MB", type: "image" });
  }

  // Set active in DB
  const idx = db.appointments.findIndex(a => a.token === token);
  if (idx >= 0) db.appointments[idx].status = "Active";
  saveDB();
}

window.startDoctorConsultation = function(token) {
  initSimulatedCallState(token, "doctor");
  
  // UI Changes
  document.getElementById("doc-queue-section").style.display = "none";
  document.getElementById("doc-consultation-section").style.display = "block";
  document.getElementById("doc-call-pat-name").innerText = activeCall.patient.name;
  
  // Reset prescription compiler fields
  activeCallPrescriptionMeds = [];
  document.getElementById("pres-diagnosis").value = "";
  document.getElementById("pres-advice").value = "";
  document.getElementById("pres-referral-check").checked = false;
  
  syncPrescriptionLabels();

  // Show live section
  startCallLoop();
  showToast(`Connected to clinic. Simulated feed started.`, "success");
};

window.joinPatientCall = function() {
  const activeApp = db.appointments.find(a => a.patientId === currentUser.id && a.status === "Active");
  if (!activeApp) return;

  initSimulatedCallState(activeApp.token, "patient");
  document.getElementById("pat-active-call-card").style.display = "none";
  document.getElementById("pat-telehealth-box").style.display = "block";
  
  startCallLoop();
};

window.joinVhwCall = function(token) {
  initSimulatedCallState(token, "vhw");
  document.getElementById("vhw-telehealth-box").style.display = "block";
  
  startCallLoop();
};

function startCallLoop() {
  const role = activeCall.role;
  const mainCanvas = document.getElementById(`${role}-remote-canvas`);
  const pipCanvas = document.getElementById(`${role}-local-canvas`);
  const remoteContainer = document.getElementById(`${role}-remote-video-container`);
  const localContainer = document.getElementById(`${role}-local-video-container`);

  if (!mainCanvas || !pipCanvas) return;

  // Initialize network status indicators
  updateNetworkUI();

  // Populate vitals & files tab
  updateVitalsFilesTabs();

  // Route call based on Agora configuration
  if (agoraConfig.enabled && agoraConfig.appid) {
    // Hide simulated canvas feeds
    mainCanvas.style.display = "none";
    pipCanvas.style.display = "none";
    
    // Show real video containers
    if (remoteContainer) remoteContainer.style.display = "block";
    if (localContainer) localContainer.style.display = "block";

    joinAgoraRoom(role);
  } else {
    // Show simulated canvas feeds
    mainCanvas.style.display = "block";
    pipCanvas.style.display = "block";
    
    // Hide real video containers
    if (remoteContainer) remoteContainer.style.display = "none";
    if (localContainer) localContainer.style.display = "none";

    // Trigger rendering cycle for mock video
    renderWebcams(mainCanvas, pipCanvas);
  }
}

function updateVitalsFilesTabs() {
  const role = activeCall.role;
  const vitalsContainer = document.getElementById(`${role}-call-vitals-box`);
  const filesContainer = document.getElementById(`${role}-call-files-box`);

  if (!vitalsContainer || !filesContainer) return;

  const app = db.appointments.find(a => a.token === activeCall.token);
  if (!app || !app.vitals) return;

  vitalsContainer.innerHTML = `
    <div class="vital-box">
      <span class="vital-label">Blood Pressure</span>
      <div class="vital-value">${app.vitals.bpSystolic}/${app.vitals.bpDiastolic} <span>mmHg</span></div>
    </div>
    <div class="vital-box">
      <span class="vital-label">Blood Sugar</span>
      <div class="vital-value">${app.vitals.sugar} <span>mg/dL</span></div>
    </div>
    <div class="vital-box">
      <span class="vital-label">SpO2</span>
      <div class="vital-value">${app.vitals.spo2} <span>%</span></div>
    </div>
    <div class="vital-box">
      <span class="vital-label">Heart Rate</span>
      <div class="vital-value">${app.vitals.hr} <span>BPM</span></div>
    </div>
  `;

  // Apply visual warning classes inside tabs
  const boxes = vitalsContainer.querySelectorAll(".vital-box");
  const triage = evaluateTriageUrgency(app.vitals);
  
  if (app.vitals.spo2 < 92) boxes[2].classList.add("abnormal");
  if (app.vitals.bpSystolic > 140) boxes[0].classList.add("warning");

  // Files list
  renderCallFiles();
}

function renderCallFiles() {
  const role = activeCall.role;
  const container = document.getElementById(`${role}-call-files-box`);
  container.innerHTML = "";

  activeCall.files.forEach(f => {
    const icon = f.type === "image" ? "🖼️" : "📄";
    const div = document.createElement("div");
    div.className = "file-card";
    div.innerHTML = `
      <div class="file-info">
        <span class="file-icon">${icon}</span>
        <div class="file-details">
          <span class="file-name">${f.name}</span>
          <span class="file-size">${f.size}</span>
        </div>
      </div>
      <a class="file-download-btn" href="#" onclick="showToast('Downloading simulated report: ${f.name}', 'success')">Download</a>
    `;
    container.appendChild(div);
  });
}

window.vhwUploadWoundImage = function(e) {
  if (!activeCall || activeCall.role !== "vhw") return;
  const file = e.target.files[0];
  if (!file) return;

  activeCall.files.push({
    name: `Uploaded Wound Photo (${file.name})`,
    size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    type: "image"
  });

  // Log in chat
  activeCall.chat.push({ sender: "worker", text: `[Shared Wound Photo: ${file.name}]` });
  
  renderCallFiles();
  syncChatBox();
  showToast("Wound photo uploaded and shared with Doctor.", "success");
};

// Canvas camera simulations
let blinkCounter = 0;
let speakOffset = 0;

function renderWebcams(remoteCanvas, localCanvas) {
  if (!activeCall) return;

  const remoteCtx = remoteCanvas.getContext("2d");
  const localCtx = localCanvas.getContext("2d");

  // Ensure internal dimensions match CSS layouts
  if (remoteCanvas.width !== remoteCanvas.clientWidth) {
    remoteCanvas.width = remoteCanvas.clientWidth;
    remoteCanvas.height = remoteCanvas.clientHeight;
  }
  if (localCanvas.width !== localCanvas.clientWidth) {
    localCanvas.width = localCanvas.clientWidth;
    localCanvas.height = localCanvas.clientHeight;
  }

  // Animation math loops
  blinkCounter = (blinkCounter + 1) % 150;
  speakOffset = Math.sin(Date.now() / 100) * 8;

  // 1. Draw Local webcam feed (Picture-in-picture)
  localCtx.fillStyle = "#334155";
  localCtx.fillRect(0, 0, localCanvas.width, localCanvas.height);
  
  if (activeCall.camActive) {
    // Draw simplified avatar representing local user
    localCtx.fillStyle = "#4f46e5";
    localCtx.beginPath();
    localCtx.arc(localCanvas.width / 2, localCanvas.height / 2 + 10, 24, 0, Math.PI * 2);
    localCtx.fill();
    localCtx.fillStyle = "#fbcfe8";
    localCtx.beginPath();
    localCtx.arc(localCanvas.width / 2, localCanvas.height / 2 - 16, 12, 0, Math.PI * 2);
    localCtx.fill();
    localCtx.fillStyle = "white";
    localCtx.font = "8px Inter";
    localCtx.textAlign = "center";
    localCtx.fillText("You (Local Feed)", localCanvas.width / 2, localCanvas.height - 10);
  } else {
    localCtx.fillStyle = "white";
    localCtx.font = "10px Inter";
    localCtx.textAlign = "center";
    localCtx.fillText("Cam Disabled", localCanvas.width / 2, localCanvas.height / 2);
  }

  // 2. Draw Remote camera feed (Doctor/Patient depending on who is viewing)
  if (activeCall.networkQuality !== "verypoor") {
    // Canvas background
    remoteCtx.fillStyle = "#1e293b";
    remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    const centerX = remoteCanvas.width / 2;
    const centerY = remoteCanvas.height / 2;

    // Outer circle / body
    remoteCtx.fillStyle = activeCall.role === "doctor" ? "#06b6d4" : "#4f46e5"; // patient is cyan, doctor is indigo
    remoteCtx.beginPath();
    remoteCtx.arc(centerX, centerY + 80, 80, 0, Math.PI * 2);
    remoteCtx.fill();

    // Head
    remoteCtx.fillStyle = "#fed7aa"; // Skin tone
    remoteCtx.beginPath();
    remoteCtx.arc(centerX, centerY - 20, 50, 0, Math.PI * 2);
    remoteCtx.fill();

    // Eyes
    remoteCtx.fillStyle = "#0f172a";
    const isBlinking = blinkCounter < 6;
    if (isBlinking) {
      remoteCtx.fillRect(centerX - 24, centerY - 24, 16, 3);
      remoteCtx.fillRect(centerX + 8, centerY - 24, 16, 3);
    } else {
      remoteCtx.beginPath();
      remoteCtx.arc(centerX - 16, centerY - 22, 6, 0, Math.PI * 2);
      remoteCtx.arc(centerX + 16, centerY - 22, 6, 0, Math.PI * 2);
      remoteCtx.fill();
    }

    // Hair / Clinician Stethoscope / Accessories
    if (activeCall.role === "patient") {
      // Doctor character details (stethoscope, specs)
      remoteCtx.strokeStyle = "#cbd5e1";
      remoteCtx.lineWidth = 4;
      remoteCtx.beginPath();
      remoteCtx.arc(centerX, centerY - 20, 54, 0.1 * Math.PI, 0.9 * Math.PI);
      remoteCtx.stroke();
    }

    // Mouth (Speaking animation)
    remoteCtx.fillStyle = "#ef4444";
    remoteCtx.beginPath();
    const speakingOpen = speakOffset > 0;
    if (speakingOpen) {
      remoteCtx.ellipse(centerX, centerY + 10, 8, 4 + speakOffset/2, 0, 0, Math.PI * 2);
    } else {
      remoteCtx.arc(centerX, centerY + 10, 6, 0, Math.PI);
    }
    remoteCtx.fill();

    // Name text
    remoteCtx.fillStyle = "white";
    remoteCtx.font = "14px Inter";
    remoteCtx.textAlign = "center";
    const remoteName = activeCall.role === "doctor" ? activeCall.patient.name : activeCall.doctor.name;
    remoteCtx.fillText(remoteName, centerX, remoteCanvas.height - 20);

    // Apply pixelation effect for "Poor Network" (Low-Quality failover)
    if (activeCall.networkQuality === "poor") {
      pixelateCanvas(remoteCanvas, remoteCtx, 12);
    }
  }

  // Continue render loop
  activeCall.animationFrameId = requestAnimationFrame(() => renderWebcams(remoteCanvas, localCanvas));
}

// Low-Bandwidth Pixelation Algorithm (simulates real-time video downsampling)
function pixelateCanvas(canvas, ctx, pixelSize) {
  const width = canvas.width;
  const height = canvas.height;
  
  // Get original image data
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y += pixelSize) {
    for (let x = 0; x < width; x += pixelSize) {
      // Get color of pixel in center of block
      const redIdx = ((Math.min(y + (pixelSize / 2), height - 1) * width) + Math.min(x + (pixelSize / 2), width - 1)) * 4;
      const r = data[redIdx];
      const g = data[redIdx + 1];
      const b = data[redIdx + 2];
      
      // Paint block with that color
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    }
  }
}

// Simulated Network change triggers
window.simulateNetworkChange = function(quality) {
  if (!activeCall) return;
  activeCall.networkQuality = quality;

  // Log in DB
  db.failoverLogs[quality === "good" ? "hd" : quality === "poor" ? "low" : "audio"]++;
  saveDB();

  updateNetworkUI();
};

function updateNetworkUI() {
  const state = NETWORK_STATES[activeCall.networkQuality];
  const role = activeCall.role;

  // Text status
  const connText = document.getElementById(`${role}-conn-text`);
  if (connText) connText.innerText = `${state.label} (${state.bitrate})`;

  // Signal strength bars styling
  const bars = document.querySelectorAll(`#${role}-sig-bars .sig-bar`);
  bars.forEach((bar, index) => {
    if (index < state.bars) {
      bar.classList.add("active");
    } else {
      bar.classList.remove("active");
    }
  });

  const viewport = document.getElementById(`${role}-viewport-container`);
  if (viewport) {
    viewport.className = `call-viewport ${state.class}`;
  }

  // Audio avatar fallback handling
  const fallback = document.getElementById(`${role}-remote-audio-fallback`);
  const remoteCanvas = document.getElementById(`${role}-remote-canvas`);
  const remoteContainer = document.getElementById(`${role}-remote-video-container`);

  if (activeCall.networkQuality === "verypoor") {
    if (fallback) fallback.style.display = "flex";
    if (remoteCanvas) remoteCanvas.style.opacity = 0;
    if (remoteContainer) remoteContainer.style.opacity = 0;

    // If Agora is active, disable local video track to save bandwidth
    if (agoraConfig.enabled && localVideoTrack) {
      localVideoTrack.setEnabled(false);
    }
    
    // Set initials in fallback
    const remoteInitials = document.getElementById(role === "doctor" ? "doc-patient-initials" : `${role}-doctor-initials`);
    if (remoteInitials) {
      const name = role === "doctor" ? activeCall.patient.name : activeCall.doctor.name;
      remoteInitials.innerText = name.split(" ").map(n => n[0]).join("");
    }

    // Auto switch to chat tab since video has shut off
    switchCallTab(role, "chat");

    showToast("Bandwidth Critically low! Automatically switching to audio + medical chat.", "danger");
    activeCall.chat.push({ sender: "system", text: "Automatic Failover: switched to audio-only due to 45Kbps restriction." });
    syncChatBox();
  } else {
    if (fallback) fallback.style.display = "none";
    if (remoteCanvas) remoteCanvas.style.opacity = 1;
    if (remoteContainer) {
      remoteContainer.style.opacity = 1;
      if (agoraConfig.enabled) {
        remoteContainer.style.display = "block";
      }
    }

    // Re-enable Agora video track if we move back from verypoor
    if (agoraConfig.enabled && localVideoTrack && activeCall.camActive) {
      localVideoTrack.setEnabled(true);
    }

    if (activeCall.networkQuality === "poor") {
      // Simulate low-bandwidth pixelation on real Agora stream using CSS blur/contrast filters
      if (remoteContainer) remoteContainer.style.filter = "blur(3px) contrast(140%) brightness(95%)";
      
      showToast("Bandwidth Poor. Reducing webcam resolution to 320p compression.", "warning");
      activeCall.chat.push({ sender: "system", text: "Network Warning: reducing video quality to conserve bandwidth." });
      syncChatBox();
    } else {
      if (remoteContainer) remoteContainer.style.filter = "none";
      showToast("Bandwidth recovered. Restoring HD video quality.", "success");
    }
  }

  // Sync controls state
  const selSelect = document.getElementById(`${role}-net-sim`);
  if (selSelect) selSelect.value = activeCall.networkQuality;

  if (role === "doctor") {
    document.getElementById("doc-network-lbl").innerText = activeCall.networkQuality === "good" ? "Good (HD)" : activeCall.networkQuality === "poor" ? "Poor (Low-Res)" : "Very Poor (Audio)";
  }
}

// Auto network fluctuation simulator (shows the failover without clicking manually)
let fluctuationTimer = null;
window.toggleAutoNetworkFluctuation = function() {
  if (!activeCall) return;
  activeCall.autoFluctuate = !activeCall.autoFluctuate;

  const btnText = document.getElementById("doc-auto-fluctuate-indicator");

  if (activeCall.autoFluctuate) {
    btnText.innerText = "🔄 Auto-Fluctuate: ON";
    showToast("Automatic bandwidth fluctuation enabled. Monitoring network environment...", "info");
    
    let step = 0;
    fluctuationTimer = setInterval(() => {
      if (!activeCall) {
        clearInterval(fluctuationTimer);
        return;
      }
      step = (step + 1) % 3;
      const qualities = ["poor", "verypoor", "good"];
      simulateNetworkChange(qualities[step]);
    }, 15000); // changes every 15s
  } else {
    btnText.innerText = "🔄 Auto-Fluctuate: OFF";
    clearInterval(fluctuationTimer);
    simulateNetworkChange("good");
  }
};

// Chat and messaging
window.switchCallTab = function(role, tab) {
  document.getElementById(`${role}-tab-chat`).classList.remove("active");
  document.getElementById(`${role}-tab-files`).classList.remove("active");
  document.getElementById(`${role}-pane-chat`).classList.remove("active");
  document.getElementById(`${role}-pane-files`).classList.remove("active");

  document.getElementById(`${role}-tab-${tab}`).classList.add("active");
  document.getElementById(`${role}-pane-${tab}`).classList.add("active");
};

window.sendChatMessage = function(role) {
  const input = document.getElementById(`${role}-chat-input`);
  const text = input.value.trim();
  if (!text || !activeCall) return;

  const sender = role === "doctor" ? "doctor" : "worker";
  activeCall.chat.push({ sender, text });
  input.value = "";

  syncChatBox();

  // Simulated auto-reply response to make it interactive
  if (role === "doctor") {
    setTimeout(() => {
      if (!activeCall) return;
      activeCall.chat.push({
        sender: "worker",
        text: `Understood, Doctor. Patient mentions that symptoms have persisted since yesterday morning.`
      });
      syncChatBox();
    }, 1500);
  }
};

function syncChatBox() {
  if (!activeCall) return;
  const roles = ["patient", "vhw", "doctor"];
  
  roles.forEach(role => {
    const box = document.getElementById(`${role}-chat-box`);
    if (!box) return;

    box.innerHTML = "";
    activeCall.chat.forEach(msg => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${msg.sender}`;
      bubble.innerText = msg.text;
      box.appendChild(bubble);
    });

    // Auto scroll to bottom
    box.scrollTop = box.scrollHeight;
  });
}

window.toggleAudioState = function(role) {
  if (!activeCall) return;
  activeCall.micActive = !activeCall.micActive;
  const btn = document.getElementById(`${role}-mic-toggle`);
  if (activeCall.micActive) {
    btn.classList.add("active");
    btn.innerText = "🎙️";
    showToast("Microphone unmuted", "info");
  } else {
    btn.classList.remove("active");
    btn.innerText = "🔇";
    showToast("Microphone muted", "warning");
  }
};

window.toggleVideoState = function(role) {
  if (!activeCall) return;
  activeCall.camActive = !activeCall.camActive;
  const btn = document.getElementById(`${role}-cam-toggle`);
  if (activeCall.camActive) {
    btn.classList.add("active");
    btn.innerText = "📷";
    showToast("Webcam enabled", "info");
  } else {
    btn.classList.remove("active");
    btn.innerText = "📵";
    showToast("Webcam disabled", "warning");
  }
};

window.leaveConsultation = function() {
  if (!activeCall) return;

  if (activeCall.animationFrameId) {
    cancelAnimationFrame(activeCall.animationFrameId);
  }
  if (fluctuationTimer) {
    clearInterval(fluctuationTimer);
  }

  // Agora Disconnect
  if (agoraConfig.enabled && agoraClient) {
    leaveAgoraRoom();
  }

  // Restore Waiting status in db
  const idx = db.appointments.findIndex(a => a.token === activeCall.token);
  if (idx >= 0 && db.appointments[idx].status === "Active") {
    db.appointments[idx].status = "Waiting";
  }
  saveDB();

  const role = activeCall.role;
  activeCall = null;

  // Hide suites
  document.getElementById("pat-telehealth-box").style.display = "none";
  document.getElementById("vhw-telehealth-box").style.display = "none";
  document.getElementById("doc-consultation-section").style.display = "none";

  // Re-load panels
  if (role === "doctor") {
    document.getElementById("doc-queue-section").style.display = "block";
    loadDoctorDashboard();
  } else if (role === "vhw") {
    loadVhwDashboard();
  } else if (role === "patient") {
    loadPatientDashboard();
  }

  showToast("Call disconnected", "danger");
};

// --- PRESCRIPTION BUILDER ---
window.addMedicineRow = function() {
  const select = document.getElementById("pres-med-name");
  const freqInput = document.getElementById("pres-med-freq");
  const durInput = document.getElementById("pres-med-duration");

  const name = select.value;
  const freq = freqInput.value.trim() || "1-0-1 (BID)";
  const dur = durInput.value.trim() || "5 days";

  activeCallPrescriptionMeds.push({ name, freq, dur });
  
  // Reset inputs
  freqInput.value = "";
  durInput.value = "";

  syncPrescriptionLabels();
  showToast(`${name} added to prescription list`, "success");
};

function syncPrescriptionLabels() {
  const ul = document.getElementById("pres-lbl-meds-list");
  if (!ul) return;

  ul.innerHTML = "";
  if (activeCallPrescriptionMeds.length === 0) {
    ul.innerHTML = `<li style="color:var(--text-muted); border:none;">No medications added yet</li>`;
  } else {
    activeCallPrescriptionMeds.forEach((m, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <span class="med-name">${m.name}</span>
          <span class="med-freq">(${m.freq} / ${m.dur})</span>
        </div>
        <button type="button" style="color:var(--danger); font-size:10px; font-weight:600;" onclick="removeMedicineRow(${idx})">Remove</button>
      `;
      ul.appendChild(li);
    });
  }

  // Preview data bindings
  if (activeCall) {
    document.getElementById("pres-lbl-pat-name").innerText = activeCall.patient.name;
    document.getElementById("pres-lbl-pat-age").innerText = `${activeCall.patient.age} / ${activeCall.patient.gender}`;
    document.getElementById("pres-lbl-date").innerText = new Date().toLocaleDateString();
    document.getElementById("pres-lbl-token").innerText = activeCall.token;
    
    const app = db.appointments.find(a => a.token === activeCall.token);
    if (app && app.vitals) {
      document.getElementById("pres-lbl-bp").innerText = `${app.vitals.bpSystolic}/${app.vitals.bpDiastolic} mmHg`;
      document.getElementById("pres-lbl-spo2").innerText = `${app.vitals.spo2}% / ${app.vitals.hr} bpm`;
    }
    
    document.getElementById("pres-lbl-village").innerText = `${activeCall.patient.village} Clinic, Smart Village Network`;
    document.getElementById("pres-lbl-doc").innerText = currentUser.name;
  }
}

window.removeMedicineRow = function(idx) {
  activeCallPrescriptionMeds.splice(idx, 1);
  syncPrescriptionLabels();
};

window.resetPrescriptionForm = function() {
  activeCallPrescriptionMeds = [];
  document.getElementById("pres-diagnosis").value = "";
  document.getElementById("pres-advice").value = "";
  document.getElementById("pres-referral-check").checked = false;
  syncPrescriptionLabels();
};

window.submitDigitalPrescription = function(e) {
  e.preventDefault();
  if (!activeCall) return;

  const diagnosis = document.getElementById("pres-diagnosis").value.trim();
  const advice = document.getElementById("pres-advice").value.trim() || "Take rest and drink warm liquids.";
  const referral = document.getElementById("pres-referral-check").checked;

  if (activeCallPrescriptionMeds.length === 0) {
    showToast("Please add at least one medication to prescribe.", "warning");
    return;
  }

  // Create Consultation Log
  const conId = `con-${Date.now().toString().slice(-4)}`;
  const medsSummary = activeCallPrescriptionMeds.map(m => `${m.name} (${m.freq})`).join(", ");
  
  let networkFailoverSummary = "HD Video";
  if (activeCall.networkQuality === "poor") networkFailoverSummary = "Low Quality Video";
  else if (activeCall.networkQuality === "verypoor") networkFailoverSummary = "Audio Call + Chat";

  const newConsultation = {
    id: conId,
    date: new Date().toISOString().split("T")[0],
    patientName: activeCall.patient.name,
    village: activeCall.patient.village,
    doctorName: currentUser.name,
    diagnosis,
    medicines: medsSummary,
    failoverState: networkFailoverSummary,
    referral
  };

  db.consultations.push(newConsultation);

  // Archive Patient History Record
  const patIndex = db.patients.findIndex(p => p.id === activeCall.patient.id);
  if (patIndex >= 0) {
    db.patients[patIndex].history.push({
      date: new Date().toISOString().split("T")[0],
      clinic: currentUser.specialty,
      diagnosis,
      medicines: medsSummary,
      doctor: currentUser.name
    });
  }

  // Delete active appointment token
  const appIdx = db.appointments.findIndex(a => a.token === activeCall.token);
  if (appIdx >= 0) db.appointments.splice(appIdx, 1);

  saveDB();

  // Stop simulated webcam feed
  if (activeCall.animationFrameId) {
    cancelAnimationFrame(activeCall.animationFrameId);
  }

  activeCall = null;
  resetPrescriptionForm();
  showToast(`Prescription saved! Token dispatched. Consultation complete.`, "success");

  // Load modal view of PDF prescription
  viewDigitalPrescriptionPopup(conId);

  // Return to queue
  document.getElementById("doc-consultation-section").style.display = "none";
  document.getElementById("doc-queue-section").style.display = "block";
  loadDoctorDashboard();
};

window.viewDigitalPrescriptionPopup = function(conId) {
  const con = db.consultations.find(c => c.id === conId);
  if (!con) return;

  const modalContent = document.getElementById("modal-pres-print-content");
  modalContent.innerHTML = `
    <div class="prescription-preview-panel" style="border:none; box-shadow:none; padding:10px;">
      <div>
        <div class="prescription-header">
          <div class="dispensary-meta">
            <h4>VILLAGEMED SMART DISPENSARY</h4>
            <p>${con.village} Clinic, Smart Village Network</p>
          </div>
          <div class="doctor-stamp">
            <div class="doc-name">${con.doctorName}</div>
            <div style="font-size: 10px; color: var(--text-muted);">Consultant MD</div>
          </div>
        </div>

        <div class="prescription-meta-grid">
          <div class="meta-field"><span>Patient:</span> <span>${con.patientName}</span></div>
          <div class="meta-field"><span>Date:</span> <span>${con.date}</span></div>
          <div class="meta-field"><span>Record ID:</span> <span>${con.id}</span></div>
        </div>

        <div class="prescription-body">
          <h5>Rx (Prescribed Medications)</h5>
          <ul class="prescription-meds-list">
            ${con.medicines.split(", ").map(m => `<li><span class="med-name">${m}</span></li>`).join("")}
          </ul>

          <h5>Diagnosis Summary</h5>
          <div style="font-size: 12px; margin-bottom: 16px; font-weight: 500;">${con.diagnosis}</div>

          <h5>Referral Escalation</h5>
          <div style="font-size: 12px; margin-bottom: 16px;">Escalated to Specialist Center: <strong>${con.referral ? "YES (Priority Escalation)" : "NO"}</strong></div>
        </div>
      </div>

      <div class="prescription-footer" style="margin-top:20px;">
        <div>* Digitally signed electronic health prescription.</div>
        <div class="signature-line">Authorized Signature</div>
      </div>
    </div>
  `;

  document.getElementById("pres-view-modal").classList.add("active");
};

window.closePresModal = function() {
  document.getElementById("pres-view-modal").classList.remove("active");
};

window.printPrescription = function() {
  window.print();
};

// Bind inputs changes in real-time
document.getElementById("pres-diagnosis").addEventListener("input", (e) => {
  const lbl = document.getElementById("pres-lbl-diagnosis");
  if (lbl) lbl.innerText = e.target.value || "--";
});

document.getElementById("pres-advice").addEventListener("input", (e) => {
  const lbl = document.getElementById("pres-lbl-advice");
  if (lbl) lbl.innerText = e.target.value || "--";
});

// --- ADMIN PORTAL & SVG ANALYTICS ---
function loadAdminDashboard() {
  if (currentRole !== "admin") return;

  // Sync metrics
  document.getElementById("adm-stat-villages").innerText = `${db.villages.length} Clinics`;
  document.getElementById("adm-stat-doctors").innerText = `${db.doctors.length} Doctors`;
  document.getElementById("adm-stat-calls").innerText = `${db.consultations.length} Logs`;
  
  // Calculate total failovers from DB logs
  const totalFailures = db.failoverLogs.low + db.failoverLogs.audio;
  document.getElementById("adm-stat-failovers").innerText = `${totalFailures} Failures`;

  // Render CRUD tables
  renderAdminVillages();
  renderAdminDoctors();
  renderAdminLogs();

  // Populate appointment patient & doctor dropdowns
  const patSelect = document.getElementById("adm-book-patient");
  if (patSelect) {
    patSelect.innerHTML = db.patients.map(p => `<option value="${p.id}">${p.name} (ID: ${p.id})</option>`).join("");
  }
  const docSelect = document.getElementById("adm-book-doctor");
  if (docSelect) {
    docSelect.innerHTML = db.doctors.map(d => `<option value="${d.id}">${d.name} (${d.specialty})</option>`).join("");
  }

  // Render Charts
  renderAdminCharts();
}

window.adminBookAppointment = function(e) {
  e.preventDefault();
  const patientId = document.getElementById("adm-book-patient").value;
  const doctorId = document.getElementById("adm-book-doctor").value;
  const symptoms = document.getElementById("adm-book-symptoms").value.trim();
  const urgency = document.getElementById("adm-book-urgency").value;

  const p = db.patients.find(pat => pat.id === patientId);
  const doc = db.doctors.find(d => d.id === doctorId);

  if (!p || !doc) return;

  const existingApp = db.appointments.find(a => a.patientId === patientId);
  if (existingApp) {
    showToast(`${p.name} already has an active appointment or token!`, "warning");
    return;
  }

  // Generate Token
  const prefix = p.village.includes("A") ? "VIL-A" : p.village.includes("B") ? "VIL-B" : "VIL-C";
  const num = Math.floor(100 + Math.random() * 900);
  const token = `${prefix}-${num}`;

  // Default normal vitals for admin booking so it goes directly to Doctor Queue
  const vitals = { bpSystolic: 120, bpDiastolic: 80, sugar: 100, temp: 36.7, spo2: 98, hr: 72, pain: 0, photo: null };

  // Set vitals based on urgency override to trigger different color codes on Doctor Queue
  let finalUrgency = urgency;
  if (urgency === "Severe") {
    vitals.spo2 = 88; // low oxygen
    vitals.bpSystolic = 165; // high BP
    vitals.hr = 115; // fast heart rate
  } else if (urgency === "Moderate") {
    vitals.bpSystolic = 145;
    vitals.spo2 = 93;
  }

  const newApp = {
    token,
    patientId,
    symptoms,
    urgency: urgency === "Severe" ? "Critical" : urgency === "Moderate" ? "High Warning" : "Normal",
    specialty: doc.specialty,
    assignedDoctorId: doctorId,
    status: "Waiting",
    vitals
  };

  db.appointments.push(newApp);
  saveDB();
  
  document.getElementById("adm-book-symptoms").value = "";
  showToast(`Admin Direct Booking success! Token ${token} created.`, "success");
  
  loadAdminDashboard();
};

function renderAdminVillages() {
  const tbody = document.getElementById("adm-village-tbody");
  tbody.innerHTML = "";
  db.villages.forEach((v, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${v}</strong></td>
      <td><span class="badge badge-success">Online</span></td>
      <td><button class="btn-action danger" onclick="adminDeleteVillage(${idx})">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.adminAddVillage = function(e) {
  e.preventDefault();
  const name = document.getElementById("adm-village-name").value.trim();
  if (db.villages.includes(name)) {
    showToast("Village clinic already exists", "warning");
    return;
  }
  db.villages.push(name);
  saveDB();
  document.getElementById("adm-village-name").value = "";
  showToast("Village clinic added", "success");
  loadAdminDashboard();
};

window.adminDeleteVillage = function(idx) {
  db.villages.splice(idx, 1);
  saveDB();
  showToast("Village clinic deleted", "warning");
  loadAdminDashboard();
};

function renderAdminDoctors() {
  const tbody = document.getElementById("adm-doctor-tbody");
  tbody.innerHTML = "";
  db.doctors.forEach((d, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${d.name}</strong></td>
      <td>${d.specialty}</td>
      <td><button class="btn-action danger" onclick="adminDeleteDoctor(${idx})">Remove</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.adminAddDoctor = function(e) {
  e.preventDefault();
  const name = document.getElementById("adm-doc-name").value.trim();
  const specialty = document.getElementById("adm-doc-specialty").value;
  const id = `doc-${Date.now().toString().slice(-4)}`;

  const newDoc = {
    id,
    name,
    specialty,
    email: `${name.toLowerCase().replace("dr. ", "").replace(" ", ".")}@villagemed.in`,
    password: "password",
    online: true
  };

  db.doctors.push(newDoc);
  saveDB();
  document.getElementById("adm-doc-name").value = "";
  showToast(`Doctor ${name} onboarded`, "success");
  loadAdminDashboard();
};

window.adminDeleteDoctor = function(idx) {
  db.doctors.splice(idx, 1);
  saveDB();
  showToast("Doctor removed from staff", "warning");
  loadAdminDashboard();
};

function renderAdminLogs() {
  const tbody = document.getElementById("adm-logs-tbody");
  tbody.innerHTML = "";

  if (db.consultations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No consultation records logged yet</td></tr>`;
    return;
  }

  db.consultations.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.village}</td>
      <td>${c.doctorName}</td>
      <td>${c.patientName}</td>
      <td>
        <span class="badge ${c.failoverState.includes("HD") ? 'badge-success' : c.failoverState.includes("Low") ? 'badge-warning' : 'badge-critical'}">
          ${c.failoverState}
        </span>
      </td>
      <td>${c.diagnosis}</td>
    `;
    tbody.appendChild(tr);
  });
}

window.exportReportsCSV = function() {
  let csv = "Consultation ID,Date,Village Clinic,Doctor,Patient,Failover Status,Diagnosis,Medicines\n";
  db.consultations.forEach(c => {
    csv += `"${c.id}","${c.date}","${c.village}","${c.doctorName}","${c.patientName}","${c.failoverState}","${c.diagnosis}","${c.medicines}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VillageMed_Dispensary_Report_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("CSV report generated and downloaded.", "success");
};

// SVG Chart Engine
function renderAdminCharts() {
  const volumeChartContainer = document.getElementById("admin-volume-chart");
  const networkChartContainer = document.getElementById("admin-network-chart");

  if (!volumeChartContainer || !networkChartContainer) return;

  // 1. Consultation Volume (Last 5 Days)
  const volumeData = [
    { label: "Jun 26", val: 2 },
    { label: "Jun 27", val: 4 },
    { label: "Jun 28", val: 5 },
    { label: "Jun 29", val: 7 },
    { label: "Jun 30", val: db.consultations.length }
  ];

  const maxVal = Math.max(...volumeData.map(d => d.val), 5);
  let volHtml = "";
  volumeData.forEach(d => {
    const pct = (d.val / maxVal) * 80; // max height 80%
    volHtml += `
      <div class="chart-bar-column">
        <div class="chart-bar" style="height: ${pct}%;" data-value="${d.val} patients"></div>
        <div class="chart-label">${d.label}</div>
      </div>
    `;
  });
  volumeChartContainer.innerHTML = volHtml;

  // 2. Network Quality Failover Breakdowns
  const netData = [
    { label: "HD Video", val: db.failoverLogs.hd, color: "failover-good" },
    { label: "Low Quality", val: db.failoverLogs.low, color: "failover-poor" },
    { label: "Audio Fallback", val: db.failoverLogs.audio, color: "failover-verypoor" }
  ];

  const netMax = Math.max(...netData.map(d => d.val), 5);
  let netHtml = "";
  netData.forEach(d => {
    const pct = (d.val / netMax) * 80;
    netHtml += `
      <div class="chart-bar-column">
        <div class="chart-bar ${d.color}" style="height: ${pct}%;" data-value="${d.val} times"></div>
        <div class="chart-label">${d.label}</div>
      </div>
    `;
  });
  networkChartContainer.innerHTML = netHtml;
}

// --- INITIALIZE APPLICATION ---
window.onload = function() {
  initDB();
  startClock();
  
  // Set initial route: Login
  switchView("view-login", "login");

  // Check if patient joined direct appointment
  setInterval(() => {
    if (currentRole === "patient" && !activeCall) {
      loadPatientDashboard();
    }
  }, 3000);
};

// --- AGORA REAL WEBRTC INTEGRATION METHODS ---
window.toggleAgoraConfig = function() {
  const configBar = document.getElementById("agora-config-bar");
  if (configBar) {
    configBar.style.display = configBar.style.display === "none" ? "block" : "none";
  }
};

window.saveAgoraConfig = function() {
  const appid = document.getElementById("agora-appid").value.trim();
  const token = document.getElementById("agora-token").value.trim();
  const channel = document.getElementById("agora-channel").value.trim() || "telehealth-room";
  const enabled = document.getElementById("agora-enabled").checked;

  if (enabled && !appid) {
    showToast("Please provide a valid Agora App ID to enable WebRTC.", "warning");
    return;
  }

  agoraConfig = { appid, token, channel, enabled };
  localStorage.setItem("agora_config", JSON.stringify(agoraConfig));
  
  showToast("Agora WebRTC configurations saved successfully!", "success");
  
  // Collapse
  document.getElementById("agora-config-bar").style.display = "none";
};

async function joinAgoraRoom(role) {
  if (typeof AgoraRTC === "undefined") {
    showToast("Agora Web SDK failed to load. Check internet or ad-blocker.", "danger");
    // Graceful fallback
    agoraConfig.enabled = false;
    startCallLoop();
    return;
  }

  showToast(`Connecting Agora RTC: Channel '${agoraConfig.channel}'...`, "info");
  
  try {
    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    // Listen for incoming remote user publishing
    agoraClient.on("user-published", async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType);
      
      if (mediaType === "video") {
        const remoteVideoTrack = user.videoTrack;
        const remoteContainer = document.getElementById(`${role}-remote-video-container`);
        const remoteCanvas = document.getElementById(`${role}-remote-canvas`);
        
        if (remoteContainer && remoteCanvas) {
          remoteCanvas.style.display = "none";
          remoteContainer.style.display = "block";
          remoteContainer.innerHTML = ""; // Clear previous elements
          remoteVideoTrack.play(`${role}-remote-video-container`);
        }
      }
      if (mediaType === "audio") {
        user.audioTrack.play();
      }
      showToast("Remote user connected to Agora session.", "success");
    });

    agoraClient.on("user-unpublished", (user, mediaType) => {
      if (mediaType === "video") {
        const remoteContainer = document.getElementById(`${role}-remote-video-container`);
        const remoteCanvas = document.getElementById(`${role}-remote-canvas`);
        if (remoteContainer && remoteCanvas) {
          remoteContainer.style.display = "none";
          remoteCanvas.style.display = "block";
        }
      }
    });

    // Real-time Bandwidth Quality Hooks
    agoraClient.on("network-quality", (quality) => {
      // 1 Excellent, 2 Good, 3 Poor, 4 Bad, 5 Very Bad, 6 Down
      const downQuality = quality.downlinkNetworkQuality;
      let targetQual = "good";
      
      if (downQuality >= 5) {
        targetQual = "verypoor";
      } else if (downQuality >= 3) {
        targetQual = "poor";
      }

      if (activeCall && activeCall.networkQuality !== targetQual) {
        simulateNetworkChange(targetQual);
        showToast(`Agora network changed to: ${targetQual.toUpperCase()} (Grade ${downQuality})`, "info");
      }
    });

    // Join room
    // Use UID based on role (doctor=1, worker/assistant=2, patient=3)
    const uid = role === "doctor" ? 1 : role === "vhw" ? 2 : 3;
    await agoraClient.join(agoraConfig.appid, agoraConfig.channel, agoraConfig.token || null, uid);

    // Create local audio and video tracks
    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    localAudioTrack = audioTrack;
    localVideoTrack = videoTrack;

    // Play local track in PIP container
    const localContainer = document.getElementById(`${role}-local-video-container`);
    const localCanvas = document.getElementById(`${role}-local-canvas`);
    
    if (localContainer && localCanvas) {
      localCanvas.style.display = "none";
      localContainer.style.display = "block";
      localContainer.innerHTML = ""; // Clear
      localVideoTrack.play(`${role}-local-video-container`);
    }

    // Publish tracks
    await agoraClient.publish([localAudioTrack, localVideoTrack]);
    showToast("Agora stream published! Real video calling active.", "success");

  } catch (err) {
    console.error("Agora WebRTC Error:", err);
    showToast(`Agora Connection Error: ${err.message}. Falling back to simulated feed.`, "danger");
    // fallback
    agoraConfig.enabled = false;
    startCallLoop();
  }
}

async function leaveAgoraRoom() {
  try {
    if (localAudioTrack) {
      localAudioTrack.stop();
      localAudioTrack.close();
      localAudioTrack = null;
    }
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack.close();
      localVideoTrack = null;
    }
    if (agoraClient) {
      await agoraClient.leave();
      agoraClient = null;
    }
    showToast("Agora WebRTC calling channel closed.", "info");
  } catch (err) {
    console.error("Error leaving Agora:", err);
  }
}
