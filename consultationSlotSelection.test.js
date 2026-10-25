import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  app,
  db,
  generateAvailableSlots,
  getAvailableDatesForDoctor,
  epochToISTDate,
  epochToISTTime,
  parseISTTime,
  getDayOfWeekIST,
  DEFAULT_DOCTOR_SCHEDULES
} from "./server.js";

function makeRequest(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "http://localhost:3001");
    const options = {
      method,
      hostname: "localhost",
      port: server.address().port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json" }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test("Consultation Slot Selection & Date Picker Verification", async (t) => {
  let testServer;
  await new Promise((resolve) => {
    testServer = app.listen(0, () => resolve());
  });

  const todayIST = epochToISTDate(Date.now());
  const [y0, m0, d0] = todayIST.split("-").map(Number);
  const tomorrowDay = new Date(Date.UTC(y0, m0 - 1, d0 + 1, 12, 0, 0));
  const tomorrowIST = epochToISTDate(tomorrowDay.getTime());

  await t.test("1. Shows all genuinely available 15-minute consultation slots and hides past slots", () => {
    // Tomorrow slots: Doctor works 09:00 - 17:00 with 13:00 - 14:00 break (7 hours = 28 15-min slots)
    const dowTomorrow = getDayOfWeekIST(tomorrowIST);
    const schedule = DEFAULT_DOCTOR_SCHEDULES["doc-1"];

    if (schedule.workDays.includes(dowTomorrow)) {
      const slots = generateAvailableSlots("doc-1", 100, tomorrowIST);
      assert.ok(slots.length > 0, "Should have available slots for upcoming working day");
      
      // All slots must be strictly 15 minutes long
      slots.forEach(s => {
        assert.equal(s.durationMins, 15, "Slot duration must be 15 minutes");
        assert.equal(s.date, tomorrowIST, "Slot date must match requested date");
        const startMs = parseISTTime(s.date, s.startTime);
        const endMs = parseISTTime(s.date, s.endTime);
        assert.equal(endMs - startMs, 15 * 60 * 1000, "Duration difference must be 15 mins (900,000 ms)");
        assert.ok(s.startTime < "13:00" || s.startTime >= "14:00", "Must not overlap with 13:00-14:00 break");
      });
    }

    // Past date must yield 0 slots
    const pastSlots = generateAvailableSlots("doc-1", 100, "2020-01-01");
    assert.equal(pastSlots.length, 0, "Past date must return empty array of slots");
  });

  await t.test("2. getAvailableDatesForDoctor provides valid labels and integer slot counts (no undefined)", () => {
    const dates = getAvailableDatesForDoctor("doc-1", 7);
    assert.ok(Array.isArray(dates));
    assert.ok(dates.length > 0);

    dates.forEach(d => {
      assert.ok(d.date, "Date must be specified");
      assert.ok(d.label, "Label must be specified");
      assert.notEqual(d.label, "undefined", "Label must never be 'undefined'");
      assert.notEqual(d.label, "Today", "Label should contain the date, e.g. Fri, 23 Oct");
      assert.equal(typeof d.openSlotCount, "number", "openSlotCount must be a number");
      assert.ok(!isNaN(d.openSlotCount), "openSlotCount must not be NaN");
      assert.ok(d.openSlotCount >= 0, "openSlotCount must be non-negative");
    });
  });

  await t.test("3. GET /api/slots?date=... returns slots for selected date and includes availableDates", async () => {
    const res = await makeRequest(testServer, "GET", `/api/slots?doctorId=doc-1&date=${tomorrowIST}&all=true`);
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.selectedDate, tomorrowIST);
    assert.ok(Array.isArray(res.data.slots));
    assert.ok(Array.isArray(res.data.availableDates));

    // Check that availableDates never has undefined openSlotCount
    res.data.availableDates.forEach(d => {
      assert.notEqual(d.openSlotCount, undefined, "openSlotCount must not be undefined");
      assert.notEqual(d.label, undefined, "label must not be undefined");
    });
  });

  await t.test("4. Returns 0 slots and valid response for non-working days or past dates", async () => {
    // Past date
    const res = await makeRequest(testServer, "GET", `/api/slots?doctorId=doc-1&date=2020-05-15&all=true`);
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.slots.length, 0, "No slots should be available for past dates");
  });

  await t.test("5. POST /api/slots/book prevents double booking with 409 Conflict", async () => {
    // Find next working day with slots
    const dates = getAvailableDatesForDoctor("doc-1", 7);
    const targetDay = dates.find(d => d.openSlotCount > 0);
    assert.ok(targetDay, "Must have an upcoming working day with open slots");

    const slots = generateAvailableSlots("doc-1", 5, targetDay.date);
    assert.ok(slots.length > 0);
    const targetSlot = slots[0];

    // Seed test patient and consultation with recorded vitals
    const testPatId = `pat-slot-test-${Date.now()}`;
    const token = `VIL-T-${Math.floor(100 + Math.random() * 900)}`;
    db.appointments.push({
      token,
      patientId: testPatId,
      patientName: "Slot Tester",
      assignedDoctorId: "doc-1",
      status: "Waiting for Doctor Queue",
      vitals: { bpSys: 120, bpDia: 80, hr: 72, spo2: 98, temp: 98.6 }
    });

    const bookingPayload = {
      doctorId: "doc-1",
      patientId: testPatId,
      patientName: "Slot Tester",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime,
      token
    };

    // First booking must succeed (201 Created)
    const bookRes1 = await makeRequest(testServer, "POST", "/api/slots/book", bookingPayload);
    assert.equal(bookRes1.status, 201);
    assert.equal(bookRes1.data.success, true);

    // Second booking of the exact same slot must fail with 409 Conflict
    const secondPatId = `pat-slot-test-2-${Date.now()}`;
    const token2 = `VIL-T-${Math.floor(100 + Math.random() * 900)}`;
    db.appointments.push({
      token: token2,
      patientId: secondPatId,
      patientName: "Second Tester",
      assignedDoctorId: "doc-1",
      status: "Waiting for Doctor Queue",
      vitals: { bpSys: 118, bpDia: 78, hr: 70, spo2: 99, temp: 98.4 }
    });

    const bookRes2 = await makeRequest(testServer, "POST", "/api/slots/book", {
      doctorId: "doc-1",
      patientId: secondPatId,
      patientName: "Second Tester",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime,
      token: token2
    });

    assert.equal(bookRes2.status, 409, "Must reject duplicate booking of the same slot with 409 Conflict");
    assert.equal(bookRes2.data.conflict, true);
  });

  await t.test("6. Special Testing Schedule for Sunday, 25 October 2026: 06:00 to 22:00 in 15-min intervals", async () => {
    const res = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1&date=2026-10-25&all=true");
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.selectedDate, "2026-10-25");
    assert.ok(Array.isArray(res.data.slots));
    assert.ok(res.data.slots.length > 0, "Sunday 25 October 2026 must have available slots for video testing");

    const nowMs = Date.now();
    const firstSlot = res.data.slots[0];
    const lastSlot = res.data.slots[res.data.slots.length - 1];

    // Verify all slots are strictly 15 minutes long and within 06:00 to 22:00
    res.data.slots.forEach(slot => {
      assert.equal(slot.date, "2026-10-25");
      assert.equal(slot.durationMins, 15);
      assert.ok(slot.startTime >= "06:00", `Slot start ${slot.startTime} must be >= 06:00`);
      assert.ok(slot.endTime <= "22:00", `Slot end ${slot.endTime} must be <= 22:00`);
      const slotEndEpoch = parseISTTime(slot.date, slot.endTime);
      assert.ok(slotEndEpoch > nowMs, `Slot ${slot.slotId} must not be a finished/past slot`);
    });

    // Verify final interval ends at 22:00
    assert.equal(lastSlot.endTime, "22:00", "Final slot of the day must end at 22:00 (10:00 PM)");
    assert.equal(lastSlot.startTime, "21:45", "Final slot must be 21:45 - 22:00");
  });

  await t.test("7. Special Schedule strictly applies ONLY to Sunday, 25 October 2026", async () => {
    // Next Sunday: 2026-11-01 must have 0 slots
    const nextSundayRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1&date=2026-11-01&all=true");
    assert.equal(nextSundayRes.status, 200);
    assert.equal(nextSundayRes.data.success, true);
    assert.equal(nextSundayRes.data.slots.length, 0, "Other Sundays (e.g. 2026-11-01) must return 0 slots");

    // Standard weekday: 2026-10-26 (Monday) must preserve normal schedule (09:00 - 17:00 with lunch break)
    const mondayRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1&date=2026-10-26&all=true");
    assert.equal(mondayRes.status, 200);
    assert.equal(mondayRes.data.success, true);
    assert.ok(mondayRes.data.slots.length > 0);
    mondayRes.data.slots.forEach(slot => {
      assert.ok(slot.startTime >= "09:00", "Normal weekday slots start at 09:00");
      assert.ok(slot.endTime <= "17:00", "Normal weekday slots end at 17:00");
      assert.ok(slot.startTime < "13:00" || slot.startTime >= "14:00", "Must observe 13:00-14:00 lunch break");
    });
  });

  await t.test("8. Patient can book video consultation slot on 2026-10-25 and appears on Doctor Dashboard", async () => {
    const slotsRes = await makeRequest(testServer, "GET", "/api/slots?doctorId=doc-1&date=2026-10-25&all=true");
    assert.ok(slotsRes.data.slots.length > 0);
    const targetSlot = slotsRes.data.slots[0];

    const patId = `pat-oct25-test-${Date.now()}`;
    const token = `VIL-A-${Math.floor(100 + Math.random() * 900)}`;

    // Create consultation request with recorded vitals
    db.appointments.push({
      token,
      patientId: patId,
      patientName: "Special Sunday Patient",
      assignedDoctorId: "doc-1",
      status: "Waiting for Doctor Queue",
      vitals: { bpSys: 120, bpDia: 80, hr: 72, spo2: 98, temp: 98.6 }
    });

    const bookRes = await makeRequest(testServer, "POST", "/api/slots/book", {
      doctorId: "doc-1",
      patientId: patId,
      patientName: "Special Sunday Patient",
      date: targetSlot.date,
      startTime: targetSlot.startTime,
      endTime: targetSlot.endTime,
      token
    });

    assert.equal(bookRes.status, 201, "Booking on 2026-10-25 must succeed");
    assert.equal(bookRes.data.success, true);
    assert.equal(bookRes.data.appointment.status, "Appointment Confirmed");
    assert.equal(bookRes.data.appointment.scheduledDate, "2026-10-25");
    assert.equal(bookRes.data.appointment.scheduledStartTime, targetSlot.startTime);

    // Verify appointment is saved in db.appointments for the doctor dashboard
    const savedApp = db.appointments.find(a => a.token === token);
    assert.ok(savedApp);
    assert.equal(savedApp.assignedDoctorId, "doc-1");
    assert.equal(savedApp.status, "Appointment Confirmed");
    assert.equal(savedApp.scheduledDate, "2026-10-25");
  });

  testServer.close();
});
