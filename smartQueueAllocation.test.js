const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
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

// Helper to perform HTTP requests against the Express app
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

test("Smart Consultation Queue & Appointment Allocation System", async (t) => {
  let testServer = null;

  t.before(async () => {
    // Clean up any test artifacts from prior runs
    db.appointments = (db.appointments || []).filter(
      a => !a.patientId?.startsWith("pat-test-") && !a.patientId?.startsWith("pat-resched-") && !a.patientId?.startsWith("pat-cancel-") && !a.patientId?.startsWith("pat-flow-")
    );
    db.bookedSlots = (db.bookedSlots || []).filter(
      s => !s.patientId?.startsWith("pat-test-") && !s.patientId?.startsWith("pat-resched-") && !s.patientId?.startsWith("pat-cancel-") && !s.patientId?.startsWith("pat-flow-")
    );

    // Start server on a random dynamic port
    await new Promise((resolve) => {
      testServer = server.listen(0, "127.0.0.1", resolve);
    });
  });

  t.after(async () => {
    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
  });

  await t.test("1. Timezone and deterministic day-of-week calculation in Asia/Kolkata", () => {
    // 2026-10-20 is Tuesday (day 2)
    const dow = getDayOfWeekIST("2026-10-20");
    assert.equal(dow, 2, "2026-10-20 must be Tuesday (2)");

    // 2026-10-25 is Sunday (day 0)
    const sundayDow = getDayOfWeekIST("2026-10-25");
    assert.equal(sundayDow, 0, "2026-10-25 must be Sunday (0)");

    // parseISTTime produces correct UTC timestamp
    const t1 = parseISTTime("2026-10-20", "09:00");
    const t2 = parseISTTime("2026-10-20", "09:15");
    assert.equal(t2 - t1, 15 * 60 * 1000, "15 minute slot difference must be 900,000 ms");
  });

  await t.test("2. generateAvailableSlots returns at most THREE genuinely available 15-minute slots", () => {
    const doctorId = "doc-1";
    const slots = generateAvailableSlots(doctorId, 3);

    assert.ok(Array.isArray(slots));
    assert.ok(slots.length <= 3, `Returned slots count (${slots.length}) must be at most 3`);
    assert.ok(slots.length > 0, "Should find available slots in schedule");

    slots.forEach(slot => {
      assert.equal(slot.doctorId, doctorId);
      assert.equal(slot.durationMins, 15, "Slot duration must be 15 mins by default");
      assert.ok(slot.startTime);
      assert.ok(slot.endTime);
      assert.ok(slot.date);

      // Verify slot is never within break hours (13:00 to 14:00)
      assert.ok(
        slot.startTime < "13:00" || slot.startTime >= "14:00",
        `Slot ${slot.startTime} must not overlap with break period 13:00-14:00`
      );

      // Verify slot is within working hours (09:00 to 17:00)
      assert.ok(slot.startTime >= "09:00", `Slot start ${slot.startTime} must be >= 09:00`);
      assert.ok(slot.endTime <= "17:00", `Slot end ${slot.endTime} must be <= 17:00`);

      // Verify slot is not on Sunday (day 0)
      const day = getDayOfWeekIST(slot.date);
      assert.notEqual(day, 0, "Slot must not fall on Sunday");
    });
  });

  await t.test("3. AI demand advisory provides valid demand levels and queue metrics", () => {
    const advisory = getAIAdvisory("doc-1");
    assert.ok(advisory);
    assert.ok(["Low", "Moderate", "High"].includes(advisory.demandLevel));
    assert.ok(typeof advisory.queueDepth === "number");
    assert.ok(typeof advisory.estimatedWaitMins === "number");
    assert.ok(typeof advisory.recommendation === "string");
  });

  await t.test("4. GET /api/slots endpoint returns maximum 3 slots with AI advisory metadata", async () => {
    const res = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    assert.equal(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(Array.isArray(res.data.slots));
    assert.ok(res.data.slots.length <= 3);
    assert.ok(res.data.aiAdvisory);
    assert.equal(res.data.doctorId, "doc-1");
  });

  await t.test("5. POST /api/slots/book books slot atomically and prevents overlapping duplicate bookings (409 Conflict)", async () => {
    // 1. Get an available slot
    const slotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    assert.ok(slotsRes.data.slots.length > 0, "Must have an available slot to book");
    const targetSlot = slotsRes.data.slots[0];

    const bookingPayload = {
      slotId: targetSlot.slotId,
      doctorId: targetSlot.doctorId,
      patientId: "pat-test-1",
      patientName: "Aarav Sharma",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime,
      symptoms: "Fever and mild cough",
      urgency: "Normal"
    };

    // First booking attempt -> Must succeed (201 Created)
    const bookRes1 = await makeRequest(testServer, "POST", "/api/slots/book", bookingPayload);
    assert.equal(bookRes1.status, 201, "First booking attempt must succeed with 201");
    assert.ok(bookRes1.data.success);
    assert.ok(bookRes1.data.appointment);
    assert.equal(bookRes1.data.appointment.status, "Appointment Confirmed");
    assert.equal(bookRes1.data.appointment.slotDurationMins, 15);
    const assignedToken = bookRes1.data.appointment.token;
    assert.ok(assignedToken.startsWith("VIL-"));

    // Second booking attempt for the SAME slot -> Must return 409 Conflict
    const conflictingPayload = {
      ...bookingPayload,
      patientId: "pat-test-2",
      patientName: "Meera Patel"
    };
    const bookRes2 = await makeRequest(testServer, "POST", "/api/slots/book", conflictingPayload);
    assert.equal(bookRes2.status, 409, "Second concurrent booking attempt must fail with 409 Conflict");
    assert.equal(bookRes2.data.success, false);
    assert.ok(bookRes2.data.conflict);

    // Booked slot must now be completely absent from future availability searches
    const refreshedSlotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    const stillPresent = refreshedSlotsRes.data.slots.some(s => s.slotId === targetSlot.slotId);
    assert.equal(stillPresent, false, "Booked slot must immediately be removed from available slot list");
  });

  await t.test("6. POST /api/appointments/:token/reschedule releases previous slot and books new slot atomically", async () => {
    // Book an initial slot
    const slotsRes1 = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    const initialSlot = slotsRes1.data.slots[0];
    const newTargetSlot = slotsRes1.data.slots[1];

    const initialBook = await makeRequest(testServer, "POST", "/api/slots/book", {
      slotId: initialSlot.slotId,
      doctorId: "doc-1",
      patientId: "pat-resched-1",
      patientName: "Kavita Reddy",
      date: initialSlot.date,
      startTime: initialSlot.startTime,
      endTime: initialSlot.endTime,
      symptoms: "Migraine"
    });
    const token = initialBook.data.appointment.token;

    // Reschedule to newTargetSlot
    const reschedRes = await makeRequest(testServer, "POST", `/api/appointments/${token}/reschedule`, {
      newSlot: newTargetSlot
    });
    assert.equal(reschedRes.status, 200);
    assert.ok(reschedRes.data.success);
    assert.equal(reschedRes.data.appointment.status, "Rescheduled");
    assert.equal(reschedRes.data.appointment.scheduledStartTime, newTargetSlot.startTime);

    // Verify initialSlot was released back into availability
    const conflictCheck = isSlotConflicting(
      "doc-1",
      initialSlot.date,
      parseISTTime(initialSlot.date, initialSlot.startTime),
      parseISTTime(initialSlot.date, initialSlot.endTime)
    );
    assert.equal(conflictCheck, false, "Previous slot must be released after rescheduling");
  });

  await t.test("7. POST /api/appointments/:token/cancel cancels appointment and releases slot back to pool", async () => {
    // Book a slot
    const slotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    const slot = slotsRes.data.slots[0];

    const bookRes = await makeRequest(testServer, "POST", "/api/slots/book", {
      slotId: slot.slotId,
      doctorId: "doc-1",
      patientId: "pat-cancel-test",
      patientName: "Sunil Verma",
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      symptoms: "Allergy follow-up"
    });
    const token = bookRes.data.appointment.token;

    // Cancel appointment
    const cancelRes = await makeRequest(testServer, "POST", `/api/appointments/${token}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.ok(cancelRes.data.success);
    assert.equal(cancelRes.data.appointment.status, "Cancelled");

    // Verify slot is now unblocked
    const isStillBlocked = isSlotConflicting(
      "doc-1",
      slot.date,
      parseISTTime(slot.date, slot.startTime),
      parseISTTime(slot.date, slot.endTime)
    );
    assert.equal(isStillBlocked, false, "Cancelled slot must be completely released back to availability pool");
  });

  await t.test("8. Doctor schedule customization (working hours, breaks, slot duration)", async () => {
    // 1. Get doctor schedule
    const getRes = await makeRequest(testServer, "GET", "/api/doctor/schedule/doc-1");
    assert.equal(getRes.status, 200);
    assert.ok(getRes.data.success);
    assert.ok(getRes.data.schedule);

    // 2. Update doctor schedule to 20 mins slot duration and new break
    const updatePayload = {
      workStart: "10:00",
      workEnd: "16:00",
      slotDurationMins: 20,
      workDays: [1, 2, 3, 4, 5],
      breaks: [{ start: "12:00", end: "13:00" }]
    };
    const putRes = await makeRequest(testServer, "PUT", "/api/doctor/schedule/doc-1", updatePayload);
    assert.equal(putRes.status, 200);
    assert.ok(putRes.data.success);
    assert.equal(putRes.data.schedule.slotDurationMins, 20);
    assert.equal(putRes.data.schedule.workStart, "10:00");

    // 3. Verify slots generated with new 20-min duration
    const newSlots = generateAvailableSlots("doc-1", 3);
    assert.ok(newSlots.length > 0);
    assert.equal(newSlots[0].durationMins, 20, "Slot duration should reflect updated 20 mins");
    assert.ok(newSlots[0].startTime >= "10:00");

    // Reset back to default 15 minutes for subsequent tests
    await makeRequest(testServer, "PUT", "/api/doctor/schedule/doc-1", {
      workStart: "09:00",
      workEnd: "17:00",
      slotDurationMins: 15,
      workDays: [1, 2, 3, 4, 5, 6],
      breaks: [{ start: "13:00", end: "14:00" }]
    });
  });

  await t.test("9. Agora secure token generation endpoint /api/agora/token", async () => {
    const consultationToken = "VIL-A-999";
    const res = await makeRequest(
      testServer,
      "GET",
      `/api/agora/token?channel=telehealth-${consultationToken}&role=doctor&token=${consultationToken}&userId=doc-1`
    );

    assert.equal(res.status, 200);
    assert.ok(res.data.success);
    assert.equal(res.data.channel, `telehealth-${consultationToken}`);
    assert.equal(res.data.consultationToken, consultationToken);
    assert.equal(res.data.role, "doctor");
    assert.ok(typeof res.data.token === "string" || res.data.token === null);
  });

  await t.test("10. POST /api/consultations/request creates a request with status 'Vitals Pending'", async () => {
    const reqPayload = {
      patientId: "pat-flow-1",
      patientName: "Lakshmi Devi",
      doctorId: "doc-1",
      symptoms: "Dizziness and fatigue",
      urgency: "Normal"
    };

    const res = await makeRequest(testServer, "POST", "/api/consultations/request", reqPayload);
    assert.equal(res.status, 201);
    assert.ok(res.data.success);
    assert.ok(res.data.appointment);
    assert.equal(res.data.appointment.status, "Vitals Pending", "Initial status must be 'Vitals Pending'");
    assert.equal(res.data.appointment.vitals, null, "Vitals must initially be null");
    assert.ok(res.data.appointment.token.startsWith("VIL-"));
  });

  await t.test("11. POST /api/slots/book strictly rejects booking when vitals are still pending (400 Bad Request)", async () => {
    // Attempt booking for pat-flow-1 who is currently in 'Vitals Pending'
    const slotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    const targetSlot = slotsRes.data.slots[0];

    const bookingAttempt = {
      slotId: targetSlot.slotId,
      doctorId: targetSlot.doctorId,
      patientId: "pat-flow-1",
      patientName: "Lakshmi Devi",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime
    };

    const res = await makeRequest(testServer, "POST", "/api/slots/book", bookingAttempt);
    assert.equal(res.status, 400, "Booking before vitals recorded must return 400 Bad Request");
    assert.equal(res.data.success, false);
    assert.match(res.data.error, /vitals must be recorded/i);
  });

  await t.test("12. Health Worker POST /api/vitals validates clinical ranges and updates status to 'Waiting for Doctor Queue'", async () => {
    // 1. Invalid vitals validation check (e.g. impossible SpO2 or blood pressure)
    const invalidPayload = {
      patientId: "pat-flow-1",
      vitals: {
        bp: "invalid-bp",
        temperature: "55", // > 45 C
        pulse: "300",
        spo2: "115"
      }
    };
    const invalidRes = await makeRequest(testServer, "POST", "/api/vitals", invalidPayload);
    assert.equal(invalidRes.status, 400, "Out-of-range vitals must be rejected with 400");
    assert.equal(invalidRes.data.success, false);

    // 2. Valid vitals recorded by health worker
    const validVitals = {
      patientId: "pat-flow-1",
      vitals: {
        bp: "120/80",
        temperature: "37.2",
        pulse: "72",
        spo2: "98",
        bloodSugar: "105",
        painLevel: "2",
        recordedAt: new Date().toISOString()
      }
    };
    const validRes = await makeRequest(testServer, "POST", "/api/vitals", validVitals);
    assert.equal(validRes.status, 200, "Valid vitals recording must succeed with 200");
    assert.ok(validRes.data.success);
    assert.ok(validRes.data.appointment);
    assert.equal(validRes.data.appointment.status, "Waiting for Doctor Queue", "Status must update to 'Waiting for Doctor Queue'");
    assert.equal(validRes.data.appointment.vitals.bp, "120/80");
    assert.equal(Number(validRes.data.appointment.vitals.spo2), 98);
  });

  await t.test("13. Patient books slot after vitals recorded -> status updates to 'Appointment Confirmed' with vitals preserved", async () => {
    const slotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1");
    const targetSlot = slotsRes.data.slots[0];

    const bookingPayload = {
      slotId: targetSlot.slotId,
      doctorId: targetSlot.doctorId,
      patientId: "pat-flow-1",
      patientName: "Lakshmi Devi",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime
    };

    const bookRes = await makeRequest(testServer, "POST", "/api/slots/book", bookingPayload);
    assert.equal(bookRes.status, 201, "Booking after vitals recorded must succeed with 201 Created");
    assert.ok(bookRes.data.success);
    assert.equal(bookRes.data.appointment.status, "Appointment Confirmed");
    assert.ok(bookRes.data.appointment.vitals, "Vitals must be preserved on the confirmed appointment");
    assert.equal(bookRes.data.appointment.vitals.bp, "120/80");
    assert.equal(Number(bookRes.data.appointment.vitals.spo2), 98);
  });
});

