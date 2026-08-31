export function shouldAutoRestoreSession({ isSigningOut, event, session }) {
  if (isSigningOut) return false;
  if (!session || !session.user) return false;
  const allowedEvents = ['SIGNED_IN', 'INITIAL_SESSION'];
  return allowedEvents.includes(event);
}
