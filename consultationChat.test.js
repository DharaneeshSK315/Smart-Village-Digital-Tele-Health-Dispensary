import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatMessage,
  filterCleanChat,
  canReceiveChatMessage,
  classifyChatBubble,
  getAuthenticatedUserId,
  mergeChatMessages
} from './consultationChat.js';

test('creates valid Doctor-to-Patient message without AI bot', () => {
  const activeCall = {
    token: 'VIL-A-431',
    doctor: { id: 'doc-1', name: 'Dr. Vikram' },
    patient: { id: 'pat-5', name: 'Ravi Kumar' }
  };
  const currentUser = { id: 'doc-1', name: 'Dr. Vikram', role: 'Doctor' };

  const msg = createChatMessage({
    text: 'Hello Ravi, please share when your fever started.',
    role: 'doc',
    currentUser,
    activeCall,
    peerSessionId: 'sess_123'
  });

  assert.ok(msg);
  assert.equal(msg.consultationId, 'VIL-A-431');
  assert.equal(msg.senderRole, 'doctor');
  assert.equal(msg.sender, 'doctor');
  assert.equal(msg.senderId, 'doc-1');
  assert.equal(msg.senderName, 'Dr. Vikram');
  assert.equal(msg.receiverId, 'pat-5');
  assert.equal(msg.text, 'Hello Ravi, please share when your fever started.');
  assert.ok(typeof msg.timestamp === 'number');
  assert.ok(typeof msg.time === 'string');
});

test('creates valid Patient-to-Doctor message without AI bot', () => {
  const activeCall = {
    token: 'VIL-A-431',
    doctor: { id: 'doc-1', name: 'Dr. Vikram' },
    patient: { id: 'pat-5', name: 'Ravi Kumar' }
  };
  const currentUser = { id: 'pat-5', name: 'Ravi Kumar', role: 'Patient' };

  const msg = createChatMessage({
    text: 'Doctor, it started yesterday morning with severe body pain.',
    role: 'pat',
    currentUser,
    activeCall,
    peerSessionId: 'sess_456'
  });

  assert.ok(msg);
  assert.equal(msg.consultationId, 'VIL-A-431');
  assert.equal(msg.senderRole, 'patient');
  assert.equal(msg.sender, 'patient');
  assert.equal(msg.senderId, 'pat-5');
  assert.equal(msg.senderName, 'Ravi Kumar');
  assert.equal(msg.receiverId, 'doc-1');
  assert.equal(msg.text, 'Doctor, it started yesterday morning with severe body pain.');
  assert.ok(typeof msg.timestamp === 'number');
});

test('disallows empty or whitespace-only messages', () => {
  const activeCall = { token: 'VIL-A-431' };
  assert.equal(createChatMessage({ text: '', role: 'doc', activeCall }), null);
  assert.equal(createChatMessage({ text: '   ', role: 'doc', activeCall }), null);
  assert.equal(createChatMessage({ text: null, role: 'doc', activeCall }), null);
});

test('filterCleanChat completely removes AI chatbot auto-replies', () => {
  const mixedHistory = [
    { id: 'msg_1', sender: 'doctor', text: 'Hello', time: '10:00' },
    { id: 'msg_bot_1', sender: 'bot', senderRole: 'bot', senderName: '🤖 AI Clinical Assistant', text: 'AI greeting', time: '10:00' },
    { id: 'msg_2', sender: 'patient', text: 'I feel sick', time: '10:01' },
    { id: 'msg_bot_2', sender: 'bot', senderRole: 'bot', text: 'I noted pain symptoms', time: '10:01' },
    { id: 'msg_init_2', sender: 'worker', senderName: 'Nurse Anjali', text: 'Hello Doctor...', time: '10:00' },
    { id: 'msg_3', sender: 'doctor', text: 'Take paracetamol', time: '10:02' }
  ];

  const cleaned = filterCleanChat(mixedHistory);
  assert.equal(cleaned.length, 3);
  assert.equal(cleaned[0].id, 'msg_1');
  assert.equal(cleaned[1].id, 'msg_2');
  assert.equal(cleaned[2].id, 'msg_3');
  assert.ok(!cleaned.some(m => m.sender === 'bot'));
  assert.ok(!cleaned.some(m => m.senderName?.includes('AI')));
});

test('canReceiveChatMessage enforces consultation scoping and rejects cross-consultation messages', () => {
  const currentToken = 'VIL-A-431';

  // Same consultation - accepted
  assert.equal(
    canReceiveChatMessage({ consultationId: 'VIL-A-431', sender: 'doctor', text: 'Hi' }, currentToken),
    true
  );

  // Different consultation - rejected
  assert.equal(
    canReceiveChatMessage({ consultationId: 'VIL-B-219', sender: 'doctor', text: 'Wrong consultation' }, currentToken),
    false
  );

  // Bot message - rejected
  assert.equal(
    canReceiveChatMessage({ consultationId: 'VIL-A-431', sender: 'bot', text: 'Bot auto-reply' }, currentToken),
    false
  );
  assert.equal(
    canReceiveChatMessage({ consultationId: 'VIL-A-431', senderRole: 'bot', text: 'Bot auto-reply' }, currentToken),
    false
  );
  assert.equal(
    canReceiveChatMessage({ consultationId: 'VIL-A-431', sender: 'patient', senderName: '🤖 AI Bot', text: 'Bot auto-reply' }, currentToken),
    false
  );
});

