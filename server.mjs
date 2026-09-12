import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const dataFile = join(dataDir, "database.json");
const port = Number(process.env.PORT || 4173);
const sessions = new Map();

const doctors = [
  { id: "doc-1", name: "Dr. Vikram", specialty: "General Medicine", email: "doc.vikram@villagemed.in", online: true },
  { id: "doc-2", name: "Dr. Dharani", specialty: "Cardiology", email: "doc.dharani@villagemed.in", online: true },
  { id: "doc-3", name: "Dr. Naveen", specialty: "Neurology", email: "doc.naveen@villagemed.in", online: true },
  { id: "doc-4", name: "Dr. Abinesh V", specialty: "General Medicine", email: "doc.abinesh@villagemed.in", online: true },
  { id: "doc-5", name: "Dr. Priya", specialty: "Cardiology", email: "doc.priya@villagemed.in", online: true }
];

const patients = [
  { id: "pat-5", name: "Dharaneesh", age: 21, gender: "Male", phone: "9876543211", email: "dharaneesh@gmail.com", village: "Village Clinic A", history: [] },
  { id: "pat-9", name: "Meenakshi", age: 54, gender: "Female", phone: "9876543212", email: "meenakshi@gmail.com", village: "Village Clinic B", history: [] },
  { id: "pat-12", name: "Rajan Kumar", age: 34, gender: "Male", phone: "9876543213", email: "rajan@gmail.com", village: "Village Clinic A", history: [] },
  { id: "pat-1", name: "Sarah Mitchell", age: 67, gender: "Female", phone: "9876543210", email: "sarah@gmail.com", village: "Village Clinic A", history: [] },
  { id: "pat-2", name: "Fatima Al-Hassan", age: 61, gender: "Female", phone: "9845612307", email: "fatima@gmail.com", village: "Village Clinic B", history: [] },
  { id: "pat-3", name: "James Rodriguez", age: 45, gender: "Male", phone: "8123456789", email: "james@gmail.com", village: "Village Clinic A", history: [] },
  { id: "pat-4", name: "Robert Okafor", age: 78, gender: "Male", phone: "9012345678", email: "robert@gmail.com", village: "Village Clinic C", history: [] }
];

const defaultDatabase = () => ({
  users: [
    ...doctors.map(doctor => ({ id: doctor.id, role: "doctor", email: doctor.email, passwordHash: hashPassword(doctor.id === "doc-4" ? "password123" : "password"), profileId: doctor.id })),
    ...patients.map(patient => ({ id: `user-${patient.id}`, role: "patient", email: patient.email, phone: patient.phone, passwordHash: hashPassword("password"), profileId: patient.id })),
    { id: "user-vhw-1", role: "vhw", email: "vhw@villagemed.in", passwordHash: hashPassword("password"), profileId: "vhw-1" },
    { id: "user-admin-1", role: "admin", email: "admin@villagemed.in", passwordHash: hashPassword("password"), profileId: "admin-1" }
  ],
  doctors,
  patients,
  appointments: [],
  consultations: [],
  villages: ["Village Clinic A", "Village Clinic B", "Village Clinic C"],
  failoverLogs: { hd: 0, low: 0, audio: 0 }
});

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function loadDatabase() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    const database = defaultDatabase();
    writeFileSync(dataFile, JSON.stringify(database, null, 2));
    return database;
  }
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

let database = loadDatabase();

