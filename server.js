const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

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
    patientName: "Sarah Mitchell",
    symptoms: "Hypertension checkup, mild dizziness",
    urgency: "Normal",
    specialty: "General Medicine",
    assignedDoctorId: "doc-4",
    status: "Waiting",
    vitals: { bpSystolic: 138, bpDiastolic: 88, sugar: 115, temp: 36.8, spo2: 97, hr: 78, pain: 1, photo: null }
  }
];

// CENTRALIZED DATABASE MANAGEMENT
// -------------------------------------------------------------
let db = {
  users: [],
  doctors: [],
  patients: [],
  appointments: [...DEFAULT_APPOINTMENTS],
  consultations: [],
  villages: ["Village Clinic A", "Village Clinic B", "Village Clinic C"],
  failoverLogs: { hd: 0, low: 0, audio: 0 },
  agoraConfig: {
    enabled: true,
    appid: "aab8b3f972274fcb87cc25048d089e94",
    token: "",
    channel: "telehealth-room"
  }
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      db = {
        ...db,
        ...parsed,
        agoraConfig: parsed.agoraConfig || db.agoraConfig
      };
      if (!Array.isArray(db.appointments) || db.appointments.length === 0) {
        db.appointments = [...DEFAULT_APPOINTMENTS];
      }
      console.log(`[DB] Centralized database loaded successfully (${db.appointments.length} appointments, ${db.patients.length} patients).`);
    } else {
      console.warn(`[DB] Database file not found at ${DB_FILE_PATH}, creating default.`);
      db.appointments = [...DEFAULT_APPOINTMENTS];
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
  pingTimeout: 30000,
  pingInterval: 10000
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
        db.appointments[idx].urgency = urgency;
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
        timestamp: Date.now()
      });

      if (patientId) {
        io.to(`user:${patientId}`).emit("vitals_recorded", {
          token,
          vitals,
          urgency,
          appointment: updatedApp,
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

      // Target the patient device directly via user room, role:patient room, and consultation room
      io.to("role:patient")
        .to(`user:${targetPatientId}`)
        .to(`consultation:${token}`)
        .emit("consultation_requested", {
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
        const cIdx = db.consultations.findIndex(c => c.id === consultation.id);
        if (cIdx >= 0) {
          db.consultations[cIdx] = consultation;
        } else {
          db.consultations.push(consultation);
        }
      }

      saveDatabaseToFile();

      io.to(`consultation:${token}`).emit("consultation_ended", {
        token,
        consultation,
        timestamp: Date.now()
      });

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
});

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
      agoraConfig: db.agoraConfig
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

    const cIdx = db.consultations.findIndex(c => c.id === consultation.id);
    if (cIdx >= 0) {
      db.consultations[cIdx] = consultation;
    } else {
      db.consultations.push(consultation);
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
server.listen(PORT, "0.0.0.0", () => {
  console.log("=================================================================");
  console.log(`  Smart Village Tele-Health Shared Server is RUNNING`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Local: http://localhost:${PORT}`);
  console.log(`  Network: Listening on 0.0.0.0:${PORT} for cross-device access`);
  console.log("=================================================================");
});
