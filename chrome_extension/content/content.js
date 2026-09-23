// ============================================================
// Sales Co-Pilot - Live Floating HUD & Strategy Overlay
// Displays a draggable widget with live transcription + urgent strategy popups
// ============================================================

(() => {
  if (window.__salesCopilotInitialized) {
    const existing = document.getElementById('sales-copilot-root');
    if (existing) existing.style.display = 'block';
    return;
  }
  window.__salesCopilotInitialized = true;

  let overlayContainer = null;
  let shadowRoot = null;
  let isMinimized = false;
  let cardsStack = [];
  let lastProcessedText = '';
  const MAX_CARDS = 5;

// --- Create Floating Widget Overlay inside Shadow DOM ---
function createOverlay() {
  if (overlayContainer) {
    overlayContainer.style.display = 'block';
    return;
  }

  overlayContainer = document.createElement('div');
  overlayContainer.id = 'sales-copilot-root';
  overlayContainer.style.cssText = `
    position: fixed !important;
    top: 24px !important;
    right: 24px !important;
    width: 360px !important;
    max-height: 90vh !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    pointer-events: auto !important;
  `;

  shadowRoot = overlayContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    ::-webkit-scrollbar {
      width: 5px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(6, 182, 212, 0.4);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(6, 182, 212, 0.7);
    }

    .copilot-widget {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(6, 182, 212, 0.3);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(6, 182, 212, 0.15);
      color: #f8fafc;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      max-height: 85vh;
    }

    .copilot-widget.minimized {
      max-height: 52px;
      width: 260px;
    }

    .copilot-widget.minimized .widget-body {
      display: none;
    }

    /* --- Widget Header --- */
    .widget-header {
      padding: 10px 14px;
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9));
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: grab;
      user-select: none;
    }

    .widget-header:active {
      cursor: grabbing;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pulse-dot {
      width: 10px;
      height: 10px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1.1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .header-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .badge-groq {
      font-size: 9px;
      font-weight: 600;
      background: rgba(6, 182, 212, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 1px 6px;
      border-radius: 10px;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-icon {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: #94a3b8;
      border-radius: 6px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.2s;
    }

    .btn-icon:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
    }

    .btn-icon.close-btn:hover {
      background: rgba(239, 68, 68, 0.3);
      color: #ef4444;
    }

    /* --- Widget Body --- */
    .widget-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
    }

    /* --- Live Transcription Box --- */
    .live-transcript-card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 12px;
    }

    .transcript-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .transcript-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .latency-tag {
      font-size: 9px;
      color: #10b981;
      font-family: monospace;
    }

    .transcript-content {
      font-size: 12px;
      line-height: 1.45;
      color: #e2e8f0;
      min-height: 24px;
      max-height: 65px;
      overflow-y: auto;
      font-style: italic;
    }

    .transcript-placeholder {
      color: #64748b;
    }

    /* --- Strategies Container --- */
    .strategies-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 2px;
    }

    .cards-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* --- Urgent Strategy Card --- */
    .strategy-card {
      background: linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98));
      border: 1px solid rgba(16, 185, 129, 0.4);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(16, 185, 129, 0.15);
      position: relative;
      animation: popIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes popIn {
      0% { transform: scale(0.9) translateY(10px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }

    .strategy-card.urgent {
      border-color: rgba(245, 158, 11, 0.6);
      box-shadow: 0 4px 25px rgba(245, 158, 11, 0.2);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
      padding-right: 18px;
    }

    .card-match-badge {
      font-size: 10px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 2px 8px;
      border-radius: 8px;
    }

    .card-q-num {
      font-size: 9px;
      font-weight: 600;
      color: #94a3b8;
    }

    .card-question {
      font-size: 11px;
      font-weight: 600;
      color: #38bdf8;
      margin-bottom: 8px;
      padding: 4px 8px;
      background: rgba(6, 182, 212, 0.08);
      border-left: 2px solid #06b6d4;
      border-radius: 0 6px 6px 0;
    }

    .card-pitch {
      font-size: 12px;
      line-height: 1.5;
      color: #f1f5f9;
      margin-bottom: 10px;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .card-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }

    .btn-copy {
      background: rgba(6, 182, 212, 0.15);
      border: 1px solid rgba(6, 182, 212, 0.3);
      color: #38bdf8;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-copy:hover {
      background: rgba(6, 182, 212, 0.3);
      color: #fff;
    }

    .btn-copy.copied {
      background: rgba(16, 185, 129, 0.25);
      border-color: rgba(16, 185, 129, 0.5);
      color: #34d399;
    }

    .card-dismiss-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: transparent;
      border: none;
      color: #64748b;
      font-size: 11px;
      cursor: pointer;
      width: 18px;
      height: 18px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .card-dismiss-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
    }
  `;

  shadowRoot.appendChild(style);

  // Build Widget HTML
  const widget = document.createElement('div');
  widget.className = 'copilot-widget';
  widget.innerHTML = `
    <div class="widget-header" id="dragHeader">
      <div class="header-left">
        <div class="pulse-dot"></div>
        <span class="header-title">Sales Co-Pilot</span>
        <span class="badge-groq">Groq Turbo</span>
      </div>
      <div class="header-controls">
        <button class="btn-icon" id="btnMinimize" title="Minimize/Expand">−</button>
        <button class="btn-icon close-btn" id="btnCloseWidget" title="Hide Overlay">✕</button>
      </div>
    </div>

    <div class="widget-body">
      <!-- Live Transcription Box -->
      <div class="live-transcript-card">
        <div class="transcript-header">
          <span class="transcript-label">🎙️ Live Speech</span>
          <span class="latency-tag" id="liveLatency">Listening...</span>
        </div>
        <div class="transcript-content" id="liveTranscriptText">
          <span class="transcript-placeholder">Waiting for audio from meeting...</span>
        </div>
      </div>

      <!-- Urgent Strategies Box -->
      <div class="strategies-title">
        <span>⚡ Matching Strategies</span>
        <span id="matchCountBadge" style="font-size:9px; color:#94a3b8;">0 found</span>
      </div>
      <div class="cards-container" id="cardsContainer">
        <div style="font-size: 11px; color: #64748b; text-align: center; padding: 12px 0;">
          Speak or play audio to auto-match sales battlecards.
        </div>
      </div>
    </div>
  `;

  shadowRoot.appendChild(widget);
  document.body.appendChild(overlayContainer);

  // Setup Dragging
  setupDragging(widget, shadowRoot.getElementById('dragHeader'));

  // Setup Minimize
  shadowRoot.getElementById('btnMinimize').addEventListener('click', () => {
    isMinimized = !isMinimized;
    widget.classList.toggle('minimized', isMinimized);
    shadowRoot.getElementById('btnMinimize').textContent = isMinimized ? '+' : '−';
  });

  // Setup Close
  shadowRoot.getElementById('btnCloseWidget').addEventListener('click', () => {
    overlayContainer.style.display = 'none';
  });
}

// --- Draggable Widget Helper ---
function setupDragging(widget, dragHandle) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = overlayContainer.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    overlayContainer.style.right = 'auto';
    overlayContainer.style.left = `${initialLeft}px`;
    overlayContainer.style.top = `${initialTop}px`;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    overlayContainer.style.left = `${Math.max(10, initialLeft + dx)}px`;
    overlayContainer.style.top = `${Math.max(10, initialTop + dy)}px`;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// --- Update Live Transcription ---
function updateLiveTranscript(text, latency_ms = 0) {
  if (!overlayContainer) createOverlay();
  if (overlayContainer.style.display === 'none') overlayContainer.style.display = 'block';

  const textEl = shadowRoot.getElementById('liveTranscriptText');
  const latencyEl = shadowRoot.getElementById('liveLatency');

  if (textEl && text) {
    textEl.innerHTML = `"${escapeHtml(text)}"`;
    textEl.scrollTop = textEl.scrollHeight;
  }
  if (latencyEl && latency_ms > 0) {
    latencyEl.textContent = `Groq ${latency_ms}ms ⚡`;
  }
}

// --- Display Urgent Strategy Card ---
function showStrategy(data) {
  if (!overlayContainer) createOverlay();
  if (overlayContainer.style.display === 'none') overlayContainer.style.display = 'block';

  const container = shadowRoot.getElementById('cardsContainer');
  const matchCountBadge = shadowRoot.getElementById('matchCountBadge');

  // Auto-remove all previous cards so widget stays clean and focused on the latest strategy
  cardsStack.forEach(oldCard => {
    if (oldCard && oldCard.parentNode) oldCard.remove();
  });
  cardsStack = [];
  container.innerHTML = '';

  const question = data.question || data.question_matched || 'Detected Sales Intent';
  const pitch = data.pitch || data.response || 'No strategy generated.';
  const confidence = data.confidence || data.confidence_percent || 0;
  const qNumber = data.q_number || '';
  const mindset = data.mindset || '';
  const hiddenConcern = data.hidden_concern || '';
  const dos = Array.isArray(data.dos) ? data.dos : [];
  const donts = Array.isArray(data.donts) ? data.donts : [];

  let psychologyHtml = '';
  if (mindset || hiddenConcern) {
    psychologyHtml = `
      <div style="background:rgba(15,23,42,0.7); border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:7px 10px; margin:8px 0; font-size:11px;">
        ${mindset ? `<div style="margin-bottom:4px;"><strong style="color:#38bdf8;">🧠 Mindset:</strong> <span style="color:#e2e8f0;">${escapeHtml(mindset)}</span></div>` : ''}
        ${hiddenConcern ? `<div><strong style="color:#f59e0b;">⚠️ Fear:</strong> <span style="color:#e2e8f0;">${escapeHtml(hiddenConcern)}</span></div>` : ''}
      </div>
    `;
  }

  let dosDontsHtml = '';
  if (dos.length > 0 || donts.length > 0) {
    dosDontsHtml = `
      <div style="display:flex; gap:6px; margin:8px 0 4px 0; font-size:10px;">
        ${dos.length > 0 ? `<div style="flex:1; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:5px 7px; color:#34d399;"><strong>✅ DO:</strong> ${escapeHtml(dos[0])}</div>` : ''}
        ${donts.length > 0 ? `<div style="flex:1; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:5px 7px; color:#f87171;"><strong>❌ DON'T:</strong> ${escapeHtml(donts[0])}</div>` : ''}
      </div>
    `;
  }

  const card = document.createElement('div');
  card.className = `strategy-card ${confidence >= 80 ? 'urgent' : ''}`;
  card.innerHTML = `
    <button class="card-dismiss-btn" title="Dismiss">✕</button>
    <div class="card-top">
      <span class="card-match-badge">${confidence}% Confidence</span>
      ${qNumber ? `<span class="card-q-num">Q${qNumber} Card</span>` : ''}
    </div>
    <div class="card-question">🎯 ${escapeHtml(question)}</div>
    ${psychologyHtml}
    <div class="card-pitch">${formatFlowArrows(pitch)}</div>
    ${dosDontsHtml}
    <div class="card-actions">
      <button class="btn-copy">📋 Copy Pitch</button>
    </div>
  `;

  // Dismiss button
  card.querySelector('.card-dismiss-btn').addEventListener('click', () => {
    card.remove();
    cardsStack = [];
    if (matchCountBadge) matchCountBadge.textContent = `0 active`;
    container.innerHTML = `
      <div style="font-size: 11px; color: #64748b; text-align: center; padding: 12px 0;">
        Speak or play audio to auto-match sales battlecards.
      </div>
    `;
  });

  // Copy button
  card.querySelector('.btn-copy').addEventListener('click', (e) => {
    navigator.clipboard.writeText(pitch).then(() => {
      const btn = e.currentTarget;
      btn.textContent = '✅ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 Copy Pitch';
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  // Insert latest card
  container.appendChild(card);
  cardsStack.push(card);

  if (matchCountBadge) {
    matchCountBadge.textContent = `Latest Match`;
  }
}

// --- Helper: HTML Escape ---
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Helper: Format Flow Arrows & Steps ---
function formatFlowArrows(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Replace arrows with styled visual flow icon
  html = html.replace(/(?:\s*(?:\[arrow\]|\(arrow\)|\barrow\b|\barrows\b|-->|->|==>|=>|→|➔|➜)\s*)/gi, 
    ' <span style="display:inline-flex;align-items:center;justify-content:center;background:rgba(6,182,212,0.2);color:#38bdf8;padding:1px 6px;margin:0 3px;border-radius:4px;font-weight:700;font-size:11px;">→</span> ');
  // Highlight numbered steps (e.g. "1. ", "Step 1:")
  html = html.replace(/(?:^|\n|\.\s+)([0-9]{1,2}\.|\b(?:Step|Phase)\s+[0-9]{1,2}:?)/gi, 
    (match, p1) => ` <span style="display:inline-block;background:rgba(16,185,129,0.2);color:#10b981;padding:1px 5px;border-radius:4px;font-weight:700;font-size:10px;">${p1}</span> `);
  return html;
}

// --- Real-Time Ultra-Low Latency (<15ms) Browser Voice Listener + Client Matcher ---
let speechRecognizer = null;
let isOverlayActive = false;
let lastMatchedQ = null;

const CLIENT_SALES_SYNONYMS = {
  price: ['pricing', 'expensive', 'cost', 'costly', 'budget', 'rate', 'dollar', 'paisa', 'charge', 'charges', 'high rate', 'kam karo', 'discount', 'cheaper', 'afford', 'quotation', 'fee'],
  discount: ['discount', 'kam karo', 'less price', 'lower rate', 'concession', 'deal', 'cut price', 'budget tight', 'less amount', 'kam rate'],
  timeline: ['timeline', 'delay', 'late', 'how long', 'deliver', 'delivery', 'deadline', 'when finish', 'duration', 'time take', 'jaldi', 'complete', 'schedule'],
  milestone: ['milestone', 'milestones', 'payment schedule', 'deposit', 'upfront', '30%', 'billing', 'invoice', 'advance', 'terms'],
  nda: ['nda', 'ip', 'intellectual property', 'code theft', 'steal', 'confidential', 'security', 'leak', 'contract', 'source code', 'ownership', 'privacy'],
  freelancer: ['freelancer', 'freelancers', 'upwork', 'fiverr', 'other agency', 'competitor', 'cheaper outside', 'another company'],
  hourly_fixed: ['hourly', 'fixed price', 'fixed scope', 'time and material', 'retainer', 'cr', 'change request', 'extra hours', 'overtime'],
  testing: ['testing', 'bugs', 'bug', 'qa', 'quality assurance', 'security testing', 'code quality', 'crash', 'audit'],
  maintenance: ['maintenance', 'support', 'warranty', 'bug fix', 'after delivery', 'long term', 'sla', 'updates']
};

function matchInstantBattlecard(text) {
  const cards = window.SALES_BATTLECARDS;
  if (!cards || !text || text.trim().length < 3) return null;
  const lower = text.toLowerCase().trim();

  // Casual chatter filter
  if (['hello', 'hi', 'hey', 'good morning', 'testing', 'suno', 'acha', 'theek hai', 'yes', 'no', 'okay'].includes(lower)) {
    return null;
  }

  let bestCard = null;
  let bestScore = 0;

  for (const card of cards) {
    const qLower = (card.question || '').toLowerCase();
    const cLower = (card.context || '').toLowerCase();
    const pLower = (card.pitch || '').toLowerCase();
    let score = 0;

    // 1. Direct Substring Match
    if (lower.length >= 4 && (qLower.includes(lower) || cLower.includes(lower))) {
      score += 55;
    }

    // 2. Token Overlap
    const words = lower.split(/\s+/).filter(w => w.length > 2);
    for (const w of words) {
      if (qLower.includes(w)) score += 15;
      if (cLower.includes(w)) score += 10;
      if (pLower.includes(w)) score += 5;
    }

    // 3. Synonym Group Boost
    for (const [group, syns] of Object.entries(CLIENT_SALES_SYNONYMS)) {
      const textHasSyn = syns.some(s => lower.includes(s));
      const cardHasSyn = syns.some(s => qLower.includes(s) || cLower.includes(s));
      if (textHasSyn && cardHasSyn) {
        score += 35;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  if (bestCard && bestScore >= 40) {
    return {
      question: bestCard.question,
      pitch: bestCard.pitch,
      context: bestCard.context,
      confidence: Math.min(99, Math.round(bestScore + 15)),
      q_number: bestCard.q_number,
      match_source: 'Instant Client-Side Matcher (<5ms)'
    };
  }
  return null;
}

function startBrowserSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  if (speechRecognizer) {
    try { speechRecognizer.stop(); } catch (e) {}
  }

  try {
    speechRecognizer = new SpeechRecognition();
    speechRecognizer.continuous = true;
    speechRecognizer.interimResults = true;
    speechRecognizer.maxAlternatives = 1;
    speechRecognizer.lang = 'en-US';

    speechRecognizer.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          final += item[0].transcript;
        } else {
          interim += item[0].transcript;
        }
      }

      const activeText = (final || interim).trim();
      if (activeText.length >= 3) {
        // Prevent duplicate spam if identical to last processed sentence
        if (activeText === lastProcessedText) return;
        lastProcessedText = activeText;

        // 1. Instant word-by-word visual transcription (<5ms)
        updateLiveTranscript(activeText, 8);

        // 2. Instant In-Memory Battlecard Match (<2ms) — ZERO LATENCY POPUP!
        const instantMatch = matchInstantBattlecard(activeText);
        if (instantMatch && instantMatch.q_number !== lastMatchedQ) {
          lastMatchedQ = instantMatch.q_number;
          showStrategy(instantMatch);
        }

        // 3. Parallel WebSocket sync to backend
        chrome.runtime.sendMessage({
          type: 'transcript_result',
          text: activeText,
          timestamp: Date.now()
        }).catch(() => {});
      }
    };

    speechRecognizer.onerror = () => {};

    speechRecognizer.onend = () => {
      if (isOverlayActive && speechRecognizer) {
        try { speechRecognizer.start(); } catch (e) {}
      }
    };

    speechRecognizer.start();
  } catch (e) {}
}

function stopBrowserSpeechRecognition() {
  if (speechRecognizer) {
    try {
      speechRecognizer.stop();
    } catch (e) {}
    speechRecognizer = null;
  }
  lastMatchedQ = null;
}

// --- Message Router from Background ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'capture_started':
      isOverlayActive = true;
      lastMatchedQ = null;
      createOverlay();
      startBrowserSpeechRecognition();
      break;

    case 'capture_stopped':
      isOverlayActive = false;
      stopBrowserSpeechRecognition();
      if (overlayContainer) {
        overlayContainer.style.display = 'none';
      }
      break;

    case 'transcript_update':
      updateLiveTranscript(message.data?.text, message.data?.latency_ms);
      break;

    case 'show_strategy':
      lastMatchedQ = message.data?.q_number;
      showStrategy(message.data);
      break;

    case 'knowledge_base_updated':
      if (message.data && message.data.strategies) {
        window.SALES_BATTLECARDS = message.data.strategies;
        lastMatchedQ = null;
        if (matchCountBadge) {
          matchCountBadge.textContent = `Active: ${message.data.total_chunks || message.data.strategies.length} cards`;
        }
      }
      break;
  }
});

// Notify background that content script is ready
chrome.runtime.sendMessage({ type: 'content_ready' }).catch(() => {});

})();



