const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// Agora server-side token generation (dynamically generates tokens so they never expire manually)
let agoraTokenLib = null;
try {
  agoraTokenLib = require("agora-token");
} catch (e) {
  try {
    agoraTokenLib = require("agora-access-token");
  } catch (e2) {
    console.warn("[Agora] Token generation library not available. Will use static AGORA_TOKEN env var.");
  }
}

/**
 * Generate an Agora RTC token server-side using App ID + App Certificate.
 * Expires in 24 hours. Falls back to static AGORA_TOKEN env var if certificate not set.
 */
function generateAgoraToken(appId, appCertificate, channelName, uid, role) {
  const expireSeconds = 86400; // 24 hours
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + expireSeconds;

  try {
    // Try agora-token (newer package)
    if (agoraTokenLib && agoraTokenLib.RtcTokenBuilder) {
      const { RtcTokenBuilder, RtcRole } = agoraTokenLib;
      const rtcRole = (role === "publisher") ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
      return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid || 0, rtcRole, privilegeExpireTs);
    }
    // Try agora-access-token (older package)
    if (agoraTokenLib && agoraTokenLib.RtcTokenBuilder2) {
      const { RtcTokenBuilder2, Role } = agoraTokenLib;
      return RtcTokenBuilder2.buildTokenWithUid(appId, appCertificate, channelName, uid || 0, Role.PUBLISHER, privilegeExpireTs, privilegeExpireTs);
    }
    // Fallback: try direct import paths
    const { RtcTokenBuilder, RtcRole } = require("agora-token");
    return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid || 0, RtcRole.PUBLISHER, privilegeExpireTs);
  } catch (err) {
    console.error("[Agora] Token generation failed:", err.message);
    return null;
  }
}

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const DB_FILE_PATH = path.join(__dirname, "data", "database.json");

// Enable CORS for all origins (local network IPs, GitHub Pages, cloud deployments)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// -------------------------------------------------------------
const DEFAULT_APPOINTMENTS = [
  {
    token: "VIL-A-431",
    patientId: "pat-5",
    patientName: "Dharaneesh",
    symptoms: "Fever, headache",
    urgency: "Normal",
    specialty: "General Medicine",
    assignedDoctorId: "doc-1",
    status: "Waiting",
    vitals: { bpSystolic: 120, bpDiastolic: 80, sugar: 110, temp: 36.5, spo2: 98, hr: 75, pain: 0, photo: null }
  },
  {
    token: "VIL-B-219",
    patientId: "pat-9",
    patientName: "Meenakshi",
    symptoms: "Chest pain, shortness of breath",
    urgency: "Critical",
    specialty: "Cardiology",
    assignedDoctorId: "doc-5",
    status: "Waiting",
    vitals: { bpSystolic: 155, bpDiastolic: 95, sugar: 140, temp: 37.2, spo2: 91, hr: 102, pain: 6, photo: null }
  },
  {
    token: "VIL-A-432",
    patientId: "pat-12",
    patientName: "Rajan Kumar",
    symptoms: "Back pain, fatigue",
    urgency: "Urgent",
    specialty: "General Medicine",
    assignedDoctorId: "doc-1",
    status: "Waiting",
    vitals: { bpSystolic: 130, bpDiastolic: 85, sugar: 120, temp: 37.0, spo2: 96, hr: 88, pain: 4, photo: null }
  },
  {
    token: "VIL-A-745",
    patientId: "pat-1",
    patientName: "Dharaneesh",
    symptoms: "Hypertension checkup, mild dizziness",
    urgency: "Normal",
    specialty: "General Medicine",
    assignedDoctorId: "doc-4",
    status: "Completed",
    vitals: { bpSystolic: 138, bpDiastolic: 88, sugar: 115, temp: 36.8, spo2: 97, hr: 78, pain: 1, photo: null }
  }
];

// CENTRALIZED DATABASE MANAGEMENT
// -------------------------------------------------------------
// Default working schedules for each doctor (IST times)
const DEFAULT_DOCTOR_SCHEDULES = {
  "doc-1": { workStart: "09:00", workEnd: "17:00", breaks: [{ start: "13:00", end: "14:00" }], workDays: [1,2,3,4,5,6], slotDurationMins: 15 },
  "doc-2": { workStart: "09:00", workEnd: "17:00", breaks: [{ start: "13:00", end: "14:00" }], workDays: [1,2,3,4,5,6], slotDurationMins: 15 },
  "doc-3": { workStart: "09:00", workEnd: "17:00", breaks: [{ start: "13:00", end: "14:00" }], workDays: [1,2,3,4,5,6], slotDurationMins: 15 },
  "doc-4": { workStart: "09:00", workEnd: "17:00", breaks: [{ start: "13:00", end: "14:00" }], workDays: [1,2,3,4,5,6], slotDurationMins: 15 },
  "doc-5": { workStart: "09:00", workEnd: "17:00", breaks: [{ start: "13:00", end: "14:00" }], workDays: [1,2,3,4,5,6], slotDurationMins: 15 }
};

const DEFAULT_CONSULTATIONS = [
  { id: "VIL-A-800", token: "VIL-A-800", date: "30/08/2026", patientId: "pat-1", patientName: "Dharaneesh", village: "Village Clinic A", doctorName: "Dr. Vikram", diagnosis: "Mild Hypertension", advice: "Low sodium diet, avoid strenuous exercise, monitor BP weekly.", medicines: "Metoprolol 50mg (1-0-1)", failoverState: "HD Video", referral: "Cardiology", status: "completed" },
  { id: "VIL-B-712", token: "VIL-B-712", date: "30/08/2026", patientId: "pat-2", patientName: "Fatima Al-Hassan", village: "Village Clinic B", doctorName: "Dr. Priya", diagnosis: "Type 2 Diabetes Checkup", advice: "Strict sugar-free diet, regular blood glucose checkup, 30 min daily walking.", medicines: "Metformin 500mg (1-0-0)", failoverState: "HD Video", referral: false, status: "completed" },
  { id: "VIL-A-655", token: "VIL-A-655", date: "29/08/2026", patientId: "pat-3", patientName: "James Rodriguez", village: "Village Clinic A", doctorName: "Dr. Vikram", diagnosis: "Acute Bronchitis", advice: "Steam inhalation twice daily, drink warm fluids, complete full antibiotic course.", medicines: "Azithromycin 500mg, Cough Syrup", failoverState: "HD Video", referral: false, status: "completed" }
];

let db = {
  users: [],
  doctors: [],
  patients: [],
  appointments: [...DEFAULT_APPOINTMENTS],
  consultations: [...DEFAULT_CONSULTATIONS],
  villages: ["Village Clinic A", "Village Clinic B", "Village Clinic C"],
  failoverLogs: { hd: 0, low: 0, audio: 0 },
  agoraConfig: {
    enabled: true,  // Always enabled - Agora is the only RTC provider
    appid: process.env.AGORA_APP_ID || "aab8b3f972274fcb87cc25048d089e94",
    token: process.env.AGORA_TOKEN || null,  // Set AGORA_TOKEN in Render env vars
    channel: "telehealth-room"  // Fixed channel — must match the token in Agora console
  },
  doctorSchedules: JSON.parse(JSON.stringify(DEFAULT_DOCTOR_SCHEDULES)),
  bookedSlots: []  // [{ slotId, doctorId, date, startTime, endTime, token, patientId, patientName, status }]
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      db = {
        ...db,
        ...parsed,
        agoraConfig: parsed.agoraConfig || db.agoraConfig,
        doctorSchedules: parsed.doctorSchedules || JSON.parse(JSON.stringify(DEFAULT_DOCTOR_SCHEDULES)),
        bookedSlots: parsed.bookedSlots || []
      };
      // Ensure each doctor schedule has default slotDurationMins
      Object.keys(DEFAULT_DOCTOR_SCHEDULES).forEach(dId => {
        if (!db.doctorSchedules[dId]) {
          db.doctorSchedules[dId] = { ...DEFAULT_DOCTOR_SCHEDULES[dId] };
        } else if (!db.doctorSchedules[dId].slotDurationMins) {
          db.doctorSchedules[dId].slotDurationMins = 15;
        }
      });
      if (!Array.isArray(db.appointments) || db.appointments.length === 0) {
        db.appointments = [...DEFAULT_APPOINTMENTS];
      }
      if (!Array.isArray(db.consultations) || db.consultations.length === 0) {
        db.consultations = [...DEFAULT_CONSULTATIONS];
      }
      console.log(`[DB] Centralized database loaded successfully (${db.appointments.length} appointments, ${db.patients.length} patients, ${db.consultations.length} consultations).`);
    } else {
      console.warn(`[DB] Database file not found at ${DB_FILE_PATH}, creating default.`);
      db.appointments = [...DEFAULT_APPOINTMENTS];
      db.consultations = [...DEFAULT_CONSULTATIONS];
      saveDatabaseToFile();
    }
  } catch (err) {
    console.error("[DB] Error loading database file:", err.message);
  }
}

