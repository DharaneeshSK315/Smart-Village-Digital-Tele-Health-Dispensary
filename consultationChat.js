/**
 * consultationChat.js
 * Pure business logic and utilities for two-way doctor <-> patient tele-consultation chat.
 * Strictly eliminates AI auto-replies and enforces consultation scoping, authorization,
 * and standard WhatsApp-style message alignment (sender on right, receiver on left).
 */

export function filterCleanChat(chatList) {
  if (!Array.isArray(chatList)) return [];
  return chatList.filter(m => {
    if (!m || typeof m !== 'object') return false;
    if (m.sender === 'bot' || m.senderRole === 'bot') return false;
    if (typeof m.senderName === 'string' && m.senderName.includes('AI')) return false;
    if (m.id === 'msg_init_2') return false; // remove legacy simulated bot nurse greeting
    return true;
  });
}

export function createChatMessage({ text, role, currentUser, activeCall, peerSessionId }) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!activeCall || !activeCall.token) return null;

  const consultationToken = activeCall.token;
  const isDoctor = (role === 'doctor' || role === 'doc');
  const isPatient = (role === 'patient' || role === 'pat');
  const isVhw = (role === 'vhw' || role === 'worker');

  let sender = 'patient';
  let senderRole = 'patient';
  let senderName = 'Patient';
  let senderId = currentUser?.id || null;
  let receiverId = null;

  if (isDoctor) {
    sender = 'doctor';
    senderRole = 'doctor';
    senderName = (currentUser && currentUser.name) ? currentUser.name : (activeCall.doctor?.name || 'Dr. Vikram');
    senderId = currentUser?.id || activeCall.doctor?.id || 'doc-1';
    receiverId = activeCall.patient?.id || null;
  } else if (isPatient) {
    sender = 'patient';
    senderRole = 'patient';
    senderName = (currentUser && currentUser.name) ? currentUser.name : (activeCall.patient?.name || 'Patient');
    senderId = currentUser?.id || activeCall.patient?.id || 'pat-1';
    receiverId = activeCall.doctor?.id || null;
  } else if (isVhw) {
    sender = 'worker';
    senderRole = 'vhw';
    senderName = (currentUser && currentUser.name) ? currentUser.name : 'Nurse Anjali';
    senderId = currentUser?.id || 'vhw-1';
    receiverId = activeCall.doctor?.id || null;
  }

  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return {
    id: msgId,
    consultationId: consultationToken,
    sender,
    senderRole,
    senderId: String(senderId),
    senderName,
    receiverId: receiverId ? String(receiverId) : null,
    text: trimmed,
    time: timeStr,
    timestamp: Date.now()
  };
}

export function canReceiveChatMessage(msg, currentConsultationToken) {
  if (!msg || typeof msg !== 'object') return false;
  if (!currentConsultationToken) return false;
  
  // Security check: Ignore messages from a different consultation
  if (msg.consultationId && msg.consultationId !== currentConsultationToken) {
    return false;
  }

  // Reject any AI/bot generated replies
  if (msg.sender === 'bot' || msg.senderRole === 'bot') {
    return false;
  }
  if (typeof msg.senderName === 'string' && msg.senderName.includes('AI')) {
    return false;
  }

  return true;
}

export function getAuthenticatedUserId(currentUser, activeCall = null, viewerRole = null) {
  if (currentUser && currentUser.id) {
    return String(currentUser.id);
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem('vm_session_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return String(parsed.id);
      }
    } catch (e) {}
  }
  // Contextual fallback based on active consultation / viewer role:
  if (viewerRole === 'doc' || viewerRole === 'doctor' || activeCall?.role === 'doctor') {
    return (activeCall?.doctor?.id) ? String(activeCall.doctor.id) : 'doc-1';
  }
  if (viewerRole === 'pat' || viewerRole === 'patient' || activeCall?.role === 'patient') {
    return (activeCall?.patient?.id) ? String(activeCall.patient.id) : 'pat-1';
  }
  if (viewerRole === 'vhw' || activeCall?.role === 'vhw') {
    return 'vhw-1';
  }
  return null;
}

export function classifyChatBubble(msg, currentUserId = null, viewerRole = null) {
  if (!msg) return { isSelf: false, isSystem: false, rowClass: 'chat-message-row justify-start chat-message-peer', bubbleClass: 'chat-bubble', senderLabel: '', roleBadge: '', roleColor: '' };

  if (msg.sender === 'system') {
    return {
      isSelf: false,
      isSystem: true,
      rowClass: 'chat-message-row justify-center chat-message-system',
      bubbleClass: 'chat-bubble system',
      senderLabel: 'System',
      roleBadge: 'System',
      roleColor: '#64748b'
    };
  }

  // Determine alignment dynamically: compare authenticated user's ID with message's sender ID
  let isSelf = false;
  if (currentUserId && msg.senderId) {
    isSelf = (String(currentUserId) === String(msg.senderId));
  } else if (viewerRole) {
    // Secondary fallback only if currentUserId was not provided
    if ((viewerRole === 'doc' || viewerRole === 'doctor') && (msg.sender === 'doctor' || msg.senderRole === 'doc' || msg.senderRole === 'doctor')) {
      isSelf = true;
    } else if ((viewerRole === 'pat' || viewerRole === 'patient') && (msg.sender === 'patient' || msg.senderRole === 'pat' || msg.senderRole === 'patient')) {
      isSelf = true;
    } else if (viewerRole === 'vhw' && (msg.sender === 'worker' || msg.senderRole === 'vhw')) {
      isSelf = true;
    }
  }

  if (isSelf) {
    return {
      isSelf: true,
      isSystem: false,
      rowClass: 'chat-message-row justify-end chat-message-self',
      bubbleClass: 'chat-bubble self',
      senderLabel: 'You',
      roleBadge: 'You',
      roleColor: 'rgba(255,255,255,0.9)'
    };
  }

  const isFromDoctor = (msg.sender === 'doctor' || msg.senderRole === 'doc' || msg.senderRole === 'doctor');
  const bubbleClass = `chat-bubble peer ${isFromDoctor ? 'doctor-msg' : 'patient-msg'}`;
  const rowClass = 'chat-message-row justify-start chat-message-peer';
  const senderLabel = msg.senderName || (isFromDoctor ? 'Doctor' : 'Patient');
  const roleBadge = isFromDoctor ? '🩺 Doctor' : '👤 Patient';
  const roleColor = isFromDoctor ? '#1d4ed8' : '#0f766e';

  return {
    isSelf: false,
    isSystem: false,
    rowClass,
    bubbleClass,
    senderLabel,
    roleBadge,
    roleColor
  };
}

export function mergeChatMessages(existingChat = [], incomingMessages = []) {
  const list = Array.isArray(incomingMessages) ? incomingMessages : [incomingMessages];
  const cleanList = filterCleanChat(list);
  const cleanExisting = filterCleanChat(existingChat);
  const map = new Map();

  cleanExisting.forEach(m => {
    if (m && m.id) map.set(m.id, m);
  });

  cleanList.forEach(m => {
    if (m && m.id && !map.has(m.id)) {
      map.set(m.id, m);
    }
  });

  return Array.from(map.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}