function persist() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataFile, JSON.stringify(database, null, 2));
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function body(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function authUser(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = sessions.get(token);
  return userId ? database.users.find(user => user.id === userId) : null;
}

function publicUser(user) {
  if (user.role === "doctor") return database.doctors.find(doctor => doctor.id === user.profileId);
  if (user.role === "patient") return database.patients.find(patient => patient.id === user.profileId);
  return { id: user.profileId, name: user.role === "vhw" ? "Nurse Anjali" : "System Admin", role: user.role, email: user.email, village: "Village Clinic A" };
}

function stateFor(user) {
  const consultations = database.consultations.filter(consultation => {
    if (user.role === "doctor") return consultation.doctorId === user.profileId;
    if (user.role === "patient") return consultation.patientId === user.profileId;
    return true;
  });
  const appointments = user.role === "patient"
    ? database.appointments.filter(appointment => appointment.patientId === user.profileId)
    : database.appointments;
  return {
    ...database,
    users: undefined,
    consultations,
    appointments,
    currentUser: publicUser(user)
  };
}

function canWriteState(user, next) {
  if (["admin", "vhw"].includes(user.role)) return true;
  if (user.role === "doctor") {
    return (next.consultations || []).every(consultation => consultation.doctorId === user.profileId || !consultation.doctorId);
  }
  if (user.role === "patient") {
    return (next.consultations || []).every(consultation => consultation.patientId === user.profileId) &&
      (next.appointments || []).every(appointment => appointment.patientId === user.profileId);
  }
  return false;
}

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const input = await body(request);
    const identifier = String(input.identifier || input.email || input.phone || "").toLowerCase();
    const user = database.users.find(candidate => (candidate.email || "").toLowerCase() === identifier || candidate.phone === input.identifier);
    if (!user || user.role !== input.role || !verifyPassword(input.password, user.passwordHash)) return json(response, 401, { error: "Invalid credentials" });
    const token = randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    return json(response, 200, { token, user: publicUser(user), role: user.role, state: stateFor(user) });
  }

  const user = authUser(request);
  if (!user) return json(response, 401, { error: "Authentication required" });

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = (request.headers.authorization || "").slice(7);
    sessions.delete(token);
    return json(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, stateFor(user));

  if (request.method === "PUT" && url.pathname === "/api/state") {
    const next = await body(request);
    if (!canWriteState(user, next)) return json(response, 403, { error: "You are not allowed to modify this data" });
    if (["admin", "vhw"].includes(user.role)) {
      database = { ...database, ...next, users: database.users };
    } else {
      if (user.role === "doctor") {
        database.consultations = database.consultations.filter(item => item.doctorId !== user.profileId);
        database.consultations.push(...(next.consultations || []));
        database.appointments = next.appointments || database.appointments;
        database.patients = next.patients || database.patients;
      } else if (user.role === "patient") {
        const ownAppointmentIds = new Set((next.appointments || []).map(item => item.token || item.id));
        database.appointments = database.appointments.filter(item => !ownAppointmentIds.has(item.token || item.id));
        database.appointments.push(...(next.appointments || []));
        database.patients = database.patients.map(patient => patient.id === user.profileId
          ? (next.patients || []).find(item => item.id === user.profileId) || patient
          : patient);
      }
    }
    for (const patient of database.patients) {
      if (!database.users.some(candidate => candidate.profileId === patient.id)) {
        database.users.push({ id: `user-${patient.id}`, role: "patient", email: patient.email || `${patient.phone}@patient.local`, phone: patient.phone, passwordHash: hashPassword("password"), profileId: patient.id });
      }
    }
    persist();
    return json(response, 200, stateFor(user));
  }

  if (request.method === "POST" && url.pathname === "/api/consultations") {
    const consultation = await body(request);
    if (user.role !== "doctor" || consultation.doctorId !== user.profileId) return json(response, 403, { error: "Only the owning doctor can complete this consultation" });
    if (!consultation.patientId || !consultation.appointmentId || consultation.status !== "completed") return json(response, 400, { error: "A completed consultation requires doctor, patient, appointment, and status" });
    const existingIndex = database.consultations.findIndex(item => item.id === consultation.id);
    if (existingIndex >= 0) database.consultations[existingIndex] = consultation;
    else database.consultations.push(consultation);
    const appointment = database.appointments.find(item => item.token === consultation.appointmentId || item.id === consultation.appointmentId);
    if (appointment) { appointment.status = "Completed"; appointment.completedAt = consultation.completedAt; }
    persist();
    return json(response, 201, consultation);
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/patients/")) {
    if (!['admin', 'vhw'].includes(user.role)) return json(response, 403, { error: "Only staff can delete patients" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    database.patients = database.patients.filter(patient => patient.id !== id);
    database.users = database.users.filter(candidate => candidate.profileId !== id);
    persist();
    return json(response, 200, { ok: true });
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/doctors/")) {
    if (user.role !== "admin") return json(response, 403, { error: "Only administrators can delete doctors" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    database.doctors = database.doctors.filter(doctor => doctor.id !== id);
    database.users = database.users.filter(candidate => candidate.profileId !== id);
    persist();
    return json(response, 200, { ok: true });
  }

  return json(response, 404, { error: "API route not found" });
}

function staticFile(urlPath) {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = normalize(join(root, relative));
  if (!filePath.startsWith(root) || !existsSync(filePath)) return null;
  return filePath;
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    const filePath = staticFile(url.pathname);
    if (!filePath) return json(response, 404, { error: "Not found" });
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    response.end(readFileSync(filePath));
  } catch (error) {
    console.error(error);
    json(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => console.log(`Telehealth backend listening on http://localhost:${port}`));
