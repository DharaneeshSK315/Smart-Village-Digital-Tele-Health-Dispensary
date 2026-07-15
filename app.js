// Smart Village Tele-Health Dispensary Dashboard Controller
import { supabase } from './supabaseClient.js';

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

function getAgoraRolePrefix(role) {
  if (role === "doctor" || role === "doc") return "doc";
  if (role === "patient" || role === "pat") return "pat";
  if (role === "vhw") return "vhw";
  return role;
}

// Initialize Database
async function initDB() {
  let loadedFromSupabase = false;

  if (supabase) {
    // Listen for real-time authentication state changes (OAuth Redirects)
    try {
      supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session && session.user) {
          const user = session.user;
          const email = user.email;
          const name = user.user_metadata.full_name || user.email.split('@')[0];

          window.googleUser = { name, email };
          const emailLower = email.toLowerCase();
          
          setTimeout(() => {
            const adminsList = (db && db.authConfig && db.authConfig.admins) ? db.authConfig.admins : ["admin@villagemed.in", "admin@gmail.com", "dharaneeshsk.it24@bitsathy.ac.in", "tvillage.admin.demo@gmail.com"];
            const vhwsList = (db && db.authConfig && db.authConfig.vhws) ? db.authConfig.vhws : ["vhw@villagemed.in", "anjali.vhw@gmail.com", "nurse@villagemed.in"];
            const doctorsList = (db && db.doctors) ? db.doctors : [];

            // Direct auto-login based on authorized email constraints
            if (adminsList.includes(emailLower)) {
              currentUser = { name: `Admin ${name}`, role: "Admin", email };
              switchView("view-admin", "admin");
              showToast(`Logged in as Admin: ${currentUser.name}`, "success");
            } else if (vhwsList.includes(emailLower)) {
              currentUser = { name: `Nurse ${name}`, role: "VHW", village: "Village Clinic A", email };
              switchView("view-vhw", "vhw");
              showToast(`Logged in as VHW Nurse: ${currentUser.name}`, "success");
            } else if (emailLower.endsWith("@villagemed.in") || doctorsList.some(d => d.email.toLowerCase() === emailLower)) {
              let doctor = doctorsList.find(d => d.email.toLowerCase() === emailLower);
              if (!doctor) {
                doctor = { id: `doc-${user.id.slice(-4)}`, name: `Dr. ${name}`, specialty: "General Medicine", email, online: true };
                if (db && db.doctors) {
                  db.doctors.push(doctor);
                  saveDB();
                }
              }
              currentUser = doctor;
              switchView("view-doctor", "doctor");
              showToast(`Logged in as Doctor: ${currentUser.name}`, "success");
            } else {
              // Default to Patient
              let patient = (db && db.patients) ? db.patients.find(p => p.phone === email || p.name === name) : null;
              if (!patient) {
                patient = { id: `pat-${user.id.slice(-4)}`, name, age: 30, gender: "Male", phone: email, village: "Village Clinic A", history: [] };
                if (db && db.patients) {
                  db.patients.push(patient);
                  saveDB();
                }
              }
              currentUser = patient;
              switchView("view-patient", "patient");
              showToast(`Logged in as Patient: ${currentUser.name}`, "success");
            }
          }, 800);
        }
      });
    } catch (authErr) {
      console.warn("OAuth Session check error:", authErr);
    }

    try {
      console.log("Supabase connection detected. Fetching data...");
      const [patientsRes, doctorsRes, appointmentsRes, consultationsRes] = await Promise.all([
        supabase.from("patients").select("*"),
        supabase.from("doctors").select("*"),
        supabase.from("appointments").select("*"),
        supabase.from("consultations").select("*")
      ]);

      if (!patientsRes.error && !doctorsRes.error && !appointmentsRes.error && !consultationsRes.error) {
        const localCached = localStorage.getItem("telehealth_db");
        const cachedDb = localCached ? JSON.parse(localCached) : null;
        const localVillages = cachedDb ? cachedDb.villages : DEFAULT_VILLAGES;
        const localLogs = cachedDb ? cachedDb.failoverLogs : DEFAULT_FAILOVER_LOGS;
        const localAuthConfig = cachedDb ? cachedDb.authConfig : {
          admins: ["admin@villagemed.in", "admin@gmail.com", "dharaneeshsk.it24@bitsathy.ac.in", "tvillage.admin.demo@gmail.com"],
          vhws: ["vhw@villagemed.in", "anjali.vhw@gmail.com", "nurse@villagemed.in"]
        };

        if (patientsRes.data.length === 0 && doctorsRes.data.length === 0) {
          console.log("Supabase database is empty. Seeding defaults...");
          db = {
            villages: localVillages,
            doctors: DEFAULT_DOCTORS,
            patients: DEFAULT_PATIENTS,
            appointments: DEFAULT_APPOINTMENTS,
            consultations: DEFAULT_CONSULTATIONS,
            failoverLogs: localLogs,
            authConfig: localAuthConfig
          };
          await saveDB();
        } else {
          db = {
            villages: localVillages,
            doctors: doctorsRes.data.length > 0 ? doctorsRes.data : DEFAULT_DOCTORS,
            patients: patientsRes.data.length > 0 ? patientsRes.data : DEFAULT_PATIENTS,
            appointments: appointmentsRes.data || [],
            consultations: consultationsRes.data || [],
            failoverLogs: localLogs,
            authConfig: localAuthConfig
          };
        }
        loadedFromSupabase = true;
        console.log("Data successfully loaded from Supabase.");
      } else {
        console.warn("Error fetching from Supabase, falling back to localStorage.", {
          patients: patientsRes.error,
          doctors: doctorsRes.error,
          appointments: appointmentsRes.error,
          consultations: consultationsRes.error
        });
      }
    } catch (err) {
      console.error("Failed to connect to Supabase, falling back to localStorage:", err);
    }
  }

  if (!loadedFromSupabase) {
    console.log("Running in offline/local storage fallback mode.");
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
  }

  // Guarantee arrays exist to prevent schema discrepancy crashes
  db.villages = db.villages || DEFAULT_VILLAGES;
  db.doctors = db.doctors || DEFAULT_DOCTORS;
  db.patients = db.patients || DEFAULT_PATIENTS;
  db.appointments = db.appointments || DEFAULT_APPOINTMENTS;
  db.consultations = db.consultations || DEFAULT_CONSULTATIONS;
  db.failoverLogs = db.failoverLogs || DEFAULT_FAILOVER_LOGS;
  db.authConfig = db.authConfig || {
    admins: ["admin@villagemed.in", "admin@gmail.com", "dharaneeshsk.it24@bitsathy.ac.in", "tvillage.admin.demo@gmail.com"],
    vhws: ["vhw@villagemed.in", "anjali.vhw@gmail.com", "nurse@villagemed.in"]
  };

  // Sync across tabs/windows so view updates when appointments change.
  window.addEventListener("storage", (event) => {
    if (event.key !== "telehealth_db" || !event.newValue) return;
    const updatedDb = JSON.parse(event.newValue);
    if (!updatedDb || !Array.isArray(updatedDb.appointments)) return;

    db.appointments = updatedDb.appointments;
    if (currentRole === "patient") {
      loadPatientDashboard();
    } else if (currentRole === "doctor") {
      loadDoctorDashboard();
    } else if (currentRole === "vhw") {
      loadVhwDashboard();
    }
  });
  
  // Force upgrade cache if demo email is missing from admins list
  if (!db.authConfig.admins.includes("tvillage.admin.demo@gmail.com")) {
    db.authConfig.admins.push("tvillage.admin.demo@gmail.com");
    saveDB();
  }

  db.recordings = db.recordings || [];

  // Load Agora Config
  agoraConfig = JSON.parse(localStorage.getItem("agora_config"));
  if (!agoraConfig || !agoraConfig.appid) {
    agoraConfig = { enabled: true, appid: "aab8b3f972274fcb87cc25048d089e94", token: "", channel: "telehealth-room" };
    localStorage.setItem("agora_config", JSON.stringify(agoraConfig));
  }
  
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