test('resolves authenticated user ID dynamically across contexts', () => {
  const doctorUser = { id: 'doc-1', name: 'Dr. Vikram' };
  const patientUser = { id: 'pat-5', name: 'Ravi Kumar' };
  const activeCall = {
    doctor: { id: 'doc-1', name: 'Dr. Vikram' },
    patient: { id: 'pat-5', name: 'Ravi Kumar' }
  };

  assert.equal(getAuthenticatedUserId(doctorUser), 'doc-1');
  assert.equal(getAuthenticatedUserId(patientUser), 'pat-5');

  // Fallback when currentUser is null
  assert.equal(getAuthenticatedUserId(null, activeCall, 'doc'), 'doc-1');
  assert.equal(getAuthenticatedUserId(null, activeCall, 'pat'), 'pat-5');
});

test('aligns own messages to the right and received messages to the left in Doctor dashboard', () => {
  const doctorMsg = {
    id: 'm1',
    sender: 'doctor',
    senderRole: 'doctor',
    senderId: 'doc-1',
    senderName: 'Dr. Vikram',
    text: 'Please take deep breaths'
  };

  const patientMsg = {
    id: 'm2',
    sender: 'patient',
    senderRole: 'patient',
    senderId: 'pat-5',
    senderName: 'Ravi Kumar',
    text: 'Doing that now'
  };

  // Doctor perspective (currentUserId = 'doc-1'):
  // 1. Doctor's own message MUST appear on the RIGHT
  const docOwnResult = classifyChatBubble(doctorMsg, 'doc-1', 'doc');
  assert.equal(docOwnResult.isSelf, true);
  assert.ok(docOwnResult.rowClass.includes('justify-end'), 'Self message must use justify-end');
  assert.equal(docOwnResult.bubbleClass, 'chat-bubble self');

  // 2. Patient's message received by Doctor MUST appear on the LEFT
  const docReceivedResult = classifyChatBubble(patientMsg, 'doc-1', 'doc');
  assert.equal(docReceivedResult.isSelf, false);
  assert.ok(docReceivedResult.rowClass.includes('justify-start'), 'Peer message must use justify-start');
  assert.equal(docReceivedResult.bubbleClass, 'chat-bubble peer patient-msg');
  assert.equal(docReceivedResult.senderLabel, 'Ravi Kumar');
  assert.equal(docReceivedResult.roleBadge, '👤 Patient');
});

test('aligns own messages to the right and received messages to the left in Patient dashboard', () => {
  const doctorMsg = {
    id: 'm1',
    sender: 'doctor',
    senderRole: 'doctor',
    senderId: 'doc-1',
    senderName: 'Dr. Vikram',
    text: 'Please take deep breaths'
  };

  const patientMsg = {
    id: 'm2',
    sender: 'patient',
    senderRole: 'patient',
    senderId: 'pat-5',
    senderName: 'Ravi Kumar',
    text: 'Doing that now'
  };

  // Patient perspective (currentUserId = 'pat-5'):
  // 1. Patient's own message MUST appear on the RIGHT
  const patOwnResult = classifyChatBubble(patientMsg, 'pat-5', 'pat');
  assert.equal(patOwnResult.isSelf, true);
  assert.ok(patOwnResult.rowClass.includes('justify-end'), 'Self message must use justify-end');
  assert.equal(patOwnResult.bubbleClass, 'chat-bubble self');

  // 2. Doctor's message received by Patient MUST appear on the LEFT
  const patReceivedResult = classifyChatBubble(doctorMsg, 'pat-5', 'pat');
  assert.equal(patReceivedResult.isSelf, false);
  assert.ok(patReceivedResult.rowClass.includes('justify-start'), 'Peer message must use justify-start');
  assert.equal(patReceivedResult.bubbleClass, 'chat-bubble peer doctor-msg');
  assert.equal(patReceivedResult.senderLabel, 'Dr. Vikram');
  assert.equal(patReceivedResult.roleBadge, '🩺 Doctor');
});

test('system messages are centered in chat layout', () => {
  const systemMsg = {
    id: 'sys_1',
    sender: 'system',
    text: 'Encrypted consultation session established.'
  };

  const result = classifyChatBubble(systemMsg, 'doc-1', 'doc');
  assert.equal(result.isSelf, false);
  assert.equal(result.isSystem, true);
  assert.ok(result.rowClass.includes('justify-center'), 'System message must use justify-center');
  assert.equal(result.bubbleClass, 'chat-bubble system');
});

test('mergeChatMessages dedupes and chronologically orders consultation chat', () => {
  const history = [
    { id: 'm1', sender: 'doctor', text: 'Step 1', timestamp: 1000 },
    { id: 'm2', sender: 'patient', text: 'Step 2', timestamp: 2000 }
  ];

  const incoming = [
    { id: 'm2', sender: 'patient', text: 'Step 2 duplicate', timestamp: 2000 },
    { id: 'm3', sender: 'doctor', text: 'Step 3', timestamp: 3000 }
  ];

  const merged = mergeChatMessages(history, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'm1');
  assert.equal(merged[1].id, 'm2');
  assert.equal(merged[2].id, 'm3');
});
