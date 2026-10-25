const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { io: ioClient } = require("socket.io-client");
const {
  app,
  server,
  db,
  parseISTTime,
  epochToISTDate,
  getDayOfWeekIST,
  isSlotConflicting,
  generateAvailableSlots,
  getAIAdvisory
} = require("./server.js");

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

test("End-to-End Smart Consultation Queue & Appointment Booking Multi-Role Workflow", async (t) => {
  let testServer = null;
  let serverPort = null;
  let patientSocket = null;
  let vhwSocket = null;
  let doctorSocket = null;

  const testPatientId = "pat-e2e-workflow";
  const testPatientName = "Ananya Roy";
  const testDoctorId = "doc-1";
  let consultationToken = null;
  let bookedSlotInfo = null;

  t.before(async () => {
    // Clean up test records
    db.appointments = (db.appointments || []).filter(
      a => !a.patientId?.startsWith("pat-e2e-") && !a.patientId?.startsWith("pat-test-") && !a.patientId?.startsWith("pat-flow-")
    );
    db.bookedSlots = (db.bookedSlots || []).filter(
      s => !s.patientId?.startsWith("pat-e2e-") && !s.patientId?.startsWith("pat-test-") && !s.patientId?.startsWith("pat-flow-")
    );

    await new Promise((resolve) => {
      testServer = server.listen(0, "127.0.0.1", () => {
        serverPort = testServer.address().port;
        resolve();
      });
    });

    const socketUrl = `http://127.0.0.1:${serverPort}`;

    // 1. Patient socket connection
    patientSocket = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(res => patientSocket.on("connect", res));
    patientSocket.emit("join_role", { role: "patient", userId: testPatientId, userName: testPatientName });

    // 2. Health Worker socket connection
    vhwSocket = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(res => vhwSocket.on("connect", res));
    vhwSocket.emit("join_role", { role: "vhw", userId: "vhw-1", userName: "Nurse Anjali" });

    // 3. Doctor socket connection
    doctorSocket = ioClient(socketUrl, { transports: ["websocket"], forceNew: true });
    await new Promise(res => doctorSocket.on("connect", res));
    doctorSocket.emit("join_role", { role: "doctor", userId: testDoctorId, userName: "Dr. Vikram" });
  });

  t.after(async () => {
    if (patientSocket) patientSocket.disconnect();
    if (vhwSocket) vhwSocket.disconnect();
    if (doctorSocket) doctorSocket.disconnect();
    if (testServer) {
      await new Promise(res => testServer.close(res));
    }
  });

  await t.test("STAGE 1: Patient requests consultation -> Initial status is 'Vitals Pending'", async () => {
    const hwEventPromise = new Promise(resolve => {
      const handler = (data) => {
        if (data && (data.appointment?.patientId === testPatientId || data.patientId === testPatientId)) {
          vhwSocket.off("consultation_requested", handler);
          resolve(true);
        }
      };
      vhwSocket.on("consultation_requested", handler);
      setTimeout(() => resolve(false), 800);
    });

    const reqPayload = {
      patientId: testPatientId,
      patientName: testPatientName,
      doctorId: testDoctorId,
      symptoms: "Persistent headache and elevated fatigue",
      urgency: "Normal"
    };

    const res = await makeRequest(testServer, "POST", "/api/consultations/request", reqPayload);
    assert.equal(res.status, 201, "Consultation request must return 201 Created");
    assert.ok(res.data.success);
    assert.ok(res.data.appointment);
    assert.equal(res.data.appointment.status, "Vitals Pending", "Status must be 'Vitals Pending'");
    assert.equal(res.data.appointment.vitals, null, "Vitals must initially be null");
    assert.equal(res.data.appointment.vitalsCompleted, false, "Vitals completed must be false");

    consultationToken = res.data.appointment.token;
    assert.ok(consultationToken.startsWith("VIL-"), "Token must start with village prefix VIL-");

    const hwReceived = await hwEventPromise;
    assert.ok(hwReceived, "Health worker socket must receive consultation_requested event in real time");
  });

  await t.test("STAGE 1.5: Patient attempts to book a slot before vitals -> Strictly blocked with 400 Bad Request", async () => {
    const slotsRes = await makeRequest(testServer, "GET", `/api/slots?doctorId=${testDoctorId}`);
    assert.ok(slotsRes.data.slots.length > 0);
    const candidateSlot = slotsRes.data.slots[0];

    const earlyBookingPayload = {
      slotId: candidateSlot.slotId,
      doctorId: testDoctorId,
      patientId: testPatientId,
      patientName: testPatientName,
      token: consultationToken,
      date: candidateSlot.date,
      startTime: candidateSlot.startTime,
      endTime: candidateSlot.endTime
    };

    const bookRes = await makeRequest(testServer, "POST", "/api/slots/book", earlyBookingPayload);
    assert.equal(bookRes.status, 400, "Booking before vitals recording must return 400 Bad Request");
    assert.equal(bookRes.data.success, false);
    assert.match(bookRes.data.error, /vitals must be recorded/i);
  });

  await t.test("STAGE 2: Health worker records and validates vitals -> Status updates to 'Waiting for Doctor Queue'", async () => {
    const patientVitalsPromise = new Promise(resolve => {
      const handler = (data) => {
        if (data && (data.token === consultationToken || data.patientId === testPatientId)) {
          patientSocket.off("vitals_recorded", handler);
          resolve(true);
        }
      };
      patientSocket.on("vitals_recorded", handler);
      setTimeout(() => resolve(false), 800);
    });

    const doctorQueuePromise = new Promise(resolve => {
      const handler = (data) => {
        if (data && (data.token === consultationToken || data.appointment?.patientId === testPatientId)) {
          doctorSocket.off("patient_added_to_queue", handler);
          resolve(true);
        }
      };
      doctorSocket.on("patient_added_to_queue", handler);
      setTimeout(() => resolve(false), 800);
    });

    const vitalsPayload = {
      token: consultationToken,
      patientId: testPatientId,
      vitals: {
        bpSystolic: 120,
        bpDiastolic: 80,
        temp: 36.8,
        hr: 74,
        spo2: 98,
        sugar: 110,
        pain: 1
      },
      urgency: "Normal"
    };

    const vitalsRes = await makeRequest(testServer, "POST", "/api/vitals", vitalsPayload);
    assert.equal(vitalsRes.status, 200, "Vitals submission must return 200 OK");
    assert.ok(vitalsRes.data.success);
    assert.equal(vitalsRes.data.appointment.status, "Waiting for Doctor Queue", "Status must become 'Waiting for Doctor Queue'");
    assert.equal(vitalsRes.data.appointment.vitals.bp, "120/80");
    assert.equal(vitalsRes.data.appointment.vitals.spo2, 98);
    assert.equal(vitalsRes.data.appointment.vitals.temp, 36.8);
    assert.equal(vitalsRes.data.appointment.vitals.hr, 74);
    assert.equal(vitalsRes.data.appointment.vitalsCompleted, true);

    const [patientNotified, doctorNotified] = await Promise.all([patientVitalsPromise, doctorQueuePromise]);
    assert.ok(patientNotified, "Patient must receive vitals_recorded event notifying them to book a slot");
    assert.ok(doctorNotified, "Doctor queue must receive patient_added_to_queue event");
  });

  await t.test("STAGE 3 & 4: AI analyses doctor availability and returns next three genuinely available slots", async () => {
    const slotsRes = await makeRequest(testServer, "GET", `/api/slots?doctorId=${testDoctorId}`);
    assert.equal(slotsRes.status, 200);
    assert.ok(slotsRes.data.success);
    assert.ok(Array.isArray(slotsRes.data.slots));
    assert.ok(slotsRes.data.slots.length <= 3, "At most 3 slots returned");
    assert.ok(slotsRes.data.slots.length > 0, "At least 1 slot available");
    assert.ok(slotsRes.data.aiAdvisory, "AI Advisory metadata must be attached");

    const advisory = slotsRes.data.aiAdvisory;
    assert.ok(["Low", "Moderate", "High"].includes(advisory.demandLevel));
    assert.ok(typeof advisory.estimatedWaitMins === "number");

    // Verify 15-minute slot validity and no break overlaps
    slotsRes.data.slots.forEach(slot => {
      assert.equal(slot.durationMins, 15, "Consultation slot must default to 15 minutes");
      assert.ok(slot.startTime < "13:00" || slot.startTime >= "14:00", "No slot during lunch break 13:00-14:00");
    });

    bookedSlotInfo = slotsRes.data.slots[0];
  });

  await t.test("STAGE 5 & 6: Patient books slot -> Status transitions to 'Appointment Confirmed' and slot is reserved", async () => {
    const doctorBookingPromise = new Promise(resolve => {
      const handler = (data) => {
        if (data && (data.appointment?.token === consultationToken || data.appointment?.patientId === testPatientId)) {
          doctorSocket.off("appointment_confirmed", handler);
          resolve(true);
        }
      };
      doctorSocket.on("appointment_confirmed", handler);
      setTimeout(() => resolve(false), 800);
    });

    const bookingPayload = {
      slotId: bookedSlotInfo.slotId,
      doctorId: testDoctorId,
      patientId: testPatientId,
      patientName: testPatientName,
      token: consultationToken,
      date: bookedSlotInfo.date,
      startTime: bookedSlotInfo.startTime,
      endTime: bookedSlotInfo.endTime
    };

    const res = await makeRequest(testServer, "POST", "/api/slots/book", bookingPayload);
    assert.equal(res.status, 201, "Booking must return 201 Created");
    assert.ok(res.data.success);
    assert.equal(res.data.appointment.status, "Appointment Confirmed", "Status must update to 'Appointment Confirmed'");
    assert.equal(res.data.appointment.token, consultationToken, "Original consultation token must be preserved");
    assert.ok(res.data.appointment.vitals, "Recorded vitals must be preserved on confirmed appointment");
    assert.equal(res.data.appointment.vitals.bp, "120/80");

    const doctorNotified = await doctorBookingPromise;
    assert.ok(doctorNotified, "Doctor must receive appointment_confirmed event immediately");

    // Verify the booked slot cannot be double-booked
    const concurrentPayload = {
      ...bookingPayload,
      patientId: "pat-e2e-second",
      patientName: "Ramesh Kumar"
    };
    const conflictRes = await makeRequest(testServer, "POST", "/api/slots/book", concurrentPayload);
    assert.equal(conflictRes.status, 409, "Simultaneous or overlapping booking must return 409 Conflict");
    assert.equal(conflictRes.data.conflict, true);
  });

  await t.test("STAGE 7: Doctor dashboard appointments with recorded vitals and filter support", async () => {
    const apptsRes = await makeRequest(testServer, "GET", "/api/appointments");
    assert.equal(apptsRes.status, 200);
    assert.ok(apptsRes.data.success);

    const docAppointments = apptsRes.data.appointments.filter(a => a.assignedDoctorId === testDoctorId);
    const confirmedAppt = docAppointments.find(a => a.token === consultationToken);
    assert.ok(confirmedAppt, "Confirmed appointment must be present in doctor appointments list");
    assert.equal(confirmedAppt.status, "Appointment Confirmed");
    assert.ok(confirmedAppt.vitals, "Doctor must see recorded vitals");
    assert.equal(confirmedAppt.vitals.bp, "120/80");
    assert.equal(confirmedAppt.vitals.spo2, 98);

    // Test filtering logic for Today, Upcoming, Completed, Cancelled
    const todayIST = epochToISTDate(Date.now());
    const filterToday = docAppointments.filter(a => a.scheduledDate === todayIST || a.date === todayIST);
    const filterUpcoming = docAppointments.filter(a => (a.scheduledDate >= todayIST || a.date >= todayIST) && ["Appointment Confirmed", "Confirmed", "Rescheduled"].includes(a.status));
    const filterCompleted = docAppointments.filter(a => a.status === "Completed");
    const filterCancelled = docAppointments.filter(a => a.status === "Cancelled");

    assert.ok(Array.isArray(filterToday));
    assert.ok(Array.isArray(filterUpcoming));
    assert.ok(Array.isArray(filterCompleted));
    assert.ok(Array.isArray(filterCancelled));
    assert.ok(filterUpcoming.some(a => a.token === consultationToken), "Confirmed appointment must appear under Upcoming filter");
  });

  await t.test("STAGE 8: Video consultation room authorization and completion", async () => {
    // 1. Doctor gets Agora token for consultation room
    const docTokenRes = await makeRequest(
      testServer,
      "GET",
      `/api/agora/token?channel=telehealth-${consultationToken}&role=doctor&token=${consultationToken}&userId=${testDoctorId}`
    );
    assert.equal(docTokenRes.status, 200);
    assert.ok(docTokenRes.data.success);
    assert.equal(docTokenRes.data.channel, `telehealth-${consultationToken}`);

    // 2. Patient gets Agora token for same room
    const patTokenRes = await makeRequest(
      testServer,
      "GET",
      `/api/agora/token?channel=telehealth-${consultationToken}&role=patient&token=${consultationToken}&userId=${testPatientId}`
    );
    assert.equal(patTokenRes.status, 200);
    assert.ok(patTokenRes.data.success);
    assert.equal(patTokenRes.data.channel, `telehealth-${consultationToken}`);

    // 3. Doctor completes consultation
    const completeRes = await makeRequest(testServer, "POST", "/api/consultations", {
      id: `cons-${consultationToken}`,
      token: consultationToken,
      doctorId: testDoctorId,
      patientId: testPatientId,
      diagnosis: "Mild tension headache and dehydration",
      prescription: "Hydration and Rest",
      completedAt: new Date().toISOString()
    });
    assert.equal(completeRes.status, 201);
    assert.ok(completeRes.data.success);

    // Verify appointment status updated to 'Completed'
    const updatedAppts = await makeRequest(testServer, "GET", "/api/appointments");
    const finishedApp = updatedAppts.data.appointments.find(a => a.token === consultationToken);
    assert.equal(finishedApp.status, "Completed", "Appointment status must be updated to 'Completed'");
  });

  await t.test("STAGE 9: Patient dashboard consultation history stores and returns the consultation report", async () => {
    // 1. Fetch consultations from server
    const consRes = await makeRequest(testServer, "GET", "/api/consultations");
    assert.equal(consRes.status, 200);
    assert.ok(consRes.data.success);
    assert.ok(Array.isArray(consRes.data.consultations));

    // 2. Find the completed consultation for test patient
    const savedCon = consRes.data.consultations.find(c => c.token === consultationToken || c.patientId === testPatientId);
    assert.ok(savedCon, "Completed consultation report must be stored in server consultations");
    assert.equal(savedCon.patientId, testPatientId);
    assert.equal(savedCon.diagnosis, "Mild tension headache and dehydration");
    assert.equal(savedCon.prescription, "Hydration and Rest");

    // 3. Test real-time consultation completion event delivery to patient socket
    const patientReportPromise = new Promise((resolve) => {
      const h1 = (con) => {
        if (con && (con.token === "token-live-check" || con.patientId === testPatientId)) {
          patientSocket.off("consultation_saved", h1);
          resolve(con);
        }
      };
      const h2 = (allCons) => {
        if (Array.isArray(allCons)) {
          const found = allCons.find(c => c.token === "token-live-check" || c.patientId === testPatientId);
          if (found) {
            patientSocket.off("consultations_updated", h2);
            resolve(found);
          }
        }
      };
      patientSocket.on("consultation_saved", h1);
      patientSocket.on("consultations_updated", h2);
    });

    // Doctor socket emits consultation_ended
    doctorSocket.emit("consultation_ended", {
      token: "token-live-check",
      consultation: {
        id: "cons-live-check",
        token: "token-live-check",
        doctorId: testDoctorId,
        patientId: testPatientId,
        patientName: testPatientName,
        diagnosis: "Seasonal allergies",
        medicines: "Cetirizine 10mg",
        status: "completed",
        date: new Date().toISOString().split("T")[0]
      }
    });

    const receivedReport = await Promise.race([
      patientReportPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for real-time consultation event")), 2500))
    ]);

    assert.ok(receivedReport, "Patient socket must receive consultation report event in real-time");
    assert.equal(receivedReport.patientId, testPatientId);

    // 4. Verify consultation is present in db.consultations
    const stored = db.consultations.find(c => c.token === "token-live-check");
    assert.ok(stored, "Consultation must be stored in db.consultations");
    assert.equal(stored.diagnosis, "Seasonal allergies");
  });
});