async function saveDB(tableName = null) {
  // Always update local cache instantly for smooth UI
  localStorage.setItem("telehealth_db", JSON.stringify(db));

  if (supabase) {
    if (!window.isNetworkOnline) {
      console.log("Device is Offline. Consultation saved locally. Will sync when Online.");
      // Record pending sync
      let pending = JSON.parse(localStorage.getItem("pending_syncs")) || {};
      if (tableName) {
        pending[tableName] = true;
      } else {
        pending.patients = true;
        pending.doctors = true;
        pending.appointments = true;
        pending.consultations = true;
      }
      localStorage.setItem("pending_syncs", JSON.stringify(pending));
      return;
    }

    try {
      if (tableName === "patients" || !tableName) {
        await supabase.from("patients").upsert(db.patients);
      }
      if (tableName === "doctors" || !tableName) {
        await supabase.from("doctors").upsert(db.doctors);
      }
      if (tableName === "appointments" || !tableName) {
        await supabase.from("appointments").upsert(db.appointments);
      }
      if (tableName === "consultations" || !tableName) {
        await supabase.from("consultations").upsert(db.consultations);
      }
      console.log(`Supabase synced successfully: ${tableName || 'all tables'}`);
    } catch (err) {
      console.error("Supabase sync failed, caching locally for auto-retry:", err);
      let pending = JSON.parse(localStorage.getItem("pending_syncs")) || {};
      if (tableName) pending[tableName] = true;
      else { pending.patients = true; pending.doctors = true; pending.appointments = true; pending.consultations = true; }
      localStorage.setItem("pending_syncs", JSON.stringify(pending));
    }
  }
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
    currentUser = (db.patients && db.patients.length > 0) ? db.patients[0] : { id: "pat-1", name: "Sarah Mitchell", age: 67, gender: "Female", phone: "9876543210", village: "Village Clinic A", history: [] };
  } else if (role === "vhw") {
    currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A" };
  } else if (role === "doctor") {
    currentUser = (db.doctors && db.doctors.length > 0) ? db.doctors[0] : { id: "doc-1", name: "Dr. Vikram", specialty: "General Medicine", email: "doc.vikram@villagemed.in", password: "password", online: true };
  } else if (role === "admin") {
    currentUser = { name: "System Admin", role: "Admin" };
  }
  switchView(`view-${role}`, role);
};

