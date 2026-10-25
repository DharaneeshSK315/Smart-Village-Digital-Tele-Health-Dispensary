const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { io: ioClient } = require("socket.io-client");
const { app, server, db } = require("./server.js");
const { classifyChatBubble, canReceiveChatMessage } = require("./consultationChat.js");

function makeRequest(serverInstance, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const address = serverInstance.address();
    const port = address.port;
    const postData = body ? JSON.stringify(body) : "";

    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

test("Multi-Device Cross-Communication Architecture & Workflows", async (t) => {
  let testServer = null;
  let serverPort = null;
  let socketUrl = null;

  // Sockets representing separate physical laptops/devices
  let laptopPatientA = null;  // Laptop A: Patient 1 (pat-device-a)
  let laptopVhwB = null;      // Laptop B: Village Health Worker (vhw-1)
  let laptopDoctorC = null;   // Laptop C: Doctor (doc-1)
  let laptopPatientD = null;  // Laptop D: Patient 2 (pat-device-d)

  const token = "VIL-TEST-CROSS-901";
  const patAId = "pat-device-a";
  const patAName = "Suresh Patel";
  const patDId = "pat-device-d";
  const patDName = "Meera Kumari";
  const doctorId = "doc-1";
  const doctorName = "Dr. Vikram";

  t.before(async () => {
    // Clean up test records
    db.appointments = (db.appointments || []).filter(
      a => a.token !== token && !a.patientId?.startsWith("pat-device-")
    );

    await new Promise((resolve) => {
      testServer = server.listen(0, "127.0.0.1", () => {
        serverPort = testServer.address().port;
        socketUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });

    // 1. Laptop A: Patient 1
    laptopPatientA = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(r => laptopPatientA.on("connect", r));
    laptopPatientA.emit("join_role", { role: "patient", userId: patAId, userName: patAName });

    // 2. Laptop B: Health Worker
    laptopVhwB = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(r => laptopVhwB.on("connect", r));
    laptopVhwB.emit("join_role", { role: "vhw", userId: "vhw-1", userName: "Nurse Anjali" });

    // 3. Laptop C: Doctor
    laptopDoctorC = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(r => laptopDoctorC.on("connect", r));
    laptopDoctorC.emit("join_role", { role: "doctor", userId: doctorId, userName: doctorName });

    // 4. Laptop D: Patient 2 (for multi-user isolation tests)
    laptopPatientD = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(r => laptopPatientD.on("connect", r));
    laptopPatientD.emit("join_role", { role: "patient", userId: patDId, userName: patDName });

    await new Promise(r => setTimeout(r, 60));
  });

  t.after(async () => {
    if (laptopPatientA) laptopPatientA.disconnect();
    if (laptopVhwB) laptopVhwB.disconnect();
    if (laptopDoctorC) laptopDoctorC.disconnect();
    if (laptopPatientD) laptopPatientD.disconnect();
    if (testServer) {
      await new Promise(r => testServer.close(r));
    }
  });

  // =========================================================================
  // TEST CASE 1: Patient to Health Worker (Cross-Device Token Request)
  // =========================================================================
  await t.test("Test Case 1: Patient token request appears on Health Worker dashboard without page refresh", async () => {
    const booking = {
      token,
      consultationRequestId: token,
      patientId: patAId,
      patientName: patAName,
      assignedDoctorId: doctorId,
      symptoms: "High fever, mild dehydration",
      urgency: "Normal",
      status: "Vitals Pending",
      vitals: null
    };

    const vhwReceivedPromise = new Promise((resolve) => {
      laptopVhwB.once("token_requested", (data) => resolve(data));
    });

    // Patient emits token_requested from Laptop A
    laptopPatientA.emit("token_requested", { appointment: booking });

    const received = await vhwReceivedPromise;
    assert.equal(received.token, token);
    assert.equal(received.appointment.patientName, patAName);

    // Confirm stored in shared backend database
    const saved = db.appointments.find(a => a.token === token);
    assert.ok(saved, "Appointment must be persisted in shared database");
    assert.equal(saved.status, "Vitals Pending");
  });

  // =========================================================================
  // TEST CASE 2: Health Worker to Doctor (Cross-Device Vitals & Queue Triage)
  // =========================================================================
  await t.test("Test Case 2: Health worker vitals recording updates shared DB and reaches Doctor Queue", async () => {
    const vitalsData = {
      bpSystolic: 128,
      bpDiastolic: 84,
      bp: "128/84",
      temp: 38.2,
      temperature: 38.2,
      hr: 82,
      pulse: 82,
      spo2: 97,
      sugar: 115,
      pain: 2
    };

    const docQueuePromise = new Promise((resolve) => {
      laptopDoctorC.once("patient_added_to_queue", (data) => resolve(data));
    });

    const patVitalsPromise = new Promise((resolve) => {
      laptopPatientA.once("vitals_recorded", (data) => resolve(data));
    });

    // Health worker on Laptop B submits vitals via REST API
    const res = await makeRequest(testServer, "POST", "/api/vitals", {
      token,
      patientId: patAId,
      vitals: vitalsData,
      urgency: "Moderate",
      specialty: "General Medicine"
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);

    const [docData, patData] = await Promise.all([docQueuePromise, patVitalsPromise]);
    assert.equal(docData.token, token);
    assert.equal(docData.status, "Waiting for Doctor Queue");
    assert.equal(patData.token, token);

    // Verify stored in shared database
    const appRecord = db.appointments.find(a => a.token === token);
    assert.equal(appRecord.status, "Waiting for Doctor Queue");
    assert.equal(appRecord.vitals.spo2, 97);
  });

  // =========================================================================
  // TEST CASE 3: Doctor to Patient (Call Request, Acceptance & Agora Video/Audio)
  // =========================================================================
  await t.test("Test Case 3: Doctor starts consultation -> Patient receives incoming call -> Agora token generated", async () => {
    const patCallPromise = new Promise((resolve) => {
      laptopPatientA.once("consultation_requested", (data) => resolve(data));
    });

    // Doctor on Laptop C clicks "Start Call"
    laptopDoctorC.emit("consultation_requested", {
      token,
      doctorId,
      doctorName,
      patientId: patAId
    });

    const callReq = await patCallPromise;
    assert.equal(callReq.token, token);
    assert.equal(callReq.doctorName, doctorName);
    assert.equal(callReq.patientId, patAId);

    // Patient on Laptop A joins the consultation room
    laptopPatientA.emit("join_consultation", { token, role: "patient", userId: patAId });
    laptopDoctorC.emit("join_consultation", { token, role: "doctor", userId: doctorId });

    await new Promise(r => setTimeout(r, 40));

    // Patient accepts call -> Doctor receives consultation_accepted
    const docAcceptedPromise = new Promise((resolve) => {
      laptopDoctorC.once("consultation_accepted", (data) => resolve(data));
    });

    laptopPatientA.emit("consultation_accepted", {
      token,
      patientId: patAId,
      patientName: patAName
    });

    const accepted = await docAcceptedPromise;
    assert.equal(accepted.token, token);
    assert.equal(accepted.patientName, patAName);

    // Verify Agora token endpoint generates valid scoped room credentials without leaking secrets
    const agoraRes = await makeRequest(testServer, "GET", `/api/agora/token?channel=telehealth-${token}&role=patient&token=${token}&userId=${patAId}`);
    assert.equal(agoraRes.status, 200);
    assert.equal(agoraRes.data.success, true);
    assert.equal(agoraRes.data.channel, `telehealth-${token}`);
    assert.ok(agoraRes.data.token, "Agora token must be generated");
    assert.ok(agoraRes.data.appid, "Agora App ID must be present");
    assert.equal(agoraRes.data.appCertificate, undefined, "Server secret AGORA_APP_CERTIFICATE must NEVER be leaked to client");
  });

  // =========================================================================
  // TEST CASE 4: Doctor-Patient Chat (Real-time Messaging & Database Persistence)
  // =========================================================================
  await t.test("Test Case 4: Doctor and Patient exchange two-way chat messages and persist in DB", async () => {
    // 1. Doctor sends message to Patient
    const docMsg = {
      id: "msg_doc_cross_1",
      consultationId: token,
      senderId: doctorId,
      senderName: doctorName,
      senderRole: "doctor",
      text: "Hello Suresh, I have reviewed your temperature reading of 38.2 C. How are you feeling right now?",
      time: "10:45 AM",
      timestamp: Date.now()
    };

    const patReceivePromise = new Promise((resolve) => {
      laptopPatientA.once("chat_message", (msg) => resolve(msg));
    });

    laptopDoctorC.emit("chat_message", docMsg);
    const patReceived = await patReceivePromise;
    assert.equal(patReceived.id, docMsg.id);
    assert.equal(patReceived.text, docMsg.text);

    // Verify UI classification: For Patient A, doctor's message is a peer message (on left side)
    const patClassification = classifyChatBubble(patReceived, patAId, "patient");
    assert.equal(patClassification.isSelf, false, "Doctor message should be peer message for Patient");
    assert.ok(patClassification.rowClass.includes("justify-start"), "Peer message must appear on the left");

    // 2. Patient replies to Doctor
    const patMsg = {
      id: "msg_pat_cross_2",
      consultationId: token,
      senderId: patAId,
      senderName: patAName,
      senderRole: "patient",
      text: "Doctor, I am feeling shivering and body aches since this morning.",
      time: "10:46 AM",
      timestamp: Date.now() + 100
    };

    const docReceivePromise = new Promise((resolve) => {
      laptopDoctorC.once("chat_message", (msg) => resolve(msg));
    });

    laptopPatientA.emit("chat_message", patMsg);
    const docReceived = await docReceivePromise;
    assert.equal(docReceived.id, patMsg.id);
    assert.equal(docReceived.text, patMsg.text);

    // Verify UI classification: For Doctor, doctor's message is self (on right), patient's message is peer (on left)
    const docBubbleClass = classifyChatBubble(docMsg, doctorId, "doctor");
    assert.equal(docBubbleClass.isSelf, true, "Doctor's own message must appear on the right");
    assert.ok(docBubbleClass.rowClass.includes("justify-end"));

    // 3. Confirm both messages are permanently persisted in the shared database
    const appInDb = db.appointments.find(a => a.token === token);
    assert.ok(appInDb.chat, "Chat array must exist on appointment");
    assert.equal(appInDb.chat.length, 2, "Both messages must be saved in shared database");
    assert.equal(appInDb.chat[0].id, docMsg.id);
    assert.equal(appInDb.chat[1].id, patMsg.id);

    // 4. Test page refresh / state re-fetch restores messages
    const dbRes = await makeRequest(testServer, "GET", "/api/db");
    assert.equal(dbRes.status, 200);
    const restoredApp = dbRes.data.db.appointments.find(a => a.token === token);
    assert.ok(restoredApp, "Appointment must be retrievable from /api/db");
    assert.equal(restoredApp.chat.length, 2, "Saved chat messages must be available after refresh");
  });

  // =========================================================================
  // TEST CASE 5: Multiple Users Isolation (No Cross-Patient Contamination)
  // =========================================================================
  await t.test("Test Case 5: Consultation requests and personal vitals do NOT leak to unrelated patients", async () => {
    let patDReceivedCall = false;
    let patDReceivedVitals = false;

    laptopPatientD.on("consultation_requested", (data) => {
      if (data.token === token) patDReceivedCall = true;
    });

    laptopPatientD.on("vitals_recorded", (data) => {
      if (data.token === token) patDReceivedVitals = true;
    });

    // Trigger a call to Patient A
    laptopDoctorC.emit("consultation_requested", {
      token,
      doctorId,
      doctorName,
      patientId: patAId
    });

    // Record vitals for Patient A via API
    await makeRequest(testServer, "POST", "/api/vitals", {
      token,
      patientId: patAId,
      vitals: { bpSystolic: 120, bpDiastolic: 80, hr: 75, spo2: 98, temp: 36.8 },
      urgency: "Normal"
    });

    await new Promise(r => setTimeout(r, 100));

    // Patient D (Laptop D) should NOT have received Patient A's incoming call or personal vitals!
    assert.equal(patDReceivedCall, false, "Patient 2 must NOT receive incoming consultation requests intended for Patient 1");
    assert.equal(patDReceivedVitals, false, "Patient 2 must NOT receive personal vitals events of Patient 1");
  });

  // =========================================================================
  // TEST CASE 6: Disconnection and Recovery
  // =========================================================================
  await t.test("Test Case 6: Disconnected client restores latest data, chat, and status upon reconnection", async () => {
    // 1. Laptop A temporarily disconnects (simulating internet drop)
    laptopPatientA.disconnect();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(laptopPatientA.connected, false, "Patient A must be disconnected");

    // 2. While Patient A is offline, doctor completes consultation and writes prescription
    const consultationData = {
      id: token,
      token,
      date: "2026-10-25",
      patientId: patAId,
      patientName: patAName,
      doctorName,
      diagnosis: "Acute Viral Bronchitis",
      advice: "Adequate rest, hydration, steam inhalation",
      medicines: "Paracetamol 650mg TDS",
      status: "completed"
    };

    laptopDoctorC.emit("consultation_ended", {
      token,
      consultation: consultationData
    });

    await new Promise(r => setTimeout(r, 100));

    // 3. Patient A reconnects to internet
    laptopPatientA.connect();
    await new Promise(r => laptopPatientA.on("connect", r));
    laptopPatientA.emit("join_role", { role: "patient", userId: patAId, userName: patAName });

    // 4. Client retrieves latest database state from /api/db upon reconnection
    const syncRes = await makeRequest(testServer, "GET", "/api/db");
    assert.equal(syncRes.status, 200);

    const recoveredApp = syncRes.data.db.appointments.find(a => a.token === token);
    assert.ok(recoveredApp, "Appointment must exist after reconnection");
    assert.equal(recoveredApp.status, "Completed", "Latest status must be restored to Completed");

    const recoveredCon = syncRes.data.db.consultations.find(c => c.token === token || c.id === token);
    assert.ok(recoveredCon, "Consultation record must be restored");
    assert.equal(recoveredCon.diagnosis, "Acute Viral Bronchitis");

    // Saved chat messages are still preserved
    assert.equal(recoveredApp.chat.length, 2, "Chat history must not be lost upon reconnection");
  });
});
