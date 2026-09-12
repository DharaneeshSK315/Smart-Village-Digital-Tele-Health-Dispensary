export function shouldAutoRestoreSession({ isSigningOut, event, session }) {
  if (isSigningOut) return false;
  if (!session || !session.user) return false;
  const allowedEvents = ['SIGNED_IN', 'INITIAL_SESSION'];
  return allowedEvents.includes(event);
}

export function findActivePatientAppointment(appointments, patientId, token = null) {
  if (!Array.isArray(appointments) || !patientId) return null;

  const byPatient = appointments.filter((appointment) => appointment && appointment.patientId === patientId);
  if (!byPatient.length) {
    if (!token) return null;
    return appointments.find((appointment) => appointment && appointment.token === token && appointment.patientId === patientId) || null;
  }

  const active = byPatient.find((appointment) => appointment.status === 'Active')
    || byPatient.find((appointment) => appointment.status === 'Waiting')
    || byPatient[0];

  if (token && active && active.token !== token) {
    const exact = appointments.find((appointment) => appointment && appointment.token === token && appointment.patientId === patientId) || null;
    return exact || active;
  }

  return active || null;
}