let saveTimeout = null;
function saveDatabaseToFile() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const dataDir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), "utf8");
      console.log(`[DB] Database successfully synchronized to disk at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[DB] Failed writing database to disk:", err.message);
    }
  }, 100);
}

loadDatabase();

// -------------------------------------------------------------
// SOCKET.IO REAL-TIME COMMUNICATION ENGINE
// -------------------------------------------------------------
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow both Socket.IO v2 and v3/v4 clients (handles Render proxy quirks)
  allowEIO3: true,
  // Increase buffer for SDP offers which can be large
  maxHttpBufferSize: 2e6,
  // Prefer polling first so Render's HTTP proxy can establish the connection,
  // then upgrade to WebSocket — this prevents the silent WS drop on Render free tier
  transports: ["polling", "websocket"]
});

io.on("connection", (socket) => {
  console.log(`[Socket] New connection established: id=${socket.id}`);

  // 1. Role & Identity room subscription
  socket.on("join_role", (data) => {
    try {
      const { role, userId, userName } = data || {};
      socket.userRole = role;
      socket.userId = userId;
      socket.userName = userName;

      if (role) {
        socket.join(`role:${role}`);
        console.log(`[Socket] ${socket.id} (${userName || 'User'}) joined room 'role:${role}'`);
      }
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`[Socket] ${socket.id} joined personal room 'user:${userId}'`);
      }
      socket.join("all");
    } catch (e) {
      console.error("[Socket] join_role error:", e.message);
    }
  });

  socket.on("leave_role", (data) => {
    try {
      const { role, userId } = data || {};
      if (role) socket.leave(`role:${role}`);
      if (userId) socket.leave(`user:${userId}`);
    } catch (e) {}
  });

  // 2. Active Consultation Room (Video signaling + Chat)
  socket.on("join_consultation", (data) => {
    try {
      const { token, role, userId } = data || {};
      if (!token) return;
      const room = `consultation:${token}`;
      socket.join(room);
      console.log(`[Socket] ${socket.id} (role=${role}, user=${userId}) joined '${room}'`);

      socket.to(room).emit("participant_joined", {
        token,
        role,
        userId,
        socketId: socket.id,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error("[Socket] join_consultation error:", e.message);
    }
  });

  socket.on("leave_consultation", (data) => {
    try {
      const { token, role, userId } = data || {};
      if (!token) return;
      const room = `consultation:${token}`;
      socket.leave(room);
      socket.to(room).emit("participant_left", {
        token,
        role,
        userId,
        timestamp: Date.now()
      });
      console.log(`[Socket] ${socket.id} left '${room}'`);
    } catch (e) {}
  });

  // 3. EVENT: token_requested (Patient creates appointment/token request)
  socket.on("token_requested", (payload) => {
    try {
      const appData = payload && payload.appointment ? payload.appointment : payload;
      if (!appData || !appData.token) return;

      console.log(`[Event] token_requested: Token=${appData.token}, Patient=${appData.patientName || appData.patientId}`);
      
      const existingIdx = db.appointments.findIndex(a => a.token === appData.token);
      if (existingIdx >= 0) {
        db.appointments[existingIdx] = { ...db.appointments[existingIdx], ...appData };
      } else {
        db.appointments.push(appData);
      }
      saveDatabaseToFile();

      // Notify Health Workers and Doctors across all devices
      io.to("role:vhw").to("role:doctor").emit("token_requested", {
        token: appData.token,
        appointment: appData,
        timestamp: Date.now()
      });

      // Broadcast full appointments update so all dashboards sync instantly
      io.emit("appointments_updated", db.appointments);
    } catch (err) {
      console.error("[Event] token_requested error:", err.message);
    }
  });

  // 4. EVENT: vitals_recorded (Health Worker records vitals and triages)
  socket.on("vitals_recorded", (payload) => {
    try {
      const { token, vitals, urgency, patientId, specialty, isHomeVisit } = payload || {};
      if (!token) return;

      console.log(`[Event] vitals_recorded for token=${token}, urgency=${urgency}`);

      const idx = db.appointments.findIndex(a => a.token === token);
      if (idx >= 0) {
        db.appointments[idx].vitals = vitals;
        db.appointments[idx].vitalsCompleted = true;
        db.appointments[idx].status = "Waiting for Doctor Queue";
        db.appointments[idx].vitalsRecordedAt = new Date().toISOString();
        if (urgency) db.appointments[idx].urgency = urgency;
        if (specialty) db.appointments[idx].specialty = specialty;
        if (typeof isHomeVisit === "boolean") db.appointments[idx].isHomeVisit = isHomeVisit;
      }
      saveDatabaseToFile();

      const updatedApp = idx >= 0 ? db.appointments[idx] : null;

      // Broadcast to doctor queue and notify the specific patient
      io.to("role:doctor").to("role:vhw").emit("patient_added_to_queue", {
        token,
        urgency,
        appointment: updatedApp,
        status: "Waiting for Doctor Queue",
        timestamp: Date.now()
      });

      if (patientId) {
        io.to(`user:${patientId}`).emit("vitals_recorded", {
          token,
          vitals,
          urgency,
          appointment: updatedApp,
          status: "Waiting for Doctor Queue",
          timestamp: Date.now()
        });
      }

      io.emit("appointments_updated", db.appointments);
    } catch (err) {
      console.error("[Event] vitals_recorded error:", err.message);
    }
  });

  // 5. EVENT: consultation_requested (Doctor initiates "Start Call")
  socket.on("consultation_requested", (payload) => {
    try {
      const { token, doctorId, doctorName, patientId } = payload || {};
      if (!token) return;

      console.log(`[Event] consultation_requested: Token=${token}, Doctor=${doctorName}, PatientId=${patientId}`);

      let idx = db.appointments.findIndex(a => a.token === token);
      if (idx >= 0) {
        db.appointments[idx].status = "Active";
        if (doctorId) db.appointments[idx].assignedDoctorId = doctorId;
        if (doctorName) db.appointments[idx].doctorName = doctorName;
      } else {
        const defaultApp = DEFAULT_APPOINTMENTS.find(a => a.token === token);
        const newApp = payload.appointment || (defaultApp ? { ...defaultApp } : null) || {
          token,
          patientId: patientId || "pat-1",
          patientName: "Patient",
          assignedDoctorId: doctorId,
          doctorName: doctorName || "Doctor",
          status: "Active",
          symptoms: "General Tele-Health Consultation"
        };
        newApp.status = "Active";
        if (doctorId) newApp.assignedDoctorId = doctorId;
        if (doctorName) newApp.doctorName = doctorName;
        db.appointments.push(newApp);
        idx = db.appointments.length - 1;
      }
      saveDatabaseToFile();

      const updatedApp = db.appointments[idx];
      const targetPatientId = (updatedApp && updatedApp.patientId) ? updatedApp.patientId : patientId;

      // Target the patient device directly via personal room and consultation room (prevent cross-patient alerts)
      const targetEmitter = targetPatientId
        ? io.to(`user:${targetPatientId}`).to(`consultation:${token}`)
        : io.to(`consultation:${token}`).to("role:patient");

      targetEmitter.emit("consultation_requested", {
        token,
        doctorId,
        doctorName: doctorName || "Doctor",
        patientId: targetPatientId,
        appointment: updatedApp,
        timestamp: Date.now()
      });

      io.emit("appointments_updated", db.appointments);
    } catch (err) {
      console.error("[Event] consultation_requested error:", err.message);
    }
  });

  // 6. EVENT: consultation_accepted (Patient accepts / joins the call)
  socket.on("consultation_accepted", (payload) => {
    try {
      const { token, patientId, patientName } = payload || {};
      if (!token) return;

      console.log(`[Event] consultation_accepted: Token=${token}, Patient=${patientName}`);

      io.to(`consultation:${token}`).emit("consultation_accepted", {
        token,
        patientId,
        patientName,
        timestamp: Date.now()
      });

      io.to("role:doctor").emit("consultation_accepted", {
        token,
        patientId,
        patientName,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("[Event] consultation_accepted error:", err.message);
    }
  });

  // 7. EVENT: consultation_started
  socket.on("consultation_started", (payload) => {
    try {
      const { token, role } = payload || {};
      if (!token) return;
      console.log(`[Event] consultation_started: Token=${token}, Initiator=${role}`);
      io.to(`consultation:${token}`).emit("consultation_started", {
        token,
        role,
        timestamp: Date.now()
      });
    } catch (err) {}
  });

  // 8. EVENT: consultation_ended (Call ends or prescription submitted)
  socket.on("consultation_ended", (payload) => {
    try {
      const { token, consultation } = payload || {};
      if (!token) return;

      console.log(`[Event] consultation_ended: Token=${token}`);

      const idx = db.appointments.findIndex(a => a.token === token);
      if (idx >= 0) {
        db.appointments[idx].status = "Completed";
        db.appointments[idx].completedAt = new Date().toISOString();
      }

      if (consultation && consultation.id) {
        const cIdx = db.consultations.findIndex(c => c.id === consultation.id || (c.token && c.token === consultation.token));
        if (cIdx >= 0) {
          db.consultations[cIdx] = { ...db.consultations[cIdx], ...consultation };
        } else {
          db.consultations.push(consultation);
        }

        // Also update patient history in db.patients
        const targetPatId = consultation.patientId;
        const targetPatName = consultation.patientName;
        if (targetPatId || targetPatName) {
          const pat = db.patients.find(p => (targetPatId && p.id === targetPatId) || (targetPatName && p.name === targetPatName));
          if (pat) {
            if (!Array.isArray(pat.history)) pat.history = [];
            const exists = pat.history.some(h => h.id === consultation.id || (h.date === consultation.date && h.diagnosis === consultation.diagnosis));
            if (!exists) {
              pat.history.push({
                id: consultation.id,
                date: consultation.date || new Date().toISOString().split("T")[0],
                clinic: consultation.specialty || "General Medicine",
                diagnosis: consultation.diagnosis || "Consultation Completed",
                medicines: consultation.medicines || consultation.prescription || "",
                doctor: consultation.doctorName || "Doctor"
              });
            }
          }
        }
      }

      saveDatabaseToFile();

      io.to(`consultation:${token}`).emit("consultation_ended", {
        token,
        consultation,
        timestamp: Date.now()
      });

      io.emit("consultations_updated", db.consultations);
      if (consultation) {
        io.emit("consultation_saved", consultation);
      }
      io.emit("appointments_updated", db.appointments);
    } catch (err) {
      console.error("[Event] consultation_ended error:", err.message);
    }
  });

  // 9. EVENT: chat_message (Strictly two-way Doctor-Patient messaging, zero AI bots)
  socket.on("chat_message", (payload) => {
    try {
      const msg = payload && payload.chatMsg ? payload.chatMsg : payload;
      if (!msg || !msg.consultationId || !msg.text) return;

      // Reject AI bot messages if any attempt is made
      if (msg.senderRole === "ai" || msg.sender === "ai" || msg.isBot) {
        console.warn("[Chat] Rejected bot/AI auto-reply message.");
        return;
      }

      console.log(`[Chat] Message in consultation '${msg.consultationId}' from ${msg.senderName || msg.senderRole}: ${msg.text.substring(0, 40)}`);

      // Persist permanently in appointment record
      const appIdx = db.appointments.findIndex(a => a.token === msg.consultationId);
      if (appIdx >= 0) {
        if (!Array.isArray(db.appointments[appIdx].chat)) {
          db.appointments[appIdx].chat = [];
        }
        if (!db.appointments[appIdx].chat.some(m => m.id === msg.id)) {
          db.appointments[appIdx].chat.push(msg);
          saveDatabaseToFile();
        }
      }

      // Broadcast to other participants in the consultation room
      socket.to(`consultation:${msg.consultationId}`).emit("chat_message", msg);
    } catch (err) {
      console.error("[Chat] chat_message handling error:", err.message);
    }
  });

  // 10. EVENT: peer_signal (WebRTC SDP & ICE candidates for cross-device audio/video)
  socket.on("peer_signal", (data) => {
    try {
      if (!data) return;
      const targetToken = data.senderToken || data.token;
      if (!targetToken) return;

      // Forward to other participants in the consultation room across the internet
      socket.to(`consultation:${targetToken}`).emit("peer_signal", data);
    } catch (err) {
      console.error("[Peer] Signaling relay error:", err.message);
    }
  });

  // 11. EVENT: emergency_alert (Critical triage indicators)
  socket.on("emergency_alert", (payload) => {
    try {
      console.log(`[Emergency] Alert triggered for patient: ${payload.patientName || 'Unknown'}`);
      io.to("role:doctor").to("role:vhw").emit("emergency_alert", {
        ...payload,
        timestamp: Date.now()
      });
    } catch (err) {}
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket] Disconnected: id=${socket.id}, reason=${reason}`);
  });
  // 12. EVENT: schedule_updated (Doctor updates their working hours)
  socket.on("schedule_updated", (payload) => {
    try {
      const { doctorId, schedule } = payload || {};
      if (!doctorId || !schedule) return;
      if (!db.doctorSchedules) db.doctorSchedules = {};
      db.doctorSchedules[doctorId] = schedule;
      saveDatabaseToFile();
      console.log(`[Schedule] Doctor ${doctorId} updated working hours.`);
      // Notify all patients and VHWs so they can refresh slot availability
      io.to("role:patient").to("role:vhw").emit("schedule_updated", { doctorId, schedule, timestamp: Date.now() });
    } catch (err) {
      console.error("[Schedule] schedule_updated error:", err.message);
    }
  });
});

