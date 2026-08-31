import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoRestoreSession } from './authStateGuard.js';

test('ignores auth restore during sign-out', () => {
  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: true, event: 'SIGNED_IN', session: { user: { email: 'doc.vikram@villagemed.in' } } }),
    false
  );
});

test('restores session only for valid signed-in events', () => {
  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: false, event: 'INITIAL_SESSION', session: { user: { email: 'doc.vikram@villagemed.in' } } }),
    true
  );

  assert.equal(
    shouldAutoRestoreSession({ isSigningOut: false, event: 'SIGNED_OUT', session: null }),
    false
  );
});