window.logout = function() {
  currentUser = null;
  currentRole = "guest";
  document.getElementById("header-user-profile").style.display = "none";
  
  if (supabase) {
    supabase.auth.signOut().then(() => {
      console.log("Logged out of Supabase session.");
    });
  }
  
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
window.handleLogin = async function(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const role = document.getElementById("login-role").value;

  const AUTHORIZED_ADMINS = db.authConfig.admins;
  const AUTHORIZED_VHWS = db.authConfig.vhws;

  // 1. Authorize Admin
  if (role === "admin" && !AUTHORIZED_ADMINS.includes(email.toLowerCase())) {
    showToast("Unauthorized: This email is not registered as an Administrator.", "danger");
    return;
  }
  // 2. Authorize VHW
  if (role === "vhw" && !AUTHORIZED_VHWS.includes(email.toLowerCase())) {
    showToast("Unauthorized: This email is not registered as a VHW Nurse.", "danger");
    return;
  }
  // 3. Authorize Doctor
  if (role === "doctor" && !email.toLowerCase().endsWith("@villagemed.in") && !db.doctors.some(d => d.email.toLowerCase() === email.toLowerCase())) {
    showToast("Unauthorized: This email is not registered as a Medical Doctor.", "danger");
    return;
  }

  if (supabase) {
    showToast("Authenticating credentials...", "info");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) {
        console.warn("Supabase auth failed", error);

        // Fallback to local demo accounts when Supabase login is not configured or user is not registered remotely
        if (role === "doctor") {
          const doctor = db.doctors.find(d => d.email.toLowerCase() === email.toLowerCase());
          if (doctor && doctor.password === password) {
            currentUser = doctor;
            switchView("view-doctor", "doctor");
            showToast(`Welcome back, ${doctor.name} (Local Demo Login)`, "success");
            return;
          }
        } else if (role === "patient") {
          const patient = db.patients.find(p => p.phone === email || p.name.toLowerCase().includes(email.toLowerCase()));
          if (patient) {
            currentUser = patient;
            switchView("view-patient", "patient");
            showToast(`Logged in as patient: ${patient.name} (Local Demo Login)`, "success");
            return;
          }
        } else if (role === "vhw") {
          if (AUTHORIZED_VHWS.includes(email.toLowerCase())) {
            currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A", email };
            switchView("view-vhw", "vhw");
            showToast("VHW Nurse Console authenticated (Local Demo Login)", "success");
            return;
          }
        } else if (role === "admin") {
          if (AUTHORIZED_ADMINS.includes(email.toLowerCase())) {
            currentUser = { name: "System Admin", role: "Admin", email };
            switchView("view-admin", "admin");
            showToast("Admin Console authenticated (Local Demo Login)", "success");
            return;
          }
        }

        showToast(`Authentication Failed: ${error.message}`, "danger");
        return;
      }

      const user = data.user;

      if (role === "doctor") {
        const doctor = db.doctors.find(d => d.email === email);
        if (doctor) {
          currentUser = doctor;
          switchView("view-doctor", "doctor");
          showToast(`Welcome back, ${doctor.name}`, "success");
        } else {
          // Auto-generate doctor profile if authenticated in Supabase Auth
          const name = email.split('@')[0];
          const newDoc = { id: `doc-${user.id.slice(-4)}`, name: `Dr. ${name}`, specialty: "General Medicine", email, online: true };
          db.doctors.push(newDoc);
          saveDB();
          currentUser = newDoc;
          switchView("view-doctor", "doctor");
          showToast(`Signed in as Doctor: ${name}`, "success");
        }
      } else if (role === "vhw") {
        currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A", email };
        switchView("view-vhw", "vhw");
        showToast("VHW Nurse Console authenticated", "success");
      } else if (role === "patient") {
        const patient = db.patients.find(p => p.phone === email || p.name.toLowerCase().includes(email.toLowerCase()));
        if (patient) {
          currentUser = patient;
          switchView("view-patient", "patient");
          showToast(`Logged in as patient: ${patient.name}`, "success");
        } else {
          const newPat = { id: `pat-${user.id.slice(-4)}`, name: email.split('@')[0], age: 30, gender: "Male", phone: email, village: "Village Clinic A", history: [] };
          db.patients.push(newPat);
          saveDB();
          currentUser = newPat;
          switchView("view-patient", "patient");
          showToast(`Logged in as patient: ${newPat.name}`, "success");
        }
      } else if (role === "admin") {
        currentUser = { name: "System Admin", role: "Admin", email };
        switchView("view-admin", "admin");
        showToast("Admin Console authenticated", "success");
      }
    } catch (err) {
      showToast(`Login Error: ${err.message}`, "danger");
    }
  } else {
    // Offline local fallback logic (no real password check)
    if (role === "doctor") {
      const doctor = db.doctors.find(d => d.email === email);
      if (doctor) {
        currentUser = doctor;
        switchView("view-doctor", "doctor");
        showToast(`Welcome back, ${doctor.name} (Offline Mode)`, "success");
      } else {
        showToast("Doctor account not found in local cache", "danger");
      }
    } else if (role === "vhw") {
      currentUser = { name: "Nurse Anjali", role: "VHW", village: "Village Clinic A" };
      switchView("view-vhw", "vhw");
      showToast("VHW Nurse Console authenticated (Offline Mode)", "success");
    } else if (role === "patient") {
      const patient = db.patients.find(p => p.phone === email || p.name.toLowerCase().includes(email.toLowerCase()));
      if (patient) {
        currentUser = patient;
        switchView("view-patient", "patient");
        showToast(`Logged in as patient: ${patient.name} (Offline Mode)`, "success");
      } else {
        const newPat = { id: `pat-${Date.now()}`, name: email, age: 30, gender: "Male", phone: email, village: "Village Clinic A", history: [] };
        db.patients.push(newPat);
        saveDB();
        currentUser = newPat;
        switchView("view-patient", "patient");
        showToast(`New offline patient registered: ${email}`, "success");
      }
    } else if (role === "admin") {
      currentUser = { name: "System Admin", role: "Admin" };
      switchView("view-admin", "admin");
      showToast("Admin Console authenticated (Offline Mode)", "success");
    }
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
    waitVal.innerText = queueIndex >= 0 ? `${(queueIndex + 1) * 12} mins` : activeApp.status === "Active" ? "In Call" : "Pending";
    
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

  // Load Digital Health ID Card details
  const qrImg = document.getElementById("pat-qr-code-img");
  const cardName = document.getElementById("pat-card-name");
  const cardId = document.getElementById("pat-card-id");
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${currentUser.id}`;
  if (cardName) cardName.innerText = currentUser.name;
  if (cardId) cardId.innerText = `ID: ${currentUser.id}`;

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
        buttonHtml = `
          <button class="btn-action success" onclick="openVitalsModal('${p.id}', false)">🩺 Record Vitals</button>
          <button class="btn-action" style="background:#4f46e5; color:white;" onclick="openVitalsModal('${p.id}', true)">🏡 Home Visit</button>
        `;
      } else if (activeApp.status === "Active") {
        buttonHtml = `<button class="btn-action" style="background-color:var(--primary); color:white;" onclick="joinVhwCall('${activeApp.token}')">🎥 Join Consultation</button>`;
      } else {
        buttonHtml = `<span class="badge badge-info">Token: ${activeApp.token}</span>`;
      }
    } else {
      buttonHtml = `
        <button class="btn-action success" onclick="openVitalsModal('${p.id}', false)">🎫 Dispatch Token</button>
        <button class="btn-action" style="background:#4f46e5; color:white;" onclick="openVitalsModal('${p.id}', true)">🏡 Home Visit</button>
      `;
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

window.openVitalsModal = function(patientId, isHomeVisit = false) {
  const p = db.patients.find(pat => pat.id === patientId);
  if (!p) return;

  window.isHomeVisitCapture = isHomeVisit;
  document.getElementById("vitals-pat-id").value = patientId;
  document.getElementById("vitals-modal-title").innerText = isHomeVisit ? `🏡 Register Home Visit Vitals for ${p.name}` : `Log Vitals for ${p.name}`;
  
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
    db.appointments[appIndex].isHomeVisit = window.isHomeVisitCapture || false;
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
      vitals,
      isHomeVisit: window.isHomeVisitCapture || false
    });
  }

  // Intercept vital limits for emergency alert escalation
  const isEmergency = vitals.spo2 < 90 || vitals.bpSystolic > 180 || vitals.hr > 130;
  
  if (appIndex >= 0) {
    if (isEmergency) db.appointments[appIndex].urgency = "Emergency";
  } else {
    if (isEmergency) db.appointments[db.appointments.length - 1].urgency = "Emergency";
  }

  saveDB();
  closeVitalsModal();
  
  if (isEmergency) {
    window.triggerEmergencyAlert(p ? p.name : "Patient", vitals, appIndex >= 0 ? db.appointments[appIndex].token : db.appointments[db.appointments.length - 1].token);
  } else {
    showToast(`Vitals recorded! Patient placed in ${specialty} Queue. Triage level: ${triage.flag}`, triage.flag === "Critical" ? "danger" : "success");
  }
  
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

  // Include both triaged patients and new bookings waiting for vitals
  const myQueue = db.appointments.filter(a => a.assignedDoctorId === currentUser.id && (a.vitals !== null || a.status === "Waiting"));
  document.getElementById("doc-stat-queue").innerText = `${myQueue.length} Waiting`;

  let criticalCount = 0;
  myQueue.forEach(q => {
    if (q.vitals) {
      const triage = evaluateTriageUrgency(q.vitals);
      if (triage.flag === "Critical") criticalCount++;
    }
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

  let list = db.appointments.filter(a => a.assignedDoctorId === currentUser.id && (a.vitals !== null || a.status === "Waiting" || a.status === "Active"));

  // Sorting: Active -> Emergency -> Critical (Urgency Score High) -> High Warning -> Normal
  list.sort((a, b) => {
    if (a.urgency === "Emergency" && b.urgency !== "Emergency") return -1;
    if (b.urgency === "Emergency" && a.urgency !== "Emergency") return 1;
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
    const triage = a.vitals ? evaluateTriageUrgency(a.vitals) : { flag: "Awaiting Vitals", score: 0 };
    
    let triageBadge = `<span class="badge badge-warning">Awaiting Vitals</span>`;
    if (a.urgency === "Emergency") triageBadge = `<span class="badge badge-critical" style="background:#dc2626; box-shadow: 0 0 8px #dc2626;">🚨 EMERGENCY</span>`;
    else if (a.vitals && triage.flag === "Critical") triageBadge = `<span class="badge badge-critical">🚨 Critical</span>`;
    else if (a.vitals && triage.flag === "High Warning") triageBadge = `<span class="badge badge-warning">⚠️ High</span>`;
    else if (a.vitals && triage.flag === "Normal") triageBadge = `<span class="badge badge-success">Normal</span>`;

    const vitalsStr = a.vitals ? `BP: ${a.vitals.bpSystolic}/${a.vitals.bpDiastolic} | SpO2: ${a.vitals.spo2}% | HR: ${a.vitals.hr} | Temp: ${a.vitals.temp}°C` : "Vitals pending";

    const homeVisitBadge = a.isHomeVisit ? `<span class="badge" style="background:#4f46e5; color:white; font-size:9px; margin-left:6px; vertical-align:middle;">🏡 Home Visit</span>` : "";

    const tr = document.createElement("tr");
    tr.className = a.urgency === "Emergency" ? "queue-row emergency-high" : "queue-row";
    tr.innerHTML = `
      <td><strong>${a.token}</strong></td>
      <td><strong>${p ? p.name : "Unknown"}</strong>${homeVisitBadge}</td>
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
  excellent: { label: "Excellent (1080p HD)", resolution: "1080p", bars: 4, bitrate: "6.2 Mbps", latency: "18 ms", class: "excellent-signal", pixelSize: 1, filter: "none", fps: 30 },
  good:      { label: "Good (720p HD)",      resolution: "720p",  bars: 4, bitrate: "3.1 Mbps", latency: "45 ms", class: "good-signal",      pixelSize: 2, filter: "blur(1px) contrast(105%)", fps: 30 },
  fair:      { label: "Fair (480p SD)",      resolution: "480p",  bars: 3, bitrate: "1.2 Mbps", latency: "85 ms", class: "fair-signal",      pixelSize: 4, filter: "blur(2px) contrast(115%)", fps: 28 },
  poor:      { label: "Poor (360p Low-Res)", resolution: "360p",  bars: 2, bitrate: "450 Kbps", latency: "160 ms", class: "poor-signal",     pixelSize: 8, filter: "blur(4px) contrast(125%)", fps: 20 },
  verypoor:  { label: "Very Poor (240p)",    resolution: "240p",  bars: 1, bitrate: "180 Kbps", latency: "290 ms", class: "very-poor-signal", pixelSize: 14, filter: "blur(7px) contrast(135%)", fps: 12 },
  critical:  { label: "Critical (Audio)",    resolution: "Audio", bars: 0, bitrate: "35 Kbps",  latency: "460 ms", class: "critical-signal",  pixelSize: 0, filter: "none", fps: 0 }
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
    networkQuality: "excellent",
    autoFluctuate: false,
    micActive: true,
    camActive: true,
    aiPredicting: false,
    chat: [
      { sender: "system", text: "Encrypted rural tele-health session established." },
      { sender: "worker", text: `Hello ${doctor.name}, Nurse Anjali here assisting ${patient.name}. Vitals have been synchronized.` }
    ],
    files: [
      { name: "Clinical Vitals Record.pdf", size: "45 KB", type: "pdf" }
    ],
    animationFrameId: null,
    telemetryInterval: null
  };

  // Add wound image if VHW uploaded one
  if (app.vitals && app.vitals.photo) {
    activeCall.files.push({ name: app.vitals.photo, size: "1.2 MB", type: "image" });
  }

  // Set active in DB
  const idx = db.appointments.findIndex(a => a.token === token);
  if (idx >= 0) db.appointments[idx].status = "Active";
  saveDB();

  // Start Telemetry Fluctuation Loop
  startTelemetryFluctuations();
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
  if (!activeApp) {
    showToast("No active video session found yet. Please wait for the doctor to start the consultation.", "warning");
    return;
  }

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
  const agoraPrefix = getAgoraRolePrefix(role);
  const mainCanvas = document.getElementById(`${agoraPrefix}-remote-canvas`);
  const pipCanvas = document.getElementById(`${agoraPrefix}-local-canvas`);
  const remoteContainer = document.getElementById(`${agoraPrefix}-remote-video-container`);
  const localContainer = document.getElementById(`${agoraPrefix}-local-video-container`);

  if (!mainCanvas || !pipCanvas) {
    console.error(`Agora call UI elements missing for role='${role}' prefix='${agoraPrefix}'`);
    return;
  }

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
  const role = getAgoraRolePrefix(activeCall.role);
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
  const role = getAgoraRolePrefix(activeCall.role);
  const container = document.getElementById(`${role}-call-files-box`);
  if (!container) return;
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

    // Apply adaptive downsampling
    const activeQuality = activeCall.networkQuality;
    const state = NETWORK_STATES[activeQuality];
    let pixelSize = state ? state.pixelSize : 1;
    
    // Force proactive downscale during AI predictions
    if (activeCall.aiPredicting) {
      pixelSize = 14; 
    }
    
    if (pixelSize > 1) {
      pixelateCanvas(remoteCanvas, remoteCtx, pixelSize);
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
// Global prediction countdown holder
let predictionCountdownTimer = null;

window.simulateNetworkChange = function(quality) {
  if (!activeCall) return;

  // Clear any existing prediction countdowns
  if (predictionCountdownTimer) {
    clearTimeout(predictionCountdownTimer);
    predictionCountdownTimer = null;
  }
  activeCall.aiPredicting = false;
  toggleAIBadges(false);

  const current = activeCall.networkQuality;
  
  // Feature 1: AI Predictor triggers if we are going from good signal (excellent/good/fair) to critical (audio)
  const isDropToCritical = (quality === "critical" && current !== "critical");
  
  if (isDropToCritical) {
    activeCall.aiPredicting = true;
    toggleAIBadges(true);
    
    // Proactively apply resolution blur filter on CSS for real WebRTC and canvas downscaling
    const roles = ["pat", "vhw", "doc"];
    roles.forEach(r => {
      const remoteContainer = document.getElementById(`${r}-remote-video-container`);
      if (remoteContainer) remoteContainer.style.filter = "blur(7px) contrast(135%)";
    });

    showToast("🧠 AI Predictor: Connection drop expected in 5s! Proactively reducing resolution to 240p.", "warning");
    activeCall.chat.push({ 
      sender: "system", 
      text: "🧠 AI Network Predictor: Connection degradation predicted in 5s. Proactively reducing resolution to sustain link." 
    });
    syncChatBox();

    // Set 5-second countdown to complete the switch
    predictionCountdownTimer = setTimeout(() => {
      activeCall.aiPredicting = false;
      toggleAIBadges(false);
      activeCall.networkQuality = "critical";
      
      // Log in DB
      db.failoverLogs.audio++;
      saveDB();
      
      updateNetworkUI();
    }, 5000);

  } else {
    // Standard direct transition
    activeCall.networkQuality = quality;
    
    // Log in DB
    if (quality === "excellent" || quality === "good") db.failoverLogs.hd++;
    else if (quality === "critical") db.failoverLogs.audio++;
    else db.failoverLogs.low++;
    
    saveDB();
    updateNetworkUI();
  }
};

function toggleAIBadges(show) {
  const roles = ["pat", "vhw", "doc"];
  roles.forEach(r => {
    const el = document.getElementById(`${r}-ai-badge`);
    if (el) el.style.display = show ? "inline-flex" : "none";
  });
}

function updateNetworkUI() {
  const state = NETWORK_STATES[activeCall.networkQuality];
  const role = getAgoraRolePrefix(activeCall.role);

  // Text status
  const connText = document.getElementById(`${role}-conn-text`);
  if (connText) connText.innerText = `${state.resolution} ${state.label}`;

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

  if (activeCall.networkQuality === "critical") {
    if (fallback) fallback.style.display = "flex";
    if (remoteCanvas) remoteCanvas.style.opacity = 0;
    if (remoteContainer) remoteContainer.style.opacity = 0;

    // If Agora is active, disable local video track to save bandwidth
    if (agoraConfig.enabled && localVideoTrack) {
      localVideoTrack.setEnabled(false);
    }
    
    // Set initials in fallback
    const originalRole = activeCall.role;
    const remoteInitials = document.getElementById(originalRole === "doctor" ? "doc-patient-initials" : `${getAgoraRolePrefix(originalRole)}-doctor-initials`);
    if (remoteInitials) {
      const name = originalRole === "doctor" ? activeCall.patient.name : activeCall.doctor.name;
      remoteInitials.innerText = name.split(" ").map(n => n[0]).join("");
    }

    // Auto switch to chat tab since video has shut off
    switchCallTab(role, "chat");

    showToast("Bandwidth Critically low! Automatically switching to audio + medical chat.", "danger");
    activeCall.chat.push({ sender: "system", text: "Automatic Failover: switched to audio-only due to 35Kbps restriction." });
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

    // Re-enable Agora video track if we move back from critical
    if (agoraConfig.enabled && localVideoTrack && activeCall.camActive) {
      localVideoTrack.setEnabled(true);
    }

    // Apply CSS filters on real video container to match adaptive resolutions
    if (remoteContainer) {
      remoteContainer.style.filter = state.filter;
    }
    
    if (activeCall.networkQuality !== "excellent") {
      showToast(`Bandwidth restricted. Adjusting video resolution to ${state.resolution} quality.`, "warning");
      activeCall.chat.push({ sender: "system", text: `Network Quality: adjusted to ${state.resolution} (${state.bitrate})` });
      syncChatBox();
    } else {
      showToast("Bandwidth recovered. Restoring HD video quality.", "success");
    }
  }

  // Sync controls state
  const selSelect = document.getElementById(`${role}-net-sim`);
  if (selSelect) selSelect.value = activeCall.networkQuality;

  if (role === "doc") {
    const label = document.getElementById("doc-network-lbl");
    if (label) label.innerText = state.resolution + " " + state.label;
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

  const sender = role === "doctor" || role === "doc" ? "doctor" : "worker";
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
  const roles = ["pat", "vhw", "doc"];
  
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
    if (localAudioTrack) {
      localAudioTrack.setEnabled(true);
      console.info("Agora local audio unmuted");
    }
    showToast("Microphone unmuted", "info");
  } else {
    btn.classList.remove("active");
    btn.innerText = "🔇";
    if (localAudioTrack) {
      localAudioTrack.setEnabled(false);
      console.info("Agora local audio muted");
    }
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
    if (localVideoTrack) {
      localVideoTrack.setEnabled(true);
      console.info("Agora local video enabled");
    }
    showToast("Webcam enabled", "info");
  } else {
    btn.classList.remove("active");
    btn.innerText = "📵";
    if (localVideoTrack) {
      localVideoTrack.setEnabled(false);
      console.info("Agora local video disabled");
    }
    showToast("Webcam disabled", "warning");
  }
};

window.leaveConsultation = function() {
  if (!activeCall) return;

  if (window.isRecordingActive) {
    window.stopCallRecording();
  }

  if (activeCall.animationFrameId) {
    cancelAnimationFrame(activeCall.animationFrameId);
  }
  if (fluctuationTimer) {
    clearInterval(fluctuationTimer);
  }
  if (activeCall.telemetryInterval) {
    clearInterval(activeCall.telemetryInterval);
  }
  if (predictionCountdownTimer) {
    clearTimeout(predictionCountdownTimer);
    predictionCountdownTimer = null;
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
  renderAdminRecordings();
  renderAdminRbac();

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
    let statusBadge = `<span class="badge badge-success">Online</span>`;
    
    if (v.includes("Clinic A") || v === "Village A") {
      statusBadge = `<span class="badge badge-success" style="background:#10b981; border:none;">Online (Excellent: 98%)</span>`;
    } else if (v.includes("Clinic B") || v === "Village B") {
      statusBadge = `<span class="badge badge-critical" style="background:#ef4444; border:none;">Online (Poor: 42%)</span>`;
    } else if (v.includes("Clinic C") || v === "Village C") {
      statusBadge = `<span class="badge badge-warning" style="background:#f59e0b; border:none;">Online (Medium: 65%)</span>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${v}</strong></td>
      <td>${statusBadge}</td>
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

window.adminAddDoctor = async function(e) {
  e.preventDefault();
  const name = document.getElementById("adm-doc-name").value.trim();
  const email = document.getElementById("adm-doc-email").value.trim().toLowerCase();
  const specialty = document.getElementById("adm-doc-specialty").value;
  const password = document.getElementById("adm-doc-password").value;
  const id = `doc-${Date.now().toString().slice(-4)}`;

  // Register in Supabase Authentication if connected
  if (supabase) {
    showToast("Creating Doctor login credentials...", "info");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: name
          }
        }
      });
      if (error) {
        showToast(`Supabase registration failed: ${error.message}`, "danger");
        return;
      }
      showToast("Credentials registered successfully!", "success");
    } catch (authErr) {
      console.warn("Supabase Auth signUp error:", authErr);
    }
  }

  const newDoc = {
    id,
    name,
    specialty,
    email,
    password,
    online: true
  };

  db.doctors.push(newDoc);
  saveDB();
  
  // Clear inputs
  document.getElementById("adm-doc-name").value = "";
  document.getElementById("adm-doc-email").value = "";
  document.getElementById("adm-doc-password").value = "";
  
  showToast(`Doctor ${name} onboarded`, "success");
  loadAdminDashboard();
};

window.adminDeleteDoctor = function(idx) {
  const doc = db.doctors[idx];
  db.doctors.splice(idx, 1);

  if (supabase) {
    supabase.from("doctors").delete().eq("id", doc.id).then(({ error }) => {
      if (error) console.error("Error deleting doctor from Supabase:", error);
      else console.log("Doctor deleted from Supabase successfully");
    });
  }

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
  
  // Set initial route: Only go to Login if we are NOT returning from a Google redirect
  const hasOAuthCallback = window.location.hash.includes("access_token=") || 
                           window.location.search.includes("code=") || 
                           window.location.hash.includes("error=");
                           
  if (!hasOAuthCallback) {
    switchView("view-login", "login");
  }

  // Check if patient joined direct appointment
  setInterval(() => {
    if (currentRole === "patient" && !activeCall) {
      loadPatientDashboard();
    }
  }, 3000);
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
};

async function joinAgoraRoom(role) {
  if (typeof AgoraRTC === "undefined") {
    showToast("Agora Web SDK failed to load. Check internet or ad-blocker.", "danger");
    // Graceful fallback
    agoraConfig.enabled = false;
    startCallLoop();
    return;
  }

  const agoraPrefix = getAgoraRolePrefix(role);
  showToast(`Connecting Agora RTC: Channel '${agoraConfig.channel}'...`, "info");
  console.info("Agora client initializing for role:", role, "prefix:", agoraPrefix);
  
  try {
    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    console.info("Agora client initialized");

    // Listen for incoming remote user publishing
    agoraClient.on("user-published", async (user, mediaType) => {
      console.info("Agora user-published event received", { uid: user.uid, mediaType });
      try {
        await agoraClient.subscribe(user, mediaType);
        console.info("Agora subscribed to remote user", { uid: user.uid, mediaType });
      } catch (subscribeErr) {
        console.error("Agora subscribe failed:", subscribeErr);
        return;
      }
      
      if (mediaType === "video") {
        const remoteVideoTrack = user.videoTrack;
        const remoteContainer = document.getElementById(`${agoraPrefix}-remote-video-container`);
        const remoteCanvas = document.getElementById(`${agoraPrefix}-remote-canvas`);
        
        if (remoteContainer && remoteCanvas) {
          remoteCanvas.style.display = "none";
          remoteContainer.style.display = "block";
          remoteContainer.innerHTML = ""; // Clear previous elements
          remoteVideoTrack.play(`${agoraPrefix}-remote-video-container`);
          console.info("Agora remote video subscribed and playing", { uid: user.uid });
        }
      }
      if (mediaType === "audio") {
        try {
          user.audioTrack.play();
          console.info("Agora remote audio playing", { uid: user.uid });
        } catch (audioErr) {
          console.error("Agora remote audio play failed:", audioErr);
        }
      }
      showToast("Remote user connected to Agora session.", "success");
    });

    agoraClient.on("user-unpublished", (user, mediaType) => {
      console.info("Agora user-unpublished event", { uid: user.uid, mediaType });
      if (mediaType === "video") {
        const remoteContainer = document.getElementById(`${agoraPrefix}-remote-video-container`);
        const remoteCanvas = document.getElementById(`${agoraPrefix}-remote-canvas`);
        if (remoteContainer && remoteCanvas) {
          remoteContainer.style.display = "none";
          remoteCanvas.style.display = "block";
        }
      }
    });

    agoraClient.on("user-left", (user) => {
      console.info("Agora user-left event", { uid: user.uid });
      const remoteContainer = document.getElementById(`${agoraPrefix}-remote-video-container`);
      const remoteCanvas = document.getElementById(`${agoraPrefix}-remote-canvas`);
      if (remoteContainer && remoteCanvas) {
        remoteContainer.style.display = "none";
        remoteCanvas.style.display = "block";
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
    console.info("Agora channel joined successfully", { channel: agoraConfig.channel, uid });

    // Create local audio and video tracks
    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    localAudioTrack = audioTrack;
    localVideoTrack = videoTrack;
    console.info("Agora local microphone and camera tracks created");

    // Play local track in PIP container
    const localContainer = document.getElementById(`${agoraPrefix}-local-video-container`);
    const localCanvas = document.getElementById(`${agoraPrefix}-local-canvas`);
    
    if (localContainer && localCanvas) {
      localCanvas.style.display = "none";
      localContainer.style.display = "block";
      localContainer.innerHTML = ""; // Clear
      localVideoTrack.play(`${agoraPrefix}-local-video-container`);
      console.info("Agora local video track playing", { role, container: `${agoraPrefix}-local-video-container` });
    }

    // Publish tracks
    await agoraClient.publish([localAudioTrack, localVideoTrack]);
    console.info("Agora local tracks published successfully");
    showToast("Agora stream published! Real video calling active.", "success");

  } catch (err) {
    console.error("Agora WebRTC Error:", err);
    if (err.code === "MEDIUM_NOT_SUPPORTED" || err.message?.includes("permission")) {
      console.warn("Agora permission issue detected", err);
    }
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

// --- FEATURE 2 & 3: LIVE TELEMETRY FLUCTUATIONS ---
function startTelemetryFluctuations() {
  if (!activeCall) return;
  if (activeCall.telemetryInterval) clearInterval(activeCall.telemetryInterval);

  activeCall.telemetryInterval = setInterval(() => {
    if (!activeCall) return;

    const qual = activeCall.networkQuality;
    const state = NETWORK_STATES[qual];
    if (!state) return;

    // Calculate randomized fluctuations
    let latency = parseInt(state.latency);
    let upload = parseFloat(state.bitrate);
    let download = upload * 1.1; 
    let loss = 0;
    let fps = state.fps;

    if (qual === "excellent") {
      latency += Math.floor(Math.random() * 5) - 2; 
      loss = (Math.random() * 0.4).toFixed(1);
      upload = (2.6 + Math.random() * 0.5).toFixed(1);
      download = (2.9 + Math.random() * 0.6).toFixed(1);
    } else if (qual === "good") {
      latency += Math.floor(Math.random() * 10) - 5;
      loss = (0.5 + Math.random() * 0.8).toFixed(1);
      upload = (1.8 + Math.random() * 0.4).toFixed(1);
      download = (2.1 + Math.random() * 0.5).toFixed(1);
    } else if (qual === "fair") {
      latency += Math.floor(Math.random() * 15) - 7;
      loss = (1.5 + Math.random() * 1.5).toFixed(1);
      upload = (0.9 + Math.random() * 0.3).toFixed(1);
      download = (1.1 + Math.random() * 0.4).toFixed(1);
    } else if (qual === "poor") {
      latency += Math.floor(Math.random() * 20) - 10;
      loss = (4.0 + Math.random() * 4.0).toFixed(1);
      upload = (280 + Math.floor(Math.random() * 80)) + " Kbps"; 
      download = (310 + Math.floor(Math.random() * 90)) + " Kbps";
    } else if (qual === "verypoor" || activeCall.aiPredicting) {
      latency = (activeCall.aiPredicting ? 180 : 290) + Math.floor(Math.random() * 30) - 15;
      loss = (activeCall.aiPredicting ? 6.2 : 12.5 + Math.random() * 5).toFixed(1);
      fps = activeCall.aiPredicting ? 18 : 12;
      upload = (activeCall.aiPredicting ? "850 Kbps" : (120 + Math.floor(Math.random() * 40)) + " Kbps");
      download = (activeCall.aiPredicting ? "980 Kbps" : (140 + Math.floor(Math.random() * 50)) + " Kbps");
    } else if (qual === "critical") {
      latency += Math.floor(Math.random() * 50) - 25;
      loss = (22.0 + Math.random() * 6).toFixed(1);
      upload = (25 + Math.floor(Math.random() * 15)) + " Kbps";
      download = (30 + Math.floor(Math.random() * 20)) + " Kbps";
    }

    if (typeof upload === "number") upload = upload + " Mbps";
    if (typeof download === "number") download = download + " Mbps";

    // Update DOM
    const roles = ["pat", "vhw", "doc"];
    roles.forEach(r => {
      const latEl = document.getElementById(`${r}-hud-latency`);
      const lossEl = document.getElementById(`${r}-hud-loss`);
      const fpsEl = document.getElementById(`${r}-hud-fps`);
      const upEl = document.getElementById(`${r}-hud-upload`);
      const downEl = document.getElementById(`${r}-hud-download`);
      const predEl = document.getElementById(`${r}-hud-prediction`);
      const recEl = document.getElementById(`${r}-hud-rec`);

      if (latEl) latEl.innerText = latency + " ms";
      if (lossEl) lossEl.innerText = loss + "%";
      if (fpsEl) fpsEl.innerText = fps;
      if (upEl) upEl.innerText = upload;
      if (downEl) downEl.innerText = download;

      if (predEl) {
        if (activeCall.aiPredicting) {
          predEl.innerText = "PENDING DROP";
          predEl.className = "pred-warn";
        } else if (qual === "excellent" || qual === "good") {
          predEl.innerText = "GOOD";
          predEl.className = "pred-good";
        } else if (qual === "fair" || qual === "poor") {
          predEl.innerText = "FAIR";
          predEl.className = "pred-warn";
        } else {
          predEl.innerText = "CRITICAL";
          predEl.className = "pred-danger";
        }
      }

      if (recEl) {
        if (activeCall.aiPredicting) {
          recEl.innerText = "Reduce Resolution (Proactive)";
        } else {
          recEl.innerText = state.label;
        }
      }
    });
  }, 1500);
}

// --- FEATURE 4: EMERGENCY ALERT SYSTEM ---
window.triggerEmergencyAlert = function(patientName, vitals, token) {
  // Show red banner
  document.getElementById("emergency-pat-name").innerText = patientName;
  document.getElementById("emergency-spo2").innerText = vitals.spo2;
  document.getElementById("emergency-bp").innerText = vitals.bpSystolic;
  document.getElementById("emergency-hr").innerText = vitals.hr;
  
  const app = db.appointments.find(a => a.token === token);
  const p = db.patients.find(pat => pat.id === app.patientId);
  document.getElementById("emergency-clinic").innerText = p ? p.village : "Rural Center";

  const banner = document.getElementById("global-emergency-banner");
  if (banner) banner.style.display = "flex";

  // Trigger Toast Alert
  showToast(`🚨 RED ALERT: Vitals Critical for ${patientName}! SpO2: ${vitals.spo2}%, BP: ${vitals.bpSystolic}, HR: ${vitals.hr}. Ambulance Dispatched!`, "danger");

  // Log emergency system event to consultations history
  const conId = `con-${Math.floor(100 + Math.random() * 900)}`;
  db.consultations.push({
    id: conId,
    date: new Date().toISOString().split("T")[0],
    patientName: patientName,
    village: p ? p.village : "Clinic A",
    doctorName: "EMERGENCY UNIT",
    diagnosis: "CRITICAL VITAL ESCALATION: SpO2 < 90 / BP > 180 / HR > 130",
    medicines: "Ambulance dispatched to rural center immediately",
    failoverState: "Red Alert Dispatch",
    referral: true
  });
  saveDB("consultations");

  // Reload queues immediately
  if (currentUser) {
    if (currentRole === "doctor") renderDoctorQueue();
    else if (currentRole === "vhw") renderVhwQueue();
    else if (currentRole === "admin") renderAdminLogs();
  }
};

window.dismissEmergencyBanner = function() {
  const banner = document.getElementById("global-emergency-banner");
  if (banner) banner.style.display = "none";
};

// --- FEATURE 5: OFFLINE MODE & AUTO-SYNC ---
window.isNetworkOnline = true;

window.toggleSimulatedInternet = function() {
  window.isNetworkOnline = !window.isNetworkOnline;
  updateOnlinePill();

  if (window.isNetworkOnline) {
    showToast("🔄 Connection restored. Auto-syncing pending local changes to Supabase...", "info");
    runOfflineSync();
  } else {
    showToast("🔴 Offline Mode Activated. Changes will be saved locally.", "warning");
  }
};

function updateOnlinePill() {
  const pill = document.getElementById("global-connection-status");
  const text = document.getElementById("connection-status-text");
  
  if (pill && text) {
    if (window.isNetworkOnline) {
      pill.className = "connection-status-pill online";
      text.innerText = "Online (Cloud)";
    } else {
      pill.className = "connection-status-pill offline";
      text.innerText = "Offline (Local)";
    }
  }
}

async function runOfflineSync() {
  if (!supabase) return;
  const pending = JSON.parse(localStorage.getItem("pending_syncs"));
  if (!pending) return;

  try {
    let syncedCount = 0;
    if (pending.patients) {
      await supabase.from("patients").upsert(db.patients);
      syncedCount++;
    }
    if (pending.doctors) {
      await supabase.from("doctors").upsert(db.doctors);
      syncedCount++;
    }
    if (pending.appointments) {
      await supabase.from("appointments").upsert(db.appointments);
      syncedCount++;
    }
    if (pending.consultations) {
      await supabase.from("consultations").upsert(db.consultations);
      syncedCount++;
    }

    if (syncedCount > 0) {
      showToast(`✅ Cloud Sync complete! Successfully uploaded pending changes.`, "success");
      localStorage.removeItem("pending_syncs");
    }
  } catch (err) {
    console.error("Auto-sync background task failed:", err);
  }
}

// Listen to browser network changes automatically
window.addEventListener('online', () => {
  window.isNetworkOnline = true;
  updateOnlinePill();
  runOfflineSync();
});
window.addEventListener('offline', () => {
  window.isNetworkOnline = false;
  updateOnlinePill();
});

// --- FEATURE 6: SPEECH TRANSLATION & TTS ---
window.translationConfig = {
  patientLang: "ta-IN",
  targetLang: "ta-IN"
};

window.updateTranslatorSettings = function() {
  const patSelect = document.getElementById("doc-patient-lang");
  const tarSelect = document.getElementById("doc-target-lang");
  if (patSelect) window.translationConfig.patientLang = patSelect.value;
  if (tarSelect) window.translationConfig.targetLang = tarSelect.value;
};

// Built-in browser Text-to-Speech (TTS)
function speakText(text, langCode) {
  if (!window.speechSynthesis) return;
  
  // Cancel active speakings
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langCode;
  
  // Attempt to select corresponding native speaker voice if loaded
  const voices = window.speechSynthesis.getVoices();
  const matchedVoice = voices.find(v => v.lang.startsWith(langCode));
  if (matchedVoice) utterance.voice = matchedVoice;
  
  window.speechSynthesis.speak(utterance);
}

// Intercept typed doctor chat messages to read them to patient in their chosen language
window.speakDoctorTranslation = function(msgText) {
  if (!activeCall) return;
  
  // Translation mocks
  let translatedText = msgText;
  const tLang = window.translationConfig.targetLang;
  
  if (tLang === "ta-IN") {
    if (msgText.toLowerCase().includes("breathe") || msgText.toLowerCase().includes("breath")) {
      translatedText = "தயவுசெய்து ஆழமாக சுவாசிக்கவும்";
    } else if (msgText.toLowerCase().includes("bp") || msgText.toLowerCase().includes("blood pressure")) {
      translatedText = "நான் உங்கள் இரத்த அழுத்தத்தை சரிபார்க்கிறேன்";
    } else if (msgText.toLowerCase().includes("hello") || msgText.toLowerCase().includes("hi")) {
      translatedText = "வணக்கம், நான் உங்களுக்கு எப்படி உதவ முடியும்?";
    } else {
      translatedText = "மருத்துவர்: உங்கள் மருந்து பரிந்துரை தயாராக உள்ளது";
    }
  } else if (tLang === "hi-IN") {
    if (msgText.toLowerCase().includes("breathe") || msgText.toLowerCase().includes("breath")) {
      translatedText = "कृपया गहरी सांस लें";
    } else if (msgText.toLowerCase().includes("bp") || msgText.toLowerCase().includes("blood pressure")) {
      translatedText = "मैं आपके रक्तचाप की जांच कर रहा हूं";
    } else if (msgText.toLowerCase().includes("hello") || msgText.toLowerCase().includes("hi")) {
      translatedText = "नमस्ते, मैं आपकी क्या सहायता कर सकता हूँ?";
    } else {
      translatedText = "डॉक्टर: आपका नुस्खा तैयार है";
    }
  }

  // Display translation overlay captions on patient viewport
  const overlay = document.getElementById("pat-translation-overlay");
  const origEl = document.getElementById("pat-trans-orig");
  const resEl = document.getElementById("pat-trans-res");
  
  if (overlay && origEl && resEl) {
    origEl.innerText = `Doctor (English): "${msgText}"`;
    resEl.innerText = `${tLang === "ta-IN" ? "Tamil" : "Hindi"}: "${translatedText}"`;
    overlay.style.display = "flex";
    
    // Auto hide overlay after 6s
    setTimeout(() => {
      overlay.style.display = "none";
    }, 6000);
  }

  // Speak out loud to patient in their selected language!
  speakText(translatedText, tLang);
};

// Simulate Patient speech to Doctor
window.triggerSimulatedSpeech = function() {
  if (!activeCall) {
    showToast("No active call to translate!", "warning");
    return;
  }

  const pLang = window.translationConfig.patientLang;
  let original = "";
  let translation = "";

  if (pLang === "ta-IN") {
    original = "என் நெஞ்சில் ஒரு அழுத்தமாக இருக்கிறது, சுவாசிக்க கடினமாக உள்ளது.";
    translation = "I feel a pressure in my chest and it is difficult to breathe.";
  } else {
    original = "मेरे सीने में दबाव महसूस हो रहा है और सांस लेने में कठिनाई हो रही है।";
    translation = "I feel a pressure in my chest and it is difficult to breathe.";
  }

  // Render on Doctor Viewport
  const overlay = document.getElementById("doc-translation-overlay");
  const origEl = document.getElementById("doc-trans-orig");
  const resEl = document.getElementById("doc-trans-res");
  
  if (overlay && origEl && resEl) {
    origEl.innerText = `Patient (${pLang === "ta-IN" ? "Tamil" : "Hindi"}): "${original}"`;
    resEl.innerText = `Translated (English): "${translation}"`;
    overlay.style.display = "flex";
    
    setTimeout(() => {
      overlay.style.display = "none";
    }, 6000);
  }

  // Render on Nurse VHW Viewport too
  const vhwOverlay = document.getElementById("vhw-translation-overlay");
  const vhwOrigEl = document.getElementById("vhw-trans-orig");
  const vhwResEl = document.getElementById("vhw-trans-res");
  if (vhwOverlay && vhwOrigEl && vhwResEl) {
    vhwOrigEl.innerText = `Patient: "${original}"`;
    vhwResEl.innerText = `Translated (English): "${translation}"`;
    vhwOverlay.style.display = "flex";
    setTimeout(() => { vhwOverlay.style.display = "none"; }, 6000);
  }

  // Read out loud in English for the Doctor!
  speakText(translation, "en-US");
};

// Hook translation to chat sends
const chatFormDoc = document.getElementById("doc-chat-form");
if (chatFormDoc) {
  chatFormDoc.addEventListener("submit", (e) => {
    const input = document.getElementById("doc-chat-input");
    if (input && input.value.trim() && activeCall) {
      window.speakDoctorTranslation(input.value.trim());
    }
  });
}

// --- FEATURE 7: QR CODE PATIENT SCANNER SYSTEM ---
window.openQrScanner = function() {
  const modal = document.getElementById("qr-scanner-modal");
  const select = document.getElementById("scanner-select-pat");
  if (!modal || !select) return;

  // Populate patient select options
  select.innerHTML = "";
  db.patients.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.innerText = `${p.name} (ID: ${p.id})`;
    select.appendChild(opt);
  });

  // Default select first patient
  if (db.patients.length > 0) {
    window.updateScannerQrImage(db.patients[0].id);
  }

  modal.style.display = "flex";
  showToast("Simulated camera scanner activated...", "info");
};

window.closeQrScanner = function() {
  const modal = document.getElementById("qr-scanner-modal");
  if (modal) modal.style.display = "none";
};

window.updateScannerQrImage = function(patientId) {
  const img = document.getElementById("scanner-qr-target");
  if (img) {
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${patientId}`;
  }
};

window.runSimulatedScan = function() {
  const select = document.getElementById("scanner-select-pat");
  if (!select) return;
  const patientId = select.value;
  const patient = db.patients.find(p => p.id === patientId);

  showToast("Scanning target code...", "info");
  
  setTimeout(() => {
    window.closeQrScanner();
    showToast(`✅ Code Decoded: ${patient ? patient.name : patientId} (ID: ${patientId})`, "success");
    
    // Automatically trigger Vitals entry modal for this patient!
    window.openVitalsModal(patientId);
  }, 1200);
};

// --- FEATURE 15: SECURE HIPPA CONSULTATION RECORDING ENGINE ---
window.isRecordingActive = false;
let callRecordingInterval = null;
let callRecordingSeconds = 0;

window.toggleCallRecording = function() {
  if (!activeCall) {
    showToast("No active call session to record!", "warning");
    return;
  }

  const btn = document.getElementById("doc-record-btn");
  const banner = document.getElementById("doc-recording-status");
  const timer = document.getElementById("doc-rec-timer");

  if (!window.isRecordingActive) {
    // Start Recording
    window.isRecordingActive = true;
    callRecordingSeconds = 0;
    if (btn) {
      btn.innerText = "⏹️";
      btn.style.backgroundColor = "#dc2626"; // stop state red
      btn.classList.add("active");
    }
    if (banner) banner.style.display = "flex";
    if (timer) timer.innerText = "00:00";

    callRecordingInterval = setInterval(() => {
      callRecordingSeconds++;
      const mins = String(Math.floor(callRecordingSeconds / 60)).padStart(2, "0");
      const secs = String(callRecordingSeconds % 60).padStart(2, "0");
      if (timer) timer.innerText = `${mins}:${secs}`;
    }, 1000);

    showToast("🔴 Recording started. Audio and screen capture active.", "warning");
  } else {
    window.stopCallRecording();
  }
};

window.stopCallRecording = function() {
  if (!window.isRecordingActive) return;
  window.isRecordingActive = false;

  const btn = document.getElementById("doc-record-btn");
  const banner = document.getElementById("doc-recording-status");
  const timer = document.getElementById("doc-rec-timer");

  if (callRecordingInterval) {
    clearInterval(callRecordingInterval);
    callRecordingInterval = null;
  }

  if (btn) {
    btn.innerText = "🔴";
    btn.style.backgroundColor = "#374151";
    btn.classList.remove("active");
  }
  if (banner) banner.style.display = "none";

  const durationStr = timer ? timer.innerText : "00:05";
  showToast("🔒 AES-256 Encrypting media tracks...", "info");

  setTimeout(() => {
    const recId = `REC-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRec = {
      id: recId,
      date: new Date().toISOString().split("T")[0],
      patientId: activeCall ? activeCall.patient.id : "pat-1",
      patientName: activeCall ? activeCall.patient.name : "Patient",
      secureUrl: `consultation_${activeCall ? activeCall.token : "session"}.enc`,
      duration: durationStr
    };

    db.recordings.push(newRec);
    saveDB();
    showToast("✅ Encrypted recording uploaded to secure HIPAA bucket.", "success");
    
    if (currentRole === "admin") renderAdminRecordings();
  }, 1200);
};

// Seeding Default Recordings for Audit Trail Demonstration
function seedDefaultRecordings() {
  if (!db.recordings || db.recordings.length === 0) {
    db.recordings = [
      { id: "REC-4109", date: "2026-06-30", patientId: "pat-1", patientName: "Sarah Mitchell", secureUrl: "sarah_mitchell_session_1.enc", duration: "03:45" },
      { id: "REC-8294", date: "2026-07-01", patientId: "pat-2", patientName: "Fatima", secureUrl: "fatima_session_3.enc", duration: "06:12" }
    ];
    saveDB();
  }
}
// Run seed check on load
setTimeout(seedDefaultRecordings, 1000);

function renderAdminRecordings() {
  const tbody = document.getElementById("admin-recordings-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const list = db.recordings || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No consultation recordings saved.</td></tr>`;
    return;
  }

  list.forEach(rec => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${rec.id}</strong></td>
      <td>${rec.date}</td>
      <td><strong>${rec.patientName}</strong></td>
      <td style="font-family: monospace; font-size: 11px; color:#10b981;">supabase://buckets/recordings/${rec.secureUrl}</td>
      <td>${rec.duration}</td>
      <td>
        <button class="btn-action success" onclick="window.playRecording('${rec.id}')">▶️ Playback</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.playRecording = function(recId) {
  const rec = db.recordings.find(r => r.id === recId);
  if (!rec) return;

  const modal = document.getElementById("playback-modal");
  const avatar = document.getElementById("playback-avatar");
  const patLabel = document.getElementById("playback-patient-label");
  const durLabel = document.getElementById("playback-duration-label");

  if (modal && avatar && patLabel && durLabel) {
    patLabel.innerText = rec.patientName;
    durLabel.innerText = `Duration: ${rec.duration}`;
    avatar.innerText = rec.patientName.split(" ").map(n => n[0]).join("");
    modal.style.display = "flex";
    showToast(`🔒 Decrypting consultation stream from secure HIPAA storage...`, "success");
  }
};

window.closePlaybackModal = function() {
  const modal = document.getElementById("playback-modal");
  if (modal) modal.style.display = "none";
};

// --- GOOGLE SIGN IN OAUTH ACCOUNT PICKER ENGINE ---
window.openGoogleSignInModal = async function() {
  if (!supabase) {
    showToast("Supabase is not configured yet. Cannot sign in with Google.", "danger");
    return;
  }
  showToast("Redirecting to Google Sign-In...", "info");
  
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    
    if (error) {
      showToast(`Google OAuth Error: ${error.message}. Make sure Google Provider is enabled in Supabase Dashboard.`, "danger");
    }
  } catch (err) {
    showToast(`OAuth Trigger Failed: ${err.message}`, "danger");
  }
};

window.closeGoogleSignInModal = function() {
  const modal = document.getElementById("google-signin-modal");
  if (modal) modal.style.display = "none";
};

window.selectGoogleRole = function(role) {
  const roleModal = document.getElementById("google-role-modal");
  if (roleModal) roleModal.style.display = "none";

  if (!window.googleUser) {
    showToast("No Google account verified.", "danger");
    return;
  }

  const { name, email } = window.googleUser;
  
  if (role === "patient") {
    // Check if patient exists or register them
    let patient = db.patients.find(p => p.phone === email || p.name === name);
    if (!patient) {
      patient = { id: `pat-${Date.now().toString().slice(-4)}`, name, age: 30, gender: "Male", phone: email, village: "Village Clinic A", history: [] };
      db.patients.push(patient);
      saveDB();
    }
    currentUser = patient;
  } else if (role === "vhw") {
    currentUser = { name: `Nurse ${name}`, role: "VHW", village: "Village Clinic A" };
  } else if (role === "doctor") {
    let doctor = db.doctors.find(d => d.email === email);
    if (!doctor) {
      doctor = { id: `doc-${Date.now().toString().slice(-4)}`, name: `Dr. ${name}`, specialty: "General Medicine", email, online: true };
      db.doctors.push(doctor);
      saveDB();
    }
    currentUser = doctor;
  } else if (role === "admin") {
    currentUser = { name: `Admin ${name}`, role: "Admin" };
  }

  switchView(`view-${role}`, role);
  showToast(`Logged in successfully as ${currentUser.name}!`, "success");
};

// --- FEATURE: ROLE-BASED ACCESS CONTROL (RBAC) MANAGER ---
function renderAdminRbac() {
  const tbody = document.getElementById("admin-rbac-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const config = db.authConfig || { admins: [], vhws: [] };
  
  // Render Admins
  config.admins.forEach(email => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${email}</strong></td>
      <td><span class="badge" style="background:#f59e0b; color:white;">Administrator</span></td>
      <td><button class="btn-action danger" onclick="window.adminDeleteRbacEmail('admin', '${email}')">Revoke</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Render VHWs
  config.vhws.forEach(email => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${email}</strong></td>
      <td><span class="badge" style="background:#10b981; color:white;">Health Worker</span></td>
      <td><button class="btn-action danger" onclick="window.adminDeleteRbacEmail('vhw', '${email}')">Revoke</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.adminAddRbacEmail = function(e) {
  e.preventDefault();
  const email = document.getElementById("rbac-new-email").value.trim().toLowerCase();
  const role = document.getElementById("rbac-new-role").value;

  if (!db.authConfig) {
    db.authConfig = { admins: [], vhws: [] };
  }

  if (role === "admin") {
    if (db.authConfig.admins.includes(email)) {
      showToast("Email is already authorized as Admin.", "warning");
      return;
    }
    db.authConfig.admins.push(email);
  } else if (role === "vhw") {
    if (db.authConfig.vhws.includes(email)) {
      showToast("Email is already authorized as VHW.", "warning");
      return;
    }
    db.authConfig.vhws.push(email);
  }

  saveDB();
  showToast(`Successfully authorized ${email} for role: ${role.toUpperCase()}`, "success");
  document.getElementById("rbac-new-email").value = "";
  renderAdminRbac();
};

window.adminDeleteRbacEmail = function(role, email) {
  if (!db.authConfig) return;

  if (role === "admin") {
    db.authConfig.admins = db.authConfig.admins.filter(e => e !== email);
  } else if (role === "vhw") {
    db.authConfig.vhws = db.authConfig.vhws.filter(e => e !== email);
  }

  saveDB();
  showToast(`Successfully revoked authorizations for ${email}`, "warning");
  renderAdminRbac();
};