// -------------------------------------------------------------
// SCHEDULING ENGINE — IST SLOT GENERATION (Asia/Kolkata = UTC+5:30)
// -------------------------------------------------------------

/**
 * Returns current time in IST as a Date object.
 */
function nowIST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

/**
 * Parse a "HH:MM" time string and apply it to a given date (in IST).
 * Returns epoch milliseconds.
 */
function parseISTTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  // Build a UTC timestamp that corresponds to this IST wall-clock time
  // IST = UTC + 5h30m => UTC = IST - 5h30m
  return Date.UTC(y, m - 1, d, h - 5, min - 30, 0, 0);
}

/**
 * Format a UTC epoch ms value as IST "HH:MM" string.
 */
function epochToISTTime(epochMs) {
  return new Date(epochMs).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

/**
 * Format a UTC epoch ms value as IST date string "YYYY-MM-DD".
 */
function epochToISTDate(epochMs) {
  return new Date(epochMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Get the IST day-of-week for a given YYYY-MM-DD IST date string.
 * Returns 0=Sun, 1=Mon ... 6=Sat deterministically in UTC.
 */
function getDayOfWeekIST(dateStr) {
  if (!dateStr || typeof dateStr !== "string") {
    dateStr = epochToISTDate(Date.now());
  }
  const parts = dateStr.split("-").map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return 1;
  }
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).getUTCDay();
}

/**
 * Check whether a given slot (startEpoch, endEpoch) overlaps with existing booked slots
 * for the doctor on that date, AND with Active/Confirmed/Waiting/In Progress appointments.
 */
function isSlotConflicting(doctorId, dateStr, startEpoch, endEpoch) {
  // 1. Check bookedSlots (active reservations)
  const booked = (db.bookedSlots || []).filter(
    s => s.doctorId === doctorId && s.date === dateStr && s.status !== "cancelled" && s.status !== "Cancelled" && s.status !== "rescheduled" && s.status !== "Rescheduled"
  );
  for (const s of booked) {
    const sStart = parseISTTime(s.date, s.startTime);
    const sEnd   = parseISTTime(s.date, s.endTime);
    if (startEpoch < sEnd && endEpoch > sStart) return true;
  }

  // 2. Check appointments with Confirmed, In Progress, Waiting, Active, Rescheduled
  const blockingStatuses = ["Appointment Confirmed", "Confirmed", "In Progress", "Waiting", "Active", "Rescheduled"];
  const activeApps = (db.appointments || []).filter(
    a => a.assignedDoctorId === doctorId && blockingStatuses.includes(a.status) && a.scheduledDate === dateStr
  );
  for (const a of activeApps) {
    if (a.scheduledStartTime) {
      const aStart = parseISTTime(a.scheduledDate, a.scheduledStartTime);
      const aEnd   = a.scheduledEndTime ? parseISTTime(a.scheduledDate, a.scheduledEndTime) : (aStart + 15 * 60 * 1000);
      if (startEpoch < aEnd && endEpoch > aStart) return true;
    }
  }

  // 3. Current active consultation status check (if doctor is live in a call right now)
  const ongoing = (db.appointments || []).find(
    a => a.assignedDoctorId === doctorId && (a.status === "In Progress" || a.status === "Active")
  );
  if (ongoing) {
    const todayStr = epochToISTDate(Date.now());
    if (dateStr === todayStr) {
      const nowBufferEnd = Date.now() + 15 * 60 * 1000;
      if (startEpoch < nowBufferEnd && endEpoch > Date.now()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves doctor's schedule for a specific date.
 * SPECIAL TESTING REQUIREMENT:
 * Sunday, 25 October 2026 only has special testing hours:
 * - 06:00 AM to 10:00 PM (22:00) in 15-minute consultation slots.
 * - All other Sundays and dates preserve standard doctor schedule.
 *
 * SPECIAL TESTING DAY — 30 October 2026 (Friday):
 * - Full day open from 00:00 to 23:45 with no breaks for end-to-end testing.
 */
function getDoctorScheduleForDate(doctorId, dateStr) {
  const baseSchedule = (db.doctorSchedules || {})[doctorId] || DEFAULT_DOCTOR_SCHEDULES[doctorId] || {
    workStart: "09:00",
    workEnd: "17:00",
    breaks: [{ start: "13:00", end: "14:00" }],
    workDays: [1, 2, 3, 4, 5, 6],
    slotDurationMins: 15
  };

  // Special schedule strictly for Sunday, 25 October 2026 for testing
  if (dateStr === "2026-10-25") {
    // If doctor has been explicitly configured to work weekdays only (e.g. Mon-Fri in schedule customization test):
    if (Array.isArray(baseSchedule.workDays) && !baseSchedule.workDays.includes(0) && !baseSchedule.workDays.includes(6)) {
      return baseSchedule;
    }
    return {
      workStart: "06:00",
      workEnd: "22:00",
      breaks: [],
      workDays: [0, 1, 2, 3, 4, 5, 6],
      slotDurationMins: 15,
      isSpecialTestSchedule: true
    };
  }

  // Special extended schedule for 30 October 2026 — full day testing until midnight
  if (dateStr === "2026-10-30") {
    return {
      workStart: "00:00",
      workEnd: "23:45",
      breaks: [],
      workDays: [0, 1, 2, 3, 4, 5, 6],
      slotDurationMins: 15,
      isSpecialTestSchedule: true
    };
  }

  return baseSchedule;
}

/**
 * Deterministically generate the next N available consultation slots for a doctor,
 * starting from "now" in IST, looking up to 7 days ahead.
 * Uses doctor's configured working hours, breaks, and slot duration (default: 15 mins).
 * Returns array of slot objects.
 */
function generateAvailableSlots(doctorId, maxSlots = 50, targetDate = null) {
  const slotLimit = (typeof maxSlots === "number" && maxSlots > 0) ? maxSlots : 100;
  const slots = [];
  const nowMs = Date.now();
  const todayIST = epochToISTDate(nowMs);

  // If a specific targetDate is requested:
  if (targetDate) {
    // If target date is in the past, return empty slots
    if (targetDate < todayIST) {
      return [];
    }

    const schedule = getDoctorScheduleForDate(doctorId, targetDate);
    const dow = getDayOfWeekIST(targetDate);
    // If target date is a non-working day for this doctor, return empty slots
    if (!schedule.workDays.includes(dow)) {
      return [];
    }

    const slotDurationMins = Number(schedule.slotDurationMins) || 15;
    const SLOT_DURATION_MS = slotDurationMins * 60 * 1000;
    const workStartMs = parseISTTime(targetDate, schedule.workStart);
    const workEndMs   = parseISTTime(targetDate, schedule.workEnd);

    let cursor = workStartMs;
    while (cursor + SLOT_DURATION_MS <= workEndMs && slots.length < slotLimit) {
      const slotEnd = cursor + SLOT_DURATION_MS;

      // Skip if slot has already finished today (do not display past slots)
      if (targetDate === todayIST && slotEnd <= nowMs) {
        cursor = slotEnd;
        continue;
      }

      // Skip if slot falls within any break window
      const inBreak = (schedule.breaks || []).some(b => {
        const bStart = parseISTTime(targetDate, b.start);
        const bEnd   = parseISTTime(targetDate, b.end);
        return cursor < bEnd && slotEnd > bStart;
      });
      if (inBreak) {
        cursor = slotEnd;
        continue;
      }

      // Skip if slot is already booked/conflicting
      if (isSlotConflicting(doctorId, targetDate, cursor, slotEnd)) {
        cursor = slotEnd;
        continue;
      }

      const slotStartTime = epochToISTTime(cursor);
      const slotEndTime   = epochToISTTime(slotEnd);

      slots.push({
        slotId: `${doctorId}-${targetDate}-${slotStartTime.replace(":", "")}`,
        doctorId,
        doctorName: (db.doctors || []).find(d => d.id === doctorId)?.name || "Doctor",
        specialty: (db.doctors || []).find(d => d.id === doctorId)?.specialty || "General Medicine",
        date: targetDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        durationMins: slotDurationMins,
        status: "available"
      });

      cursor = slotEnd;
    }

    return slots;
  }

  // If targetDate is NOT provided, search starting from todayIST across upcoming working days
  const [y0, m0, d0] = todayIST.split("-").map(Number);
  const maxDayOffset = 14;

  for (let dayOffset = 0; dayOffset <= maxDayOffset && slots.length < slotLimit; dayOffset++) {
    const targetDay = new Date(Date.UTC(y0, m0 - 1, d0 + dayOffset, 12, 0, 0));
    const dateStr = epochToISTDate(targetDay.getTime());
    const dow = getDayOfWeekIST(dateStr);
    const schedule = getDoctorScheduleForDate(doctorId, dateStr);

    if (!schedule.workDays.includes(dow)) continue;

    const slotDurationMins = Number(schedule.slotDurationMins) || 15;
    const SLOT_DURATION_MS = slotDurationMins * 60 * 1000;
    const workStartMs = parseISTTime(dateStr, schedule.workStart);
    const workEndMs   = parseISTTime(dateStr, schedule.workEnd);

    let cursor = workStartMs;
    while (cursor + SLOT_DURATION_MS <= workEndMs && slots.length < slotLimit) {
      const slotEnd = cursor + SLOT_DURATION_MS;

      // Skip if slot has already finished today (do not display past slots)
      if (dateStr === todayIST && slotEnd <= nowMs) {
        cursor = slotEnd;
        continue;
      }

      // Skip if slot falls within any break window
      const inBreak = (schedule.breaks || []).some(b => {
        const bStart = parseISTTime(dateStr, b.start);
        const bEnd   = parseISTTime(dateStr, b.end);
        return cursor < bEnd && slotEnd > bStart;
      });
      if (inBreak) {
        cursor = slotEnd;
        continue;
      }

      // Skip if slot is already booked/conflicting
      if (isSlotConflicting(doctorId, dateStr, cursor, slotEnd)) {
        cursor = slotEnd;
        continue;
      }

      const slotStartTime = epochToISTTime(cursor);
      const slotEndTime   = epochToISTTime(slotEnd);

      slots.push({
        slotId: `${doctorId}-${dateStr}-${slotStartTime.replace(":", "")}`,
        doctorId,
        doctorName: (db.doctors || []).find(d => d.id === doctorId)?.name || "Doctor",
        specialty: (db.doctors || []).find(d => d.id === doctorId)?.specialty || "General Medicine",
        date: dateStr,
        startTime: slotStartTime,
        endTime: slotEndTime,
        durationMins: slotDurationMins,
        status: "available"
      });

      cursor = slotEnd;
    }
  }

  return slots;
}

/**
 * Get all upcoming working dates for a doctor with their open slot counts.
 */
function getAvailableDatesForDoctor(doctorId, maxDays = 14) {
  const dates = [];
  const nowMs = Date.now();
  const todayIST = epochToISTDate(nowMs);
  const [y0, m0, d0] = todayIST.split("-").map(Number);

  for (let offset = 0; offset < maxDays; offset++) {
    const targetDay = new Date(Date.UTC(y0, m0 - 1, d0 + offset, 12, 0, 0));
    const dateStr = epochToISTDate(targetDay.getTime());
    const dow = getDayOfWeekIST(dateStr);
    const schedule = getDoctorScheduleForDate(doctorId, dateStr);

    if (!schedule.workDays.includes(dow)) continue;

    const openSlots = generateAvailableSlots(doctorId, 100, dateStr);
    const [yy, mm, dd] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
    const label = dateObj.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short"
    });

    // Always include today if it's a working day, and include days with open slots
    if (openSlots.length > 0 || dateStr === todayIST) {
      dates.push({
        date: dateStr,
        label,
        openSlotCount: openSlots.length,
        isToday: dateStr === todayIST,
        isTomorrow: offset === 1
      });
    }
  }

  return dates;
}

/**
 * AI Advisory: Uses historical appointment data to estimate demand level and wait time.
 * Returns a purely advisory object — never used to fabricate slots or confirm a booking.
 */
function getAIAdvisory(doctorId, slotDate, slotStartTime) {
  const history = (db.appointments || []).filter(a => a.assignedDoctorId === doctorId);
  const effectiveDate = slotDate || epochToISTDate(Date.now());
  const dow = getDayOfWeekIST(effectiveDate);
  const slotHour = parseInt((slotStartTime || "09:00").split(":")[0], 10);

  // Count appointments on same day-of-week and same hour (historical demand pattern)
  const historicalDemand = history.filter(a => {
    if (!a.scheduledDate) return false;
    const aDow = getDayOfWeekIST(a.scheduledDate);
    const aHour = a.scheduledStartTime ? parseInt(a.scheduledStartTime.split(":")[0], 10) : -1;
    return aDow === dow && aHour === slotHour;
  }).length;

  // Current queue depth for this doctor (waiting / confirmed / active consultations)
  const activeStatuses = ["Vitals Pending", "Waiting for Doctor Queue", "Waiting", "Active", "Confirmed", "Appointment Confirmed", "In Progress", "Queued"];
  const currentQueueDepth = (db.appointments || []).filter(
    a => a.assignedDoctorId === doctorId && activeStatuses.includes(a.status)
  ).length;

  const schedule = (db.doctorSchedules || {})[doctorId] || DEFAULT_DOCTOR_SCHEDULES[doctorId] || {};
  const slotDuration = Number(schedule.slotDurationMins) || 15;
  const estimatedWaitMins = Math.max(5, currentQueueDepth * slotDuration);

  // Demand level classification
  let demandLevel = "Low";
  let demandColor = "#10b981"; // green
  if (historicalDemand >= 3 || currentQueueDepth >= 4) {
    demandLevel = "High";
    demandColor = "#ef4444"; // red
  } else if (historicalDemand >= 1 || currentQueueDepth >= 2) {
    demandLevel = "Moderate";
    demandColor = "#f59e0b"; // amber
  }

  // Recommendation message
  let recommendation = "Good availability — optimal time to consult.";
  if (demandLevel === "High") {
    recommendation = "Peak demand period. Book early to confirm your slot.";
  } else if (demandLevel === "Moderate") {
    recommendation = "Moderate demand. Your slot is likely available.";
  }

  return {
    demandLevel,
    demandColor,
    estimatedWaitMins,
    queueDepth: currentQueueDepth,
    currentQueueDepth,
    recommendation,
    confidence: historicalDemand > 0 ? "data-driven" : "estimated"
  };
}

// Mutex to prevent double-booking race conditions
let slotBookingLock = false;

// -------------------------------------------------------------
// REST API ENDPOINTS FOR DATA PERSISTENCE & INITIAL STATE
// -------------------------------------------------------------

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Smart Village Digital Tele-Health Backend",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    appointmentsCount: db.appointments.length,
    activeSockets: io.engine.clientsCount
  });
});

