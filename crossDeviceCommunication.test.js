const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

test("Cross-Device Tele-Health Communication Architecture", async (t) => {
  // 1. Setup isolated test server on dynamic port
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  const testDb = {
    appointments: [],
    consultations: []
  };

  io.on("connection", (socket) => {
    socket.on("join_role", ({ role, userId }) => {
      if (role) socket.join(`role:${role}`);
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on("join_consultation", ({ token }) => {
      if (token) socket.join(`consultation:${token}`);
    });

    socket.on("token_requested", (payload) => {
      const appData = payload && payload.appointment ? payload.appointment : payload;
      testDb.appointments.push(appData);
      io.to("role:vhw").to("role:doctor").emit("token_requested", {
        token: appData.token,
        appointment: appData
      });
      io.emit("appointments_updated", testDb.appointments);
    });

    socket.on("vitals_recorded", (payload) => {
      const { token, vitals, urgency, patientId } = payload;
      const idx = testDb.appointments.findIndex(a => a.token === token);
      if (idx >= 0) {
        testDb.appointments[idx].vitals = vitals;
        testDb.appointments[idx].urgency = urgency;
      }
      io.to("role:doctor").emit("patient_added_to_queue", {
        token,
        urgency,
        appointment: idx >= 0 ? testDb.appointments[idx] : null
      });
      if (patientId) {
        io.to(`user:${patientId}`).emit("vitals_recorded", { token, vitals, urgency });
      }
    });

    socket.on("consultation_requested", (payload) => {
      const { token, doctorId, doctorName, patientId } = payload;
      const idx = testDb.appointments.findIndex(a => a.token === token);
      if (idx >= 0) testDb.appointments[idx].status = "Active";
      io.to(`user:${patientId}`).to(`consultation:${token}`).emit("consultation_requested", payload);
    });

    socket.on("consultation_accepted", (payload) => {
      io.to(`consultation:${payload.token}`).to("role:doctor").emit("consultation_accepted", payload);
    });

    socket.on("chat_message", (payload) => {
      const msg = payload && payload.chatMsg ? payload.chatMsg : payload;
      if (!msg || !msg.consultationId) return;
      if (msg.senderRole === "ai" || msg.sender === "ai") return; // reject AI bot
      const idx = testDb.appointments.findIndex(a => a.token === msg.consultationId);
      if (idx >= 0) {
        if (!testDb.appointments[idx].chat) testDb.appointments[idx].chat = [];
        testDb.appointments[idx].chat.push(msg);
      }
      socket.to(`consultation:${msg.consultationId}`).emit("chat_message", msg);
    });

    socket.on("peer_signal", (data) => {
      const targetToken = data.senderToken || data.token;
      if (targetToken) {
        socket.to(`consultation:${targetToken}`).emit("peer_signal", data);
      }
    });

    socket.on("consultation_ended", (payload) => {
      const idx = testDb.appointments.findIndex(a => a.token === payload.token);
      if (idx >= 0) testDb.appointments[idx].status = "Completed";
      io.to(`consultation:${payload.token}`).emit("consultation_ended", payload);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  // 2. Connect 3 simulated clients representing 3 distinct physical devices
  const clientPatient = Client(serverUrl);
  const clientHw = Client(serverUrl);
  const clientDoctor = Client(serverUrl);

  await Promise.all([
    new Promise(r => clientPatient.on("connect", r)),
    new Promise(r => clientHw.on("connect", r)),
    new Promise(r => clientDoctor.on("connect", r))
  ]);

  clientPatient.emit("join_role", { role: "patient", userId: "pat-999" });
  clientHw.emit("join_role", { role: "vhw", userId: "vhw-1" });
  clientDoctor.emit("join_role", { role: "doctor", userId: "doc-1" });

  await new Promise(r => setTimeout(r, 50));

  await t.test("Patient token request is delivered to Health Worker and Doctor in real time", async () => {
    const token = "VIL-A-789";
    const booking = {
      token,
      patientId: "pat-999",
      patientName: "Ramesh Kumar",
      symptoms: "High fever and persistent cough",
      urgency: "Normal",
      status: "Waiting"
    };

    const hwReceivedPromise = new Promise((resolve) => {
      clientHw.once("token_requested", (data) => resolve(data));
    });

    clientPatient.emit("token_requested", { appointment: booking });

    const received = await hwReceivedPromise;
    assert.equal(received.token, token);
    assert.equal(received.appointment.patientName, "Ramesh Kumar");
    assert.equal(testDb.appointments.length, 1);
  });

  await t.test("Health worker vitals recording reaches Doctor queue and Patient dashboard", async () => {
    const token = "VIL-A-789";
    const vitals = { bpSystolic: 135, bpDiastolic: 88, hr: 82, spo2: 97, temp: 101.2 };

    const docQueuePromise = new Promise((resolve) => {
      clientDoctor.once("patient_added_to_queue", (data) => resolve(data));
    });

    const patVitalsPromise = new Promise((resolve) => {
      clientPatient.once("vitals_recorded", (data) => resolve(data));
    });

    clientHw.emit("vitals_recorded", {
      token,
      vitals,
      urgency: "High Warning",
      patientId: "pat-999"
    });

    const [docData, patData] = await Promise.all([docQueuePromise, patVitalsPromise]);
    assert.equal(docData.token, token);
    assert.equal(docData.urgency, "High Warning");
    assert.equal(patData.token, token);
    assert.equal(patData.vitals.spo2, 97);
  });

  await t.test("Doctor 'Start Call' triggers real-time consultation_requested on Patient device", async () => {
    const token = "VIL-A-789";

    const patCallPromise = new Promise((resolve) => {
      clientPatient.once("consultation_requested", (data) => resolve(data));
    });

    clientDoctor.emit("consultation_requested", {
      token,
      doctorId: "doc-1",
      doctorName: "Dr. Vikram",
      patientId: "pat-999"
    });

    const callReq = await patCallPromise;
    assert.equal(callReq.token, token);
    assert.equal(callReq.doctorName, "Dr. Vikram");
    assert.equal(testDb.appointments[0].status, "Active");
  });

  await t.test("Patient 'Join Consultation' triggers consultation_accepted on Doctor device", async () => {
    const token = "VIL-A-789";
    clientPatient.emit("join_consultation", { token, role: "patient" });
    clientDoctor.emit("join_consultation", { token, role: "doctor" });

    await new Promise(r => setTimeout(r, 40));

    const docAcceptedPromise = new Promise((resolve) => {
      clientDoctor.once("consultation_accepted", (data) => resolve(data));
    });

    clientPatient.emit("consultation_accepted", {
      token,
      patientId: "pat-999",
      patientName: "Ramesh Kumar"
    });

    const accepted = await docAcceptedPromise;
    assert.equal(accepted.token, token);
    assert.equal(accepted.patientName, "Ramesh Kumar");
  });

  await t.test("Doctor and Patient exchange two-way real-time chat messages across devices", async () => {
    const token = "VIL-A-789";

    // 1. Doctor to Patient
    const docMsg = {
      id: "msg_doc_101",
      consultationId: token,
      senderId: "doc-1",
      senderName: "Dr. Vikram",
      senderRole: "doctor",
      text: "Hello Ramesh, I see your vitals. How are you feeling?",
      time: "10:30 AM",
      timestamp: Date.now()
    };

    const patReceivePromise = new Promise((resolve) => {
      clientPatient.once("chat_message", (msg) => resolve(msg));
    });

    clientDoctor.emit("chat_message", docMsg);
    const patReceived = await patReceivePromise;
    assert.equal(patReceived.id, docMsg.id);
    assert.equal(patReceived.text, docMsg.text);
    assert.equal(patReceived.senderRole, "doctor");

    // 2. Patient to Doctor
    const patReply = {
      id: "msg_pat_102",
      consultationId: token,
      senderId: "pat-999",
      senderName: "Ramesh Kumar",
      senderRole: "patient",
      text: "Doctor, I have had fever and chills since yesterday.",
      time: "10:31 AM",
      timestamp: Date.now()
    };

    const docReceivePromise = new Promise((resolve) => {
      clientDoctor.once("chat_message", (msg) => resolve(msg));
    });

    clientPatient.emit("chat_message", patReply);
    const docReceived = await docReceivePromise;
    assert.equal(docReceived.id, patReply.id);
    assert.equal(docReceived.text, patReply.text);
    assert.equal(docReceived.senderRole, "patient");

    // 3. Messages persisted in appointment
    assert.equal(testDb.appointments[0].chat.length, 2);
  });

  await t.test("WebRTC signaling (peer_signal) relays across devices", async () => {
    const token = "VIL-A-789";
    const sdpOffer = {
      type: "description",
      senderToken: token,
      senderRole: "doctor",
      description: { type: "offer", sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1..." }
    };

    const patSdpPromise = new Promise((resolve) => {
      clientPatient.once("peer_signal", (data) => resolve(data));
    });

    clientDoctor.emit("peer_signal", sdpOffer);
    const receivedSdp = await patSdpPromise;
    assert.equal(receivedSdp.senderToken, token);
    assert.equal(receivedSdp.description.type, "offer");
  });

  await t.test("Consultation ended is broadcast to all participants", async () => {
    const token = "VIL-A-789";
    const patEndedPromise = new Promise((resolve) => {
      clientPatient.once("consultation_ended", (data) => resolve(data));
    });

    clientDoctor.emit("consultation_ended", {
      token,
      consultation: { id: "con-101", token, diagnosis: "Acute Viral Fever" }
    });

    const ended = await patEndedPromise;
    assert.equal(ended.token, token);
    assert.equal(testDb.appointments[0].status, "Completed");
  });

  // Cleanup
  clientPatient.disconnect();
  clientHw.disconnect();
  clientDoctor.disconnect();
  await new Promise(r => server.close(r));
});