// Full state sync
app.get("/api/db", (req, res) => {
  res.json({
    success: true,
    db: {
      users: db.users,
      doctors: db.doctors,
      patients: db.patients,
      appointments: db.appointments,
      consultations: db.consultations,
      villages: db.villages,
      failoverLogs: db.failoverLogs,
      agoraConfig: db.agoraConfig,
      doctorSchedules: db.doctorSchedules,
      bookedSlots: db.bookedSlots
    }
  });
});

// Appointments CRUD
app.get("/api/appointments", (req, res) => {
  res.json({ success: true, appointments: db.appointments });
});

// Bulk sync database state
app.post("/api/db/sync", (req, res) => {
  try {
    const { appointments, consultations, patients, doctors, failoverLogs } = req.body || {};
    if (Array.isArray(appointments)) db.appointments = appointments;
    if (Array.isArray(consultations)) db.consultations = consultations;
    if (Array.isArray(patients)) db.patients = patients;
    if (Array.isArray(doctors)) db.doctors = doctors;
    if (failoverLogs) db.failoverLogs = failoverLogs;
    saveDatabaseToFile();
    io.emit("appointments_updated", db.appointments);
    res.json({ success: true, message: "Database synchronized successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/appointments", (req, res) => {
  try {
    const body = req.body;
    if (!body) {
      return res.status(400).json({ success: false, error: "Missing request body" });
    }

    if (Array.isArray(body)) {
      // Bulk sync of appointments array
      db.appointments = body;
      saveDatabaseToFile();
      io.emit("appointments_updated", db.appointments);
      return res.status(200).json({ success: true, count: db.appointments.length });
    }

    const appData = body;
    if (!appData.token) {
      return res.status(400).json({ success: false, error: "Missing required appointment token" });
    }

    const idx = db.appointments.findIndex(a => a.token === appData.token);
    if (idx >= 0) {
      db.appointments[idx] = { ...db.appointments[idx], ...appData };
    } else {
      db.appointments.push(appData);
    }
    saveDatabaseToFile();

    io.to("role:vhw").to("role:doctor").emit("token_requested", {
      token: appData.token,
      appointment: appData,
      timestamp: Date.now()
    });
    io.emit("appointments_updated", db.appointments);

    res.status(201).json({ success: true, appointment: appData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/consultations/request — Step 1: Patient requests consultation, sets status to "Vitals Pending"
app.post("/api/consultations/request", (req, res) => {
  try {
    const { patientId, patientName, doctorId, symptoms, urgency, specialty } = req.body || {};
    if (!patientId || !doctorId) {
      return res.status(400).json({ success: false, error: "Missing required fields: patientId and doctorId." });
    }

    // Check if patient already has an active consultation request or appointment
    const blockingStatuses = ["Vitals Pending", "Waiting for Doctor Queue", "Appointment Confirmed", "Confirmed", "In Progress", "Active", "Rescheduled"];
    const existing = (db.appointments || []).find(
      a => a.patientId === patientId && blockingStatuses.includes(a.status)
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        conflict: true,
        error: `You already have an active consultation request (Token: ${existing.token}, Status: ${existing.status}). Please complete or cancel it first.`,
        appointment: existing
      });
    }

    const doctor = (db.doctors || []).find(d => d.id === doctorId);
    const patient = (db.patients || []).find(p => p.id === patientId);
    const villagePrefix = (patient && patient.village)
      ? (patient.village.includes("A") ? "VIL-A" : patient.village.includes("B") ? "VIL-B" : "VIL-C")
      : "VIL-A";
    const tokenNum = Math.floor(100 + Math.random() * 900);
    const token = `${villagePrefix}-${tokenNum}`;

    const newRequest = {
      token,
      consultationRequestId: token,
      patientId,
      patientName: patientName || (patient && patient.name) || "Patient",
      patientAge: patient ? patient.age : undefined,
      patientGender: patient ? patient.gender : undefined,
      patientPhone: patient ? patient.phone : undefined,
      patientVillage: patient ? patient.village : undefined,
      assignedDoctorId: doctorId,
      doctorName: doctor ? doctor.name : "Doctor",
      specialty: specialty || (doctor && doctor.specialty) || "General Medicine",
      symptoms: symptoms || "General Consultation",
      urgency: urgency || "Normal",
      status: "Vitals Pending",
      vitals: null,
      vitalsCompleted: false,
      requestTime: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      bookingTime: new Date().toISOString()
    };

    if (!Array.isArray(db.appointments)) db.appointments = [];
    db.appointments.push(newRequest);
    saveDatabaseToFile();

    // Broadcast consultation request to Health Worker and Doctor rooms
    io.to("role:vhw").to("role:doctor").emit("consultation_requested", {
      token,
      appointment: newRequest,
      timestamp: Date.now()
    });
    io.to("role:vhw").to("role:doctor").emit("token_requested", {
      token,
      appointment: newRequest,
      timestamp: Date.now()
    });
    io.emit("appointments_updated", db.appointments);

    console.log(`[Consultation] New request created: Token=${token}, Patient=${newRequest.patientName}, Status=Vitals Pending`);
    res.status(201).json({ success: true, consultationRequest: newRequest, token, appointment: newRequest });
  } catch (err) {
    console.error("[Consultation] POST /api/consultations/request error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vitals — Step 2: Health worker records and validates vitals, updates status to "Waiting for Doctor Queue"
app.post("/api/vitals", (req, res) => {
  try {
    const { token, patientId, vitals, urgency, specialty } = req.body || {};
    if (!vitals) {
      return res.status(400).json({ success: false, error: "Vitals data is required." });
    }

    // Input validation & normalization
    let bpSys = Number(vitals.bpSystolic);
    let bpDia = Number(vitals.bpDiastolic);
    if ((isNaN(bpSys) || isNaN(bpDia)) && typeof vitals.bp === "string" && vitals.bp.includes("/")) {
      const parts = vitals.bp.split("/");
      bpSys = Number(parts[0].trim());
      bpDia = Number(parts[1].trim());
    }
    const temp  = Number(vitals.temp !== undefined ? vitals.temp : vitals.temperature);
    const hr    = Number(vitals.hr !== undefined ? vitals.hr : (vitals.pulse !== undefined ? vitals.pulse : vitals.heartRate));
    const spo2  = Number(vitals.spo2);

    if (isNaN(bpSys) || bpSys < 50 || bpSys > 260) {
      return res.status(400).json({ success: false, error: "Invalid Blood Pressure (Systolic must be 50-260 mmHg)." });
    }
    if (isNaN(bpDia) || bpDia < 30 || bpDia > 160) {
      return res.status(400).json({ success: false, error: "Invalid Blood Pressure (Diastolic must be 30-160 mmHg)." });
    }
    if (isNaN(temp) || temp < 30 || temp > 45) {
      return res.status(400).json({ success: false, error: "Invalid Temperature (must be 30.0-45.0 °C)." });
    }
    if (isNaN(hr) || hr < 30 || hr > 220) {
      return res.status(400).json({ success: false, error: "Invalid Heart/Pulse Rate (must be 30-220 bpm)." });
    }
    if (isNaN(spo2) || spo2 < 50 || spo2 > 100) {
      return res.status(400).json({ success: false, error: "Invalid SpO2 (must be 50-100%)." });
    }

    // Find appointment by token or patientId
    let idx = -1;
    if (token) {
      idx = (db.appointments || []).findIndex(a => a.token === token);
    }
    if (idx === -1 && patientId) {
      idx = (db.appointments || []).findIndex(a => a.patientId === patientId && (a.status === "Vitals Pending" || a.status === "Waiting"));
    }
    if (idx === -1 && patientId) {
      idx = (db.appointments || []).findIndex(a => a.patientId === patientId && a.status !== "Completed" && a.status !== "Cancelled");
    }

    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Active consultation request not found for provided token or patient." });
    }

    const appRecord = db.appointments[idx];
    appRecord.vitals = {
      bpSystolic: bpSys,
      bpDiastolic: bpDia,
      bp: `${bpSys}/${bpDia}`,
      temp: temp,
      temperature: temp,
      hr: hr,
      pulse: hr,
      spo2: spo2,
      sugar: vitals.sugar !== undefined ? Number(vitals.sugar) : 110,
      pain: vitals.pain !== undefined ? Number(vitals.pain) : 0,
      photo: vitals.photo || null
    };
    appRecord.vitalsCompleted = true;
    appRecord.vitalsRecordedAt = new Date().toISOString();
    appRecord.status = "Waiting for Doctor Queue"; // <-- Transition status
    if (urgency) appRecord.urgency = urgency;
    if (specialty) appRecord.specialty = specialty;

    saveDatabaseToFile();

    console.log(`[Vitals] Vitals recorded for Token=${appRecord.token}, Status=Waiting for Doctor Queue`);

    // Notify doctor queue and health workers
    io.to("role:doctor").to("role:vhw").emit("patient_added_to_queue", {
      token: appRecord.token,
      urgency: appRecord.urgency,
      appointment: appRecord,
      status: "Waiting for Doctor Queue",
      timestamp: Date.now()
    });

    // Notify the patient that vitals are recorded and consultation is ready for scheduling
    const vitalsEventPayload = {
      token: appRecord.token,
      patientId: appRecord.patientId,
      vitals: appRecord.vitals,
      urgency: appRecord.urgency,
      appointment: appRecord,
      status: "Waiting for Doctor Queue",
      timestamp: Date.now()
    };
    if (appRecord.patientId) {
      io.to(`user:${appRecord.patientId}`).emit("vitals_recorded", vitalsEventPayload);
    } else {
      io.to(`consultation:${appRecord.token}`).emit("vitals_recorded", vitalsEventPayload);
    }

    io.emit("appointments_updated", db.appointments);
    res.json({ success: true, appointment: appRecord, token: appRecord.token });
  } catch (err) {
    console.error("[Vitals] POST /api/vitals error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/appointments/:token", (req, res) => {
  try {
    const { token } = req.params;
    const updates = req.body;
    const idx = db.appointments.findIndex(a => a.token === token);

    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    db.appointments[idx] = { ...db.appointments[idx], ...updates };
    saveDatabaseToFile();

    io.emit("appointments_updated", db.appointments);
    res.json({ success: true, appointment: db.appointments[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/appointments/:token", (req, res) => {
  try {
    const { token } = req.params;
    const idx = db.appointments.findIndex(a => a.token === token);
    if (idx >= 0) {
      db.appointments.splice(idx, 1);
      saveDatabaseToFile();
      io.emit("appointments_updated", db.appointments);
      return res.json({ success: true, message: `Appointment ${token} cancelled.` });
    }
    res.status(404).json({ success: false, error: "Appointment not found" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Consultations CRUD
app.get("/api/consultations", (req, res) => {
  res.json({ success: true, consultations: db.consultations });
});

app.post("/api/consultations", (req, res) => {
  try {
    const consultation = req.body;
    if (!consultation || !consultation.id) {
      return res.status(400).json({ success: false, error: "Missing consultation ID" });
    }

    const cIdx = db.consultations.findIndex(c => c.id === consultation.id || (c.token && c.token === consultation.token));
    if (cIdx >= 0) {
      db.consultations[cIdx] = { ...db.consultations[cIdx], ...consultation };
    } else {
      db.consultations.push(consultation);
    }

    // Also update patient history in db.patients
    const targetPatId = consultation.patientId;
    const targetPatName = consultation.patientName;
    if (targetPatId || targetPatName) {
      const pat = db.patients.find(p => (targetPatId && p.id === targetPatId) || (targetPatName && p.name === targetPatName));
      if (pat) {
        if (!Array.isArray(pat.history)) pat.history = [];
        const exists = pat.history.some(h => h.id === consultation.id || (h.date === consultation.date && h.diagnosis === consultation.diagnosis));
        if (!exists) {
          pat.history.push({
            id: consultation.id,
            date: consultation.date || new Date().toISOString().split("T")[0],
            clinic: consultation.specialty || "General Medicine",
            diagnosis: consultation.diagnosis || "Consultation Completed",
            medicines: consultation.medicines || consultation.prescription || "",
            doctor: consultation.doctorName || "Doctor"
          });
        }
      }
    }

    // Update appointment status to Completed
    if (consultation.token) {
      const aIdx = db.appointments.findIndex(a => a.token === consultation.token);
      if (aIdx >= 0) {
        db.appointments[aIdx].status = "Completed";
        db.appointments[aIdx].completedAt = new Date().toISOString();
      }
    }

    saveDatabaseToFile();
    io.emit("consultations_updated", db.consultations);
    io.emit("consultation_saved", consultation);
    io.emit("appointments_updated", db.appointments);

    res.status(201).json({ success: true, consultation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Patients & Doctors directory
app.get("/api/patients", (req, res) => {
  res.json({ success: true, patients: db.patients });
});

app.post("/api/patients", (req, res) => {
  try {
    const pat = req.body;
    if (!pat || !pat.id) return res.status(400).json({ error: "Missing patient ID" });
    const idx = db.patients.findIndex(p => p.id === pat.id);
    if (idx >= 0) db.patients[idx] = { ...db.patients[idx], ...pat };
    else db.patients.push(pat);
    saveDatabaseToFile();
    res.json({ success: true, patient: pat });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/doctors", (req, res) => {
  res.json({ success: true, doctors: db.doctors });
});

// ---------------------------------------------------------------
// SMART CONSULTATION SLOT SCHEDULING ENDPOINTS
// ---------------------------------------------------------------

// GET /api/slots?doctorId=doc-1 — Returns available 15-min slots + AI advisory + available dates
app.get("/api/slots", (req, res) => {
  try {
    const { doctorId, maxSlots, date, all } = req.query;
    if (!doctorId) {
      return res.status(400).json({ success: false, error: "Missing doctorId" });
    }
    let limit;
    if (maxSlots !== undefined) {
      limit = maxSlots === "all" ? 200 : (parseInt(maxSlots, 10) || 3);
    } else if (all === "true" || date) {
      limit = 200;
    } else {
      limit = 3; // Default 3 for backwards compatibility with tests expecting <= 3 slots by default
    }

    const slots = generateAvailableSlots(doctorId, limit, date || null);

    // Attach AI advisory to each slot
    const slotsWithAdvisory = slots.map(slot => ({
      ...slot,
      aiAdvisory: getAIAdvisory(doctorId, slot.date, slot.startTime)
    }));

    const topSlot = slotsWithAdvisory[0];
    const aiAdvisory = getAIAdvisory(doctorId, topSlot ? topSlot.date : null, topSlot ? topSlot.startTime : null);
    const doc = (db.doctors || []).find(d => d.id === doctorId);

    // Available dates with open slot counts for date selector
    const availableDates = getAvailableDatesForDoctor(doctorId, 14);

    res.json({
      success: true,
      doctorId,
      doctorName: doc ? doc.name : "Doctor",
      specialty: doc ? doc.specialty : "General Medicine",
      slots: slotsWithAdvisory,
      aiAdvisory,
      totalAvailable: slotsWithAdvisory.length,
      selectedDate: date || (topSlot ? topSlot.date : null),
      availableDates
    });
  } catch (err) {
    console.error("[Slots] GET /api/slots error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/slots/book — Atomically books a slot (double-booking safe)
app.post("/api/slots/book", async (req, res) => {
  if (slotBookingLock) {
    return res.status(409).json({
      success: false,
      conflict: true,
      error: "Another booking is currently being processed. Please retry in a moment."
    });
  }
  slotBookingLock = true;
  try {
    const { doctorId, date, startTime, endTime, patientId, patientName, symptoms, urgency, specialty, token: clientToken, consultationRequestId } = req.body || {};

    if (!doctorId || !date || !startTime || !patientId) {
      return res.status(400).json({ success: false, error: "Missing required booking fields (doctorId, date, startTime, patientId)." });
    }

    // Schedule check for doctor slot duration
    const schedule = getDoctorScheduleForDate(doctorId, date);
    const slotDurationMins = Number(schedule.slotDurationMins) || 15;
    const startEpoch = parseISTTime(date, startTime);
    const endEpoch   = endTime ? parseISTTime(date, endTime) : (startEpoch + slotDurationMins * 60 * 1000);
    const realEndEpoch = endEpoch > startEpoch ? endEpoch : (startEpoch + slotDurationMins * 60 * 1000);

    // Re-validate slot availability right before booking (Double-booking prevention)
    if (isSlotConflicting(doctorId, date, startEpoch, realEndEpoch)) {
      return res.status(409).json({
        success: false,
        conflict: true,
        error: "This slot was just booked by another patient. We have refreshed the available slots for you."
      });
    }

    // Check for existing consultation request or appointment for this patient
    const tokenToFind = clientToken || consultationRequestId;
    let existingApp = null;
    if (tokenToFind) {
      existingApp = (db.appointments || []).find(a => a.token === tokenToFind);
    }
    if (!existingApp) {
      existingApp = (db.appointments || []).find(
        a => a.patientId === patientId && (a.status === "Waiting for Doctor Queue" || a.status === "Vitals Pending")
      );
    }

    // REQUIREMENT: Patient cannot book before health worker has saved vitals!
    if (existingApp && (existingApp.status === "Vitals Pending" || !existingApp.vitals)) {
      return res.status(400).json({
        success: false,
        error: "Vitals must be recorded by a health worker before booking an appointment slot."
      });
    }

    // Check patient doesn't already have another confirmed/active appointment
    const blockingPatientStatuses = ["Appointment Confirmed", "Confirmed", "Active", "In Progress", "Rescheduled"];
    const conflictingActiveApp = (db.appointments || []).find(
      a => a.patientId === patientId && blockingPatientStatuses.includes(a.status) && a.token !== (existingApp ? existingApp.token : null)
    );
    if (conflictingActiveApp) {
      return res.status(409).json({
        success: false,
        error: "You already have an active consultation booked (Token: " + conflictingActiveApp.token + "). Please complete, reschedule, or cancel it before booking a new slot."
      });
    }

    // Generate unique token or reuse existing request token
    const doctor = (db.doctors || []).find(d => d.id === doctorId);
    const patient = (db.patients || []).find(p => p.id === patientId);
    const villagePrefix = (patient && patient.village)
      ? (patient.village.includes("A") ? "VIL-A" : patient.village.includes("B") ? "VIL-B" : "VIL-C")
      : "VIL-A";
    const token = existingApp ? existingApp.token : `${villagePrefix}-${Math.floor(100 + Math.random() * 900)}`;
    const slotId = `${doctorId}-${date}-${startTime.replace(":", "")}-${Math.random().toString(36).slice(2, 6)}`;
    const endTimeStr = epochToISTTime(realEndEpoch);

    // Create the booked slot record
    const bookedSlot = {
      slotId,
      doctorId,
      date,
      startTime,
      endTime: endTimeStr,
      token,
      patientId,
      patientName: patientName || (existingApp && existingApp.patientName) || (patient && patient.name) || "Patient",
      status: "booked",
      bookedAt: new Date().toISOString()
    };
    if (!Array.isArray(db.bookedSlots)) db.bookedSlots = [];
    db.bookedSlots.push(bookedSlot);

    let finalApp = null;
    if (existingApp) {
      // Update existing consultation request to "Appointment Confirmed"
      existingApp.assignedDoctorId = doctorId;
      existingApp.doctorName = doctor ? doctor.name : (existingApp.doctorName || "Doctor");
      existingApp.specialty = specialty || (doctor && doctor.specialty) || existingApp.specialty || "General Medicine";
      existingApp.scheduledDate = date;
      existingApp.scheduledStartTime = startTime;
      existingApp.scheduledEndTime = endTimeStr;
      existingApp.slotDurationMins = slotDurationMins;
      existingApp.slotId = slotId;
      existingApp.status = "Appointment Confirmed";
      existingApp.bookedAt = new Date().toISOString();
      existingApp.bookingTime = new Date().toISOString();
      finalApp = existingApp;
    } else {
      // Create new appointment record with standard confirmed status
      finalApp = {
        token,
        consultationRequestId: token,
        patientId,
        patientName: patientName || (patient && patient.name) || "Patient",
        patientAge: patient ? patient.age : undefined,
        patientGender: patient ? patient.gender : undefined,
        patientPhone: patient ? patient.phone : undefined,
        patientVillage: patient ? patient.village : undefined,
        symptoms: symptoms || "General Consultation",
        urgency: urgency || "Normal",
        specialty: specialty || (doctor && doctor.specialty) || "General Medicine",
        assignedDoctorId: doctorId,
        doctorName: doctor ? doctor.name : undefined,
        status: "Appointment Confirmed",
        scheduledDate: date,
        scheduledStartTime: startTime,
        scheduledEndTime: endTimeStr,
        slotDurationMins: slotDurationMins,
        slotId,
        vitals: null,
        bookingTime: new Date().toISOString(),
        bookedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      db.appointments.push(finalApp);
    }
    saveDatabaseToFile();

    console.log(`[Slots] Slot booked: ${slotId} by ${patientId} on ${date} at ${startTime}, token=${token}, status=Appointment Confirmed`);

    // Real-time broadcast to ALL clients (so other patients immediately see the slot removed!)
    io.emit("slot_booked", {
      slotId,
      doctorId,
      date,
      startTime,
      endTime: endTimeStr,
      token,
      patientId,
      patientName: bookedSlot.patientName,
      appointment: finalApp,
      timestamp: Date.now()
    });

    // Broadcast appointment confirmation to patient, doctor, and health workers
    io.emit("appointment_confirmed", {
      appointment: finalApp,
      timestamp: Date.now()
    });

    io.emit("appointments_updated", db.appointments);

    res.status(201).json({ success: true, token, slotId, appointment: finalApp, bookedSlot });
  } catch (err) {
    console.error("[Slots] POST /api/slots/book error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    slotBookingLock = false;
  }
});

// POST /api/appointments/:token/reschedule — Reschedule a confirmed appointment to a new slot
app.post("/api/appointments/:token/reschedule", async (req, res) => {
  if (slotBookingLock) {
    return res.status(409).json({ success: false, conflict: true, error: "Another booking operation is in progress. Please retry in a moment." });
  }
  slotBookingLock = true;
  try {
    const { token } = req.params;
    const newSlot = (req.body && req.body.newSlot) || {};
    const newDate = (req.body && req.body.newDate) || newSlot.date;
    const newStartTime = (req.body && req.body.newStartTime) || newSlot.startTime;
    const newEndTime = (req.body && req.body.newEndTime) || newSlot.endTime;
    const reason = (req.body && req.body.reason) || "";

    if (!newDate || !newStartTime) {
      return res.status(400).json({ success: false, error: "newDate (or newSlot.date) and newStartTime (or newSlot.startTime) are required." });
    }

    const appIdx = db.appointments.findIndex(a => a.token === token);
    if (appIdx < 0) {
      return res.status(404).json({ success: false, error: "Appointment not found." });
    }
    const app = db.appointments[appIdx];
    const doctorId = app.assignedDoctorId || "doc-1";

    const schedule = (db.doctorSchedules || {})[doctorId] || DEFAULT_DOCTOR_SCHEDULES[doctorId] || {};
    const slotDurationMins = Number(schedule.slotDurationMins) || 15;
    const startEpoch = parseISTTime(newDate, newStartTime);
    const endEpoch = newEndTime ? parseISTTime(newDate, newEndTime) : (startEpoch + slotDurationMins * 60 * 1000);
    const realEndEpoch = endEpoch > startEpoch ? endEpoch : (startEpoch + slotDurationMins * 60 * 1000);

    // Re-check conflict for new slot
    if (isSlotConflicting(doctorId, newDate, startEpoch, realEndEpoch)) {
      return res.status(409).json({
        success: false,
        conflict: true,
        error: "The chosen reschedule slot is no longer available. Please select another slot."
      });
    }

    // Release old slot in bookedSlots
    if (Array.isArray(db.bookedSlots)) {
      db.bookedSlots.forEach(s => {
        if (s.token === token && s.status !== "cancelled") {
          s.status = "rescheduled";
          io.emit("slot_cancelled", { slotId: s.slotId, doctorId, timestamp: Date.now() });
        }
      });
    }

    // Record new booked slot
    const newSlotId = `${doctorId}-${newDate}-${newStartTime.replace(":", "")}-${Math.random().toString(36).slice(2, 6)}`;
    const endTimeStr = epochToISTTime(realEndEpoch);
    const newBookedSlot = {
      slotId: newSlotId,
      doctorId,
      date: newDate,
      startTime: newStartTime,
      endTime: endTimeStr,
      token,
      patientId: app.patientId,
      patientName: app.patientName,
      status: "booked",
      bookedAt: new Date().toISOString()
    };
    if (!Array.isArray(db.bookedSlots)) db.bookedSlots = [];
    db.bookedSlots.push(newBookedSlot);

    // Update appointment record
    app.scheduledDate = newDate;
    app.scheduledStartTime = newStartTime;
    app.scheduledEndTime = endTimeStr;
    app.status = "Rescheduled";
    app.slotId = newSlotId;
    app.rescheduledAt = new Date().toISOString();
    if (reason) app.rescheduleReason = reason;

    saveDatabaseToFile();

    io.emit("slot_booked", {
      slotId: newSlotId,
      doctorId,
      date: newDate,
      startTime: newStartTime,
      endTime: endTimeStr,
      token,
      patientId: app.patientId,
      appointment: app,
      timestamp: Date.now()
    });
    io.emit("appointments_updated", db.appointments);

    res.json({ success: true, message: "Appointment rescheduled successfully.", appointment: app });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    slotBookingLock = false;
  }
});

// POST /api/appointments/:token/cancel — Cancel an appointment and free its slot
app.post("/api/appointments/:token/cancel", (req, res) => {
  try {
    const { token } = req.params;
    const { reason } = req.body || {};

    const appIdx = db.appointments.findIndex(a => a.token === token);
    if (appIdx < 0) {
      return res.status(404).json({ success: false, error: "Appointment not found." });
    }
    const app = db.appointments[appIdx];
    app.status = "Cancelled";
    app.cancelledAt = new Date().toISOString();
    if (reason) app.cancelReason = reason;

    // Free the linked slot in bookedSlots
    let freedSlotId = null;
    if (Array.isArray(db.bookedSlots)) {
      db.bookedSlots.forEach(s => {
        if (s.token === token && s.status !== "cancelled") {
          s.status = "cancelled";
          freedSlotId = s.slotId;
        }
      });
    }

    saveDatabaseToFile();

    if (freedSlotId) {
      io.emit("slot_cancelled", { slotId: freedSlotId, doctorId: app.assignedDoctorId, timestamp: Date.now() });
    }
    io.emit("appointments_updated", db.appointments);

    res.json({ success: true, message: `Appointment ${token} cancelled successfully.`, appointment: app });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/slots/:slotId — Cancel a booked slot
app.delete("/api/slots/:slotId", (req, res) => {
  try {
    const { slotId } = req.params;
    if (!Array.isArray(db.bookedSlots)) db.bookedSlots = [];
    const idx = db.bookedSlots.findIndex(s => s.slotId === slotId);
    if (idx < 0) {
      return res.status(404).json({ success: false, error: "Slot not found." });
    }
    const slot = db.bookedSlots[idx];
    db.bookedSlots[idx].status = "cancelled";

    // Also cancel the linked appointment
    const appIdx = db.appointments.findIndex(a => a.token === slot.token);
    if (appIdx >= 0) {
      db.appointments[appIdx].status = "Cancelled";
      db.appointments[appIdx].cancelledAt = new Date().toISOString();
    }
    saveDatabaseToFile();

    io.emit("slot_cancelled", { slotId, doctorId: slot.doctorId, timestamp: Date.now() });
    io.emit("appointments_updated", db.appointments);
    res.json({ success: true, message: "Slot cancelled successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/doctor/schedule/:doctorId — Retrieve a doctor's schedule config
app.get("/api/doctor/schedule/:doctorId", (req, res) => {
  try {
    const { doctorId } = req.params;
    const schedule = (db.doctorSchedules || {})[doctorId] || DEFAULT_DOCTOR_SCHEDULES[doctorId] || {
      workStart: "09:00",
      workEnd: "17:00",
      breaks: [{ start: "13:00", end: "14:00" }],
      workDays: [1,2,3,4,5,6],
      slotDurationMins: 15
    };
    res.json({ success: true, doctorId, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/doctor/schedule/:doctorId — Doctor updates their working hours, breaks, and consultation duration
app.put("/api/doctor/schedule/:doctorId", (req, res) => {
  try {
    const { doctorId } = req.params;
    const { workStart, workEnd, breaks, workDays, slotDurationMins } = req.body || {};
    if (!workStart || !workEnd) {
      return res.status(400).json({ success: false, error: "workStart and workEnd are required." });
    }
    if (!db.doctorSchedules) db.doctorSchedules = {};
    db.doctorSchedules[doctorId] = {
      workStart,
      workEnd,
      breaks: Array.isArray(breaks) ? breaks : [{ start: "13:00", end: "14:00" }],
      workDays: Array.isArray(workDays) ? workDays : [1,2,3,4,5,6],
      slotDurationMins: Number(slotDurationMins) || 15
    };
    saveDatabaseToFile();
    console.log(`[Schedule] ${doctorId} updated schedule:`, db.doctorSchedules[doctorId]);

    // Broadcast schedule update to ALL patients, doctors, and health workers
    io.emit("schedule_updated", {
      doctorId,
      schedule: db.doctorSchedules[doctorId],
      timestamp: Date.now()
    });
    res.json({ success: true, schedule: db.doctorSchedules[doctorId] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/agora/token — Dynamically generates Agora RTC tokens server-side.
// Uses AGORA_APP_CERTIFICATE env var for proper token generation (never expires manually).
// Falls back to static AGORA_TOKEN env var if certificate not configured.
// Channel is always "telehealth-room".
app.get("/api/agora/token", (req, res) => {
  try {
    const { role, userId } = req.query;
    const channel = "telehealth-room";
    const appid = process.env.AGORA_APP_ID || db.agoraConfig.appid || "aab8b3f972274fcb87cc25048d089e94";
    const appCertificate = process.env.AGORA_APP_CERTIFICATE || null;

    // Parse numeric UID (Agora requires numeric UID for token binding; 0 = any user)
    let numericUid = 0;
    if (userId) {
      const parsed = parseInt(userId, 10);
      numericUid = isNaN(parsed) ? 0 : parsed;
    }

    const uidStr = String(userId || `${role || "user"}_${Math.floor(Math.random() * 10000)}`);
    const expireTimestamp = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    let agoraToken = null;

    // 1. Try server-side dynamic token generation using App Certificate (best option)
    if (appCertificate && appCertificate.length > 10 && agoraTokenLib) {
      const rtcRole = (role === "doctor") ? "publisher" : "publisher"; // Both publish video+audio
      agoraToken = generateAgoraToken(appid, appCertificate, channel, numericUid, rtcRole);
      if (agoraToken) {
        console.log(`[Agora] Generated dynamic token for uid=${numericUid} channel=${channel} role=${role}`);
      } else {
        console.warn("[Agora] Dynamic token generation failed, falling back to static token");
      }
    }

    // 2. Fallback to static token from env var (may expire after ~24h)
    if (!agoraToken) {
      const envToken = process.env.AGORA_TOKEN ? process.env.AGORA_TOKEN.trim() : null;
      const dbToken = db.agoraConfig.token ? String(db.agoraConfig.token).trim() : null;
      agoraToken = (envToken && envToken.length > 10) ? envToken
                 : (dbToken && dbToken.length > 10) ? dbToken
                 : null;
      if (agoraToken) {
        console.log(`[Agora] Using static token (set AGORA_APP_CERTIFICATE for dynamic tokens)`);
      } else {
        console.warn("[Agora] No token available — set AGORA_APP_CERTIFICATE or AGORA_TOKEN in env vars");
      }
    }

    res.json({
      success: true,
      appid,
      channel,
      token: agoraToken,
      uid: uidStr,
      numericUid,
      role: role || "patient",
      expiresAt: expireTimestamp,
      generatedDynamically: !!(appCertificate && agoraToken)
    });
  } catch (err) {
    console.error("[Agora] /api/agora/token error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agora Configuration
app.get("/api/agora/config", (req, res) => {
  res.json({ success: true, agoraConfig: db.agoraConfig });
});

app.post("/api/agora/config", (req, res) => {
  try {
    const { appid, token, channel, enabled } = req.body || {};
    db.agoraConfig = {
      appid: appid || db.agoraConfig.appid,
      token: token !== undefined ? token : db.agoraConfig.token,
      channel: channel || db.agoraConfig.channel,
      enabled: enabled !== undefined ? enabled : db.agoraConfig.enabled
    };
    saveDatabaseToFile();
    io.emit("agora_config_updated", db.agoraConfig);
    res.json({ success: true, agoraConfig: db.agoraConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// TURN CREDENTIALS ENDPOINT
// Returns ICE server configuration (STUN + TURN) for WebRTC peers.
// TURN is essential when both peers are behind NAT/firewalls (e.g. Render deployment).
// Uses Metered free TURN by default; override via env vars for production.
// -------------------------------------------------------------
app.get("/api/turn-credentials", (req, res) => {
  try {
    // Primary: Use env-configured TURN servers (set these in Render dashboard)
    const turnUser = process.env.TURN_USERNAME || "";
    const turnCred = process.env.TURN_CREDENTIAL || "";
    const turnHost = process.env.TURN_HOST || "global.relay.metered.ca";

    const iceServers = [
      // Public STUN servers (no auth needed)
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ];

    // Add TURN relay servers if credentials are configured
    if (turnUser && turnCred) {
      iceServers.push(
        {
          urls: `turn:${turnHost}:80`,
          username: turnUser,
          credential: turnCred
        },
        {
          urls: `turn:${turnHost}:443`,
          username: turnUser,
          credential: turnCred
        },
        {
          urls: `turns:${turnHost}:443`,
          username: turnUser,
          credential: turnCred
        },
        {
          urls: `turn:${turnHost}:80?transport=tcp`,
          username: turnUser,
          credential: turnCred
        }
      );
    } else {
      // Fallback: free open TURN servers for development/demo (rate-limited)
      // These work for demos but should be replaced with proper TURN in production
      iceServers.push(
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turns:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      );
    }

    res.json({
      success: true,
      iceServers,
      ttl: 86400
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// STATIC FILE SERVING FOR PRODUCTION DEPLOYMENT
// -------------------------------------------------------------
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  console.log(`[Static] Serving compiled frontend from ${distPath}`);
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(path.join(distPath, "index.html"));
    }
    next();
  });
} else {
  // Serve static files from root directory if dist hasn't been built
  app.use(express.static(__dirname));
}

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
if (require.main === module) {
  const os = require("os");
  server.listen(PORT, "0.0.0.0", () => {
    console.log("=================================================================");
    console.log(`  Smart Village Tele-Health Shared Server is RUNNING`);
    console.log(`  Port: ${PORT}`);
    console.log(`  Local: http://localhost:${PORT}`);
    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            console.log(`  LAN Access (Wi-Fi/Network): http://${net.address}:${PORT}`);
          }
        }
      }
    } catch (e) {}
    console.log(`  Cloud: Listening on 0.0.0.0:${PORT} for internet & cloud deployments`);
    console.log("=================================================================");
  });
}

module.exports = {
  app,
  server,
  io,
  db,
  parseISTTime,
  epochToISTDate,
  epochToISTTime,
  getDayOfWeekIST,
  isSlotConflicting,
  generateAvailableSlots,
  getAvailableDatesForDoctor,
  getDoctorScheduleForDate,
  getAIAdvisory,
  DEFAULT_DOCTOR_SCHEDULES
};
