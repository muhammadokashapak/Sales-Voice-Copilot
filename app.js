/**
 * Voice RAG Sales Co-Pilot - Simple Controller
 * Features: Instant STT, Smart Strategy Popup, Auto-TTS Ear Cue, and Mini Zoom HUD.
 */

const state = {
  ws: null,
  isListening: false,
  continuousVad: false,
  autoPopup: true,
  autoTts: false,
  recognition: null,
  isSpacePressed: false,
  activePitch: '',
  meetingStream: null,
  mediaRecorder: null,
  isMeetingStreaming: false,
  audioSourceType: 'tab'
};

// DOM References
const el = {
  statusPill: document.getElementById('statusPill'),
  btnMasterMic: document.getElementById('btnMasterMic'),
  stageBadgeText: document.getElementById('stageBadgeText'),
  liveTranscriptDisplay: document.getElementById('liveTranscriptDisplay'),
  chkContinuousVad: document.getElementById('chkContinuousVad'),
  chkAutoPopup: document.getElementById('chkAutoPopup'),
  chkAutoTts: document.getElementById('chkAutoTts'),
  voiceBar: document.querySelector('.voice-hero-bar'),

  // Meeting Audio Modal
  meetingModal: document.getElementById('meetingModal'),
  btnCloseMeetingModal: document.getElementById('btnCloseMeetingModal'),
  txtMeetingUrl: document.getElementById('txtMeetingUrl'),
  btnLaunchMeetingTab: document.getElementById('btnLaunchMeetingTab'),
  meetingPresetChips: document.querySelectorAll('.meeting-preset-chip'),
  cardSourceTab: document.getElementById('cardSourceTab'),
  cardSourceMic: document.getElementById('cardSourceMic'),
  meetingStreamStatus: document.getElementById('meetingStreamStatus'),
  btnStartMeetingAudio: document.getElementById('btnStartMeetingAudio'),
  btnStopMeetingAudio: document.getElementById('btnStopMeetingAudio'),
  meetingStatusBadge: document.getElementById('meetingStatusBadge'),
  streamSubtext: document.getElementById('streamSubtext'),

  // Intent Analyzer
  txtClientIntentInput: document.getElementById('txtClientIntentInput'),
  btnAnalyzeIntent: document.getElementById('btnAnalyzeIntent'),
  presetChips: document.querySelectorAll('.preset-chip'),

  // Intent Strategy Modal
  intentStrategyModal: document.getElementById('intentStrategyModal'),
  modalIntentBadge: document.getElementById('modalIntentBadge'),
  modalIntentIcon: document.getElementById('modalIntentIcon'),
  modalIntentTitle: document.getElementById('modalIntentTitle'),
  modalConfidencePill: document.getElementById('modalConfidencePill'),
  modalClientText: document.getElementById('modalClientText'),
  modalClientMindset: document.getElementById('modalClientMindset'),
  modalHiddenConcern: document.getElementById('modalHiddenConcern'),
  modalPitchText: document.getElementById('modalPitchText'),
  modalDosList: document.getElementById('modalDosList'),
  modalDontsList: document.getElementById('modalDontsList'),
  modalKbInfo: document.getElementById('modalKbInfo'),
  modalKbRef: document.getElementById('modalKbRef'),
  btnCloseIntentModal: document.getElementById('btnCloseIntentModal'),
  btnModalListen: document.getElementById('btnModalListen'),
  btnModalCopy: document.getElementById('btnModalCopy'),
  btnModalCopyText: document.getElementById('btnModalCopyText'),

  // Strategy Card
  displayMatchedQuestion: document.getElementById('displayMatchedQuestion'),
  displayPitchResponse: document.getElementById('displayPitchResponse'),
  displayContextBody: document.getElementById('displayContextBody'),
  btnCopyPitch: document.getElementById('btnCopyPitch'),
  btnCopyText: document.getElementById('btnCopyText'),
  btnSpeakPitch: document.getElementById('btnSpeakPitch'),
  badgeMatchedQ: document.getElementById('badgeMatchedQ'),
  labelMatchedQ: document.getElementById('labelMatchedQ'),

  // Quick Tags
  pillBtns: document.querySelectorAll('.pill-btn'),

  // Smart Strategy Popup
  smartStrategyPopup: document.getElementById('smartStrategyPopup'),
  popupTitle: document.getElementById('popupTitle'),
  popupMatchedQ: document.getElementById('popupMatchedQ'),
  popupPitchText: document.getElementById('popupPitchText'),
  btnClosePopup: document.getElementById('btnClosePopup'),
  btnPopupCopy: document.getElementById('btnPopupCopy'),
  btnPopupListen: document.getElementById('btnPopupListen'),

  // Mini HUD
  btnToggleHud: document.getElementById('btnToggleHud'),
  miniHudWidget: document.getElementById('miniHudWidget'),
  miniHudHeader: document.getElementById('miniHudHeader'),
  hudDetectedQ: document.getElementById('hudDetectedQ'),
  hudPitch: document.getElementById('hudPitch'),
  btnCloseMiniHud: document.getElementById('btnCloseMiniHud'),
  btnMiniCopy: document.getElementById('btnMiniCopy'),
  btnMiniMic: document.getElementById('btnMiniMic'),
  miniHudOpacity: document.getElementById('miniHudOpacity'),

  // KB Modal
  btnOpenKB: document.getElementById('btnOpenKB'),
  kbModal: document.getElementById('kbModal'),
  btnCloseKBModal: document.getElementById('btnCloseKBModal'),
  kbSearchInput: document.getElementById('kbSearchInput'),
  kbCardsContainer: document.getElementById('kbCardsContainer'),

  // Theme Toggle
  btnThemeToggle: document.getElementById('btnThemeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  themeText: document.getElementById('themeText'),

  toastBox: document.getElementById('toastBox')
};

// Toast notification
function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'simple-toast';
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-cyan"></i> ${text}`;
  el.toastBox.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

// Text-to-Speech (Speaks in Rep's earphone in fluent English)
function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  
  const cleanText = text.replace(/[*#_`"]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.lang = 'en-US';

  // Pick best available English voice
  const voices = window.speechSynthesis.getVoices();
  const naturalEnglish = voices.find(v => (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('David') || v.name.includes('Jenny') || v.name.includes('Guy')))) 
    || voices.find(v => v.lang === 'en-US') 
    || voices.find(v => v.lang.startsWith('en'));

  if (naturalEnglish) {
    utterance.voice = naturalEnglish;
  }
  
  window.speechSynthesis.speak(utterance);
}

// WebSocket Setup
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    el.statusPill.textContent = '🟢 Online';
  };

  state.ws.onclose = () => {
    el.statusPill.textContent = '🔴 Reconnecting...';
    setTimeout(initWebSocket, 2000);
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'stage_update') {
        if (msg.stage === 'searching') {
          el.stageBadgeText.textContent = 'Finding best sales strategy...';
        } else if (msg.stage === 'analyzing_intent') {
          el.stageBadgeText.textContent = 'Analyzing client intent & psychology...';
        } else if (msg.stage === 'transcribing') {
          el.stageBadgeText.textContent = 'Transcribing meeting speech (Whisper)...';
        }
      } else if (msg.type === 'transcription_complete') {
        if (msg.text) {
          el.liveTranscriptDisplay.textContent = `"${msg.text}"`;
          showToast(`Transcribed (${msg.stt_latency_ms || 0}ms): "${msg.text.length > 30 ? msg.text.slice(0, 30) + '...' : msg.text}"`);
        }
      } else if (msg.type === 'battlecard_response') {
        handleBattlecardResponse(msg.data);
      } else if (msg.type === 'intent_strategy_response') {
        handleIntentStrategyResponse(msg.data);
      }
    } catch (e) {
      console.error(e);
    }
  };
}

// Handle AI / RAG Strategy Response
function handleBattlecardResponse(data) {
  el.stageBadgeText.textContent = 'Hold Spacebar or Click Mic to Listen';
  el.btnMasterMic.classList.remove('listening');
  el.voiceBar.classList.remove('listening');
  state.isListening = false;

  const matchedQ = data.question_matched || 'Client Objection';
  const pitch = data.response || data.pitch || 'No response found.';
  state.activePitch = pitch;

  // 1. Update Main UI Card if present
  if (el.displayMatchedQuestion) el.displayMatchedQuestion.textContent = `Client: "${matchedQ}"`;
  if (el.displayPitchResponse) el.displayPitchResponse.textContent = pitch;
  if (el.displayContextBody) el.displayContextBody.textContent = data.context || 'End-to-end engineering excellence and risk mitigation.';
  if (data.q_number && el.labelMatchedQ) {
    el.labelMatchedQ.textContent = `MATCHED: Q${data.q_number} STRATEGY`;
  }

  // 2. Update Mini HUD
  if (el.hudDetectedQ) el.hudDetectedQ.textContent = `Client: "${matchedQ}"`;
  if (el.hudPitch) el.hudPitch.textContent = pitch;

  // 3. 🚨 Show Smart Strategy Popup if enabled
  if (state.autoPopup) {
    if (el.popupMatchedQ) el.popupMatchedQ.textContent = `"${matchedQ}"`;
    if (el.popupPitchText) el.popupPitchText.textContent = pitch;
    if (el.smartStrategyPopup) el.smartStrategyPopup.style.display = 'block';
  }

  // 4. 🎧 Auto Read Strategy Aloud (Audio Voice in Ear) if enabled
  if (state.autoTts) {
    speakText(pitch);
    showToast('Speaking strategy cue into earphone (TTS)');
  }
}

// 🎯 Handle Client Intent & Strategy Modal Display
function handleIntentStrategyResponse(data) {
  if (el.btnAnalyzeIntent) {
    el.btnAnalyzeIntent.classList.remove('loading');
    el.btnAnalyzeIntent.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Analyze Intent</span>';
  }

  if (!data || !data.success) {
    showToast('Could not analyze intent. Please try another phrase.');
    return;
  }

  const badgeColor = data.badge_color || 'amber';
  const iconClass = data.icon || 'fa-bullseye';
  const intentTitle = data.intent_title || 'Client Objection';
  const confidence = data.confidence_percent || 88;
  const clientText = data.input_text || (el.txtClientIntentInput ? el.txtClientIntentInput.value : '');
  const pitch = data.recommended_pitch || 'Strategic response prepared.';

  // 1. Update Modal Elements
  if (el.modalIntentBadge) {
    el.modalIntentBadge.className = `intent-tag-badge badge-${badgeColor}`;
  }
  if (el.modalIntentIcon) {
    el.modalIntentIcon.className = `fa-solid ${iconClass}`;
  }
  if (el.modalIntentTitle) {
    el.modalIntentTitle.textContent = intentTitle.toUpperCase();
  }
  if (el.modalConfidencePill) {
    el.modalConfidencePill.textContent = `🎯 ${confidence}% Match`;
  }
  if (el.modalClientText) {
    el.modalClientText.textContent = `"${clientText}"`;
  }
  if (el.modalClientMindset) {
    el.modalClientMindset.textContent = data.client_mindset || 'Evaluating value proposition and risk.';
  }
  if (el.modalHiddenConcern) {
    el.modalHiddenConcern.textContent = data.hidden_concern || 'Wants certainty and high execution standard.';
  }
  if (el.modalPitchText) {
    el.modalPitchText.textContent = pitch;
  }

  // Dos List
  if (el.modalDosList) {
    el.modalDosList.innerHTML = '';
    (data.dos || ['Anchor value on quality and risk management']).forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.modalDosList.appendChild(li);
    });
  }

  // Donts List
  if (el.modalDontsList) {
    el.modalDontsList.innerHTML = '';
    (data.donts || ['Do not give unconditional discounts']).forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.modalDontsList.appendChild(li);
    });
  }

  // Matched KB reference
  if (el.modalKbRef) {
    if (data.q_number) {
      el.modalKbRef.textContent = `Matched: Q${data.q_number} Battlecard Strategy (${data.matched_question || ''})`;
    } else {
      el.modalKbRef.textContent = 'Matched: Enterprise Sales Strategy & Playbook';
    }
  }

  // 2. Open Modal Popup or smooth live update if already open
  if (el.intentStrategyModal) {
    el.intentStrategyModal.style.display = 'flex';
  }

  // Visual pulse on live update
  const pitchCard = document.querySelector('.modal-pitch');
  if (pitchCard) {
    pitchCard.classList.remove('updated-flash');
    void pitchCard.offsetWidth; // trigger reflow
    pitchCard.classList.add('updated-flash');
  }

  // 3. Also sync to Main UI Card if present
  if (el.displayMatchedQuestion) el.displayMatchedQuestion.textContent = `Client: "${data.matched_question || clientText}"`;
  if (el.displayPitchResponse) el.displayPitchResponse.textContent = pitch;
  if (el.displayContextBody) el.displayContextBody.textContent = data.context || data.hidden_concern || '';
  if (data.q_number && el.labelMatchedQ) {
    el.labelMatchedQ.textContent = `MATCHED: Q${data.q_number} - ${intentTitle}`;
  }

  // 4. Also update HUD
  if (el.hudDetectedQ) el.hudDetectedQ.textContent = `Intent: ${intentTitle}`;
  if (el.hudPitch) el.hudPitch.textContent = pitch;

  // 5. Speak if Auto TTS is active
  if (state.autoTts) {
    speakText(pitch);
  }

  showToast(`Detected: ${intentTitle}`);
}

// 🎯 Analyze Client Intent (API + WebSocket) - Real-time continuous detection
async function analyzeClientIntent(text) {
  const queryText = (text || (el.txtClientIntentInput ? el.txtClientIntentInput.value : '')).trim();
  if (!queryText) {
    showToast('Please type or select client text to analyze');
    if (el.txtClientIntentInput) el.txtClientIntentInput.focus();
    return;
  }

  if (el.btnAnalyzeIntent) {
    el.btnAnalyzeIntent.classList.add('loading');
    el.btnAnalyzeIntent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Analyzing...</span>';
  }

  el.stageBadgeText.textContent = 'Decoding client intent & mindset...';

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'analyze_intent', text: queryText }));
  } else {
    try {
      const res = await fetch('/api/analyze-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queryText })
      });
      const data = await res.json();
      handleIntentStrategyResponse(data);
    } catch (err) {
      console.error(err);
      if (el.btnAnalyzeIntent) {
        el.btnAnalyzeIntent.classList.remove('loading');
        el.btnAnalyzeIntent.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Analyze Intent</span>';
      }
      showToast('Error analyzing intent. Please try again.');
    }
  }
}

// Send query to backend (routes to both KB and Intent Decider)
function sendQuery(queryText) {
  if (!queryText.trim()) return;
  el.liveTranscriptDisplay.textContent = `"${queryText}"`;
  el.stageBadgeText.textContent = 'Analyzing client objection...';

  // Trigger rich intent analysis for live modal updates
  analyzeClientIntent(queryText);

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'query', text: queryText }));
  } else {
    fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryText })
    })
    .then(r => r.json())
    .then(handleBattlecardResponse)
    .catch(console.error);
  }
}

// Speech Recognition (Continuous Real-Time Listening)
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';

  state.recognition.onresult = (event) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    const text = (final || interim).trim();
    if (text) {
      el.liveTranscriptDisplay.textContent = `"${text}"`;
    }

    if (final.trim()) {
      // Automatically detect and continuously update strategy modal
      sendQuery(final.trim());
    }
  };

  state.recognition.onend = () => {
    if (state.isListening || state.continuousVad) {
      try { state.recognition.start(); } catch (e) {}
    } else {
      stopListening();
    }
  };
}

// ==========================================================================
// 🎙️ Live Meeting Audio & Stream Controller
// ==========================================================================

function openMeetingModal() {
  if (el.meetingModal) {
    el.meetingModal.style.display = 'flex';
  }
}

function closeMeetingModal() {
  if (el.meetingModal) {
    el.meetingModal.style.display = 'none';
  }
}

async function startMeetingAudioStream() {
  try {
    let stream = null;
    const isTab = state.audioSourceType === 'tab';

    if (isTab) {
      // Capture Tab/System Audio
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showToast('Tab audio not supported in this browser. Using microphone.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        showToast('Select your Google Meet/Zoom tab & check "Share tab audio"');
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        
        // Disable video track right away to keep CPU load low and focus purely on audio
        stream.getVideoTracks().forEach(track => {
          track.stop();
        });
      }
    } else {
      // Capture Direct Microphone
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    if (!stream || stream.getAudioTracks().length === 0) {
      showToast('⚠️ No audio track detected. Make sure "Share tab audio" is enabled.');
      return;
    }

    state.meetingStream = stream;
    state.isMeetingStreaming = true;

    // Listen for user stopping share from browser banner
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      stopMeetingAudioStream();
      showToast('Meeting audio stream stopped');
    });

    // Setup MediaRecorder for streaming chunks
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      else mimeType = '';
    }

    const options = mimeType ? { mimeType } : {};
    state.mediaRecorder = new MediaRecorder(stream, options);

    state.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 200) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string' && reader.result.includes(',')) {
              const base64data = reader.result.split(',')[1];
              if (base64data && base64data.length > 50 && state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({
                  type: 'audio_chunk',
                  audio_base64: base64data,
                  format: mimeType.includes('webm') ? 'webm' : 'wav'
                }));
              }
            }
          };
          reader.readAsDataURL(e.data);
        }
      }
    };

    // Send audio slice every 2.5 seconds
    state.mediaRecorder.start(2500);

    // Also start browser speech recognition if supported for ultra fast local feedback
    if (state.recognition) {
      try { state.recognition.start(); } catch (e) {}
    }

    // UI Updates
    if (el.meetingStreamStatus) el.meetingStreamStatus.style.display = 'flex';
    if (el.btnStartMeetingAudio) el.btnStartMeetingAudio.style.display = 'none';
    if (el.btnStopMeetingAudio) el.btnStopMeetingAudio.style.display = 'flex';
    if (el.meetingStatusBadge) {
      el.meetingStatusBadge.className = 'confidence-pill';
      el.meetingStatusBadge.style.color = '#10b981';
      el.meetingStatusBadge.textContent = '🟢 Live Streaming';
    }

    el.btnMasterMic.classList.add('listening');
    el.voiceBar.classList.add('listening');
    el.stageBadgeText.textContent = '🟢 Live Meeting Stream Active — Listening to client voice...';
    showToast('Meeting Audio Connected! Listening to client...');

  } catch (err) {
    console.error('Error accessing meeting audio:', err);
    showToast(`Could not start audio stream: ${err.message || 'Permission denied'}`);
    stopMeetingAudioStream();
  }
}

function stopMeetingAudioStream() {
  state.isMeetingStreaming = false;

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    try { state.mediaRecorder.stop(); } catch (e) {}
  }
  state.mediaRecorder = null;

  if (state.meetingStream) {
    state.meetingStream.getTracks().forEach(t => t.stop());
    state.meetingStream = null;
  }

  if (state.recognition) {
    try { state.recognition.stop(); } catch (e) {}
  }

  // Reset UI
  if (el.meetingStreamStatus) el.meetingStreamStatus.style.display = 'none';
  if (el.btnStartMeetingAudio) el.btnStartMeetingAudio.style.display = 'flex';
  if (el.btnStopMeetingAudio) el.btnStopMeetingAudio.style.display = 'none';
  if (el.meetingStatusBadge) {
    el.meetingStatusBadge.className = 'confidence-pill';
    el.meetingStatusBadge.style.color = '';
    el.meetingStatusBadge.textContent = '⚡ Ready to Connect';
  }

  el.btnMasterMic.classList.remove('listening');
  el.voiceBar.classList.remove('listening');
  el.stageBadgeText.textContent = 'Hold Spacebar or Click Mic to Listen';
}

function startListening() {
  if (state.isListening || state.isMeetingStreaming) return;
  state.isListening = true;
  el.btnMasterMic.classList.add('listening');
  el.voiceBar.classList.add('listening');
  el.stageBadgeText.textContent = 'Listening to client... (Release spacebar to get strategy)';

  if (state.recognition) {
    try { state.recognition.start(); } catch (e) {}
  }
}

function stopListening() {
  if (state.isMeetingStreaming) return;
  if (!state.isListening) return;
  state.isListening = false;
  el.btnMasterMic.classList.remove('listening');
  el.voiceBar.classList.remove('listening');
  el.stageBadgeText.textContent = 'Processing speech...';

  if (state.recognition) {
    try { state.recognition.stop(); } catch (e) {}
  }

  const spokenText = el.liveTranscriptDisplay.textContent.replace(/^"|"$/g, '').trim();
  if (spokenText && !spokenText.startsWith('Client ki baat')) {
    sendQuery(spokenText);
  }
}

// Event Bindings
function setupEvents() {
  // Push to talk: Spacebar
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !state.isSpacePressed && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      state.isSpacePressed = true;
      startListening();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state.isSpacePressed) {
      e.preventDefault();
      state.isSpacePressed = false;
      if (!state.continuousVad) {
        stopListening();
      }
    }
  });

  // Mic Click -> Opens Meeting Connection Modal
  el.btnMasterMic.addEventListener('click', () => {
    if (state.isMeetingStreaming) {
      openMeetingModal();
    } else {
      openMeetingModal();
    }
  });

  el.btnMiniMic.addEventListener('click', () => {
    if (state.isMeetingStreaming) {
      openMeetingModal();
    } else {
      openMeetingModal();
    }
  });

  // Meeting Modal Event Handlers
  if (el.btnCloseMeetingModal) {
    el.btnCloseMeetingModal.addEventListener('click', () => {
      closeMeetingModal();
    });
  }

  if (el.meetingModal) {
    el.meetingModal.addEventListener('click', (e) => {
      if (e.target === el.meetingModal) {
        closeMeetingModal();
      }
    });
  }

  // Audio Source selection
  if (el.cardSourceTab) {
    el.cardSourceTab.addEventListener('click', () => {
      state.audioSourceType = 'tab';
      el.cardSourceTab.classList.add('active');
      el.cardSourceMic.classList.remove('active');
      el.cardSourceTab.querySelector('.source-radio').innerHTML = '<i class="fa-solid fa-circle-dot text-cyan"></i>';
      el.cardSourceMic.querySelector('.source-radio').innerHTML = '<i class="fa-regular fa-circle"></i>';
    });
  }

  if (el.cardSourceMic) {
    el.cardSourceMic.addEventListener('click', () => {
      state.audioSourceType = 'mic';
      el.cardSourceMic.classList.add('active');
      el.cardSourceTab.classList.remove('active');
      el.cardSourceMic.querySelector('.source-radio').innerHTML = '<i class="fa-solid fa-circle-dot text-cyan"></i>';
      el.cardSourceTab.querySelector('.source-radio').innerHTML = '<i class="fa-regular fa-circle"></i>';
    });
  }

  // Meeting Preset Chips
  if (el.meetingPresetChips) {
    el.meetingPresetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const prefix = chip.getAttribute('data-prefix');
        if (el.txtMeetingUrl) {
          el.txtMeetingUrl.value = prefix;
          el.txtMeetingUrl.focus();
        }
      });
    });
  }

  // Launch Meeting Tab button
  if (el.btnLaunchMeetingTab) {
    el.btnLaunchMeetingTab.addEventListener('click', () => {
      const url = el.txtMeetingUrl ? el.txtMeetingUrl.value.trim() : '';
      if (url) {
        window.open(url, '_blank');
        showToast('Meeting tab opened. Click "Connect Audio" below to start listening.');
      } else {
        showToast('Please enter a valid meeting URL first');
        if (el.txtMeetingUrl) el.txtMeetingUrl.focus();
      }
    });
  }

  // Start Meeting Audio Stream
  if (el.btnStartMeetingAudio) {
    el.btnStartMeetingAudio.addEventListener('click', () => {
      const url = el.txtMeetingUrl ? el.txtMeetingUrl.value.trim() : '';
      if (url && !state.isMeetingStreaming) {
        // If URL provided and not yet opened, give helpful notice
        showToast('Connecting audio stream for meeting...');
      }
      startMeetingAudioStream();
    });
  }

  // Stop Meeting Audio Stream
  if (el.btnStopMeetingAudio) {
    el.btnStopMeetingAudio.addEventListener('click', () => {
      stopMeetingAudioStream();
      showToast('Meeting audio disconnected');
    });
  }

  // Continuous Hands-Free VAD Toggle
  el.chkContinuousVad.addEventListener('change', (e) => {
    state.continuousVad = e.target.checked;
    if (state.continuousVad) {
      startListening();
      showToast('Continuous Hands-Free VAD On');
    } else {
      stopListening();
      showToast('Push-to-Talk (Spacebar) Mode');
    }
  });

  // Auto-Popup Toggle
  el.chkAutoPopup.addEventListener('change', (e) => {
    state.autoPopup = e.target.checked;
    showToast(state.autoPopup ? 'Auto Strategy Popup Enabled' : 'Auto Strategy Popup Disabled');
  });

  // Auto-TTS Toggle
  el.chkAutoTts.addEventListener('change', (e) => {
    state.autoTts = e.target.checked;
    showToast(state.autoTts ? 'Auto Voice Cue in Ear Enabled 🎧' : 'Auto Voice Cue Disabled');
  });

  // Copy Buttons
  if (el.btnCopyPitch) {
    el.btnCopyPitch.addEventListener('click', () => {
      const text = el.displayPitchResponse ? el.displayPitchResponse.textContent.trim() : '';
      navigator.clipboard.writeText(text);
      if (el.btnCopyText) el.btnCopyText.textContent = 'Copied!';
      showToast('Pitch copied to clipboard');
      setTimeout(() => {
        if (el.btnCopyText) el.btnCopyText.textContent = 'Copy Pitch';
      }, 1800);
    });
  }

  if (el.btnPopupCopy) {
    el.btnPopupCopy.addEventListener('click', () => {
      const text = el.popupPitchText.textContent.trim();
      navigator.clipboard.writeText(text);
      showToast('Popup strategy copied!');
    });
  }

  if (el.btnMiniCopy) {
    el.btnMiniCopy.addEventListener('click', () => {
      const text = el.hudPitch.textContent.trim();
      navigator.clipboard.writeText(text);
      showToast('HUD strategy copied!');
    });
  }

  // Listen / TTS Buttons
  if (el.btnSpeakPitch) {
    el.btnSpeakPitch.addEventListener('click', () => {
      if (el.displayPitchResponse) speakText(el.displayPitchResponse.textContent.trim());
      showToast('Playing voice cue');
    });
  }

  if (el.btnPopupListen) {
    el.btnPopupListen.addEventListener('click', () => {
      speakText(el.popupPitchText.textContent.trim());
    });
  }

  // Close Popup
  if (el.btnClosePopup) {
    el.btnClosePopup.addEventListener('click', () => {
      el.smartStrategyPopup.style.display = 'none';
    });
  }

  // Quick Questions
  if (el.pillBtns) {
    el.pillBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        sendQuery(btn.getAttribute('data-q'));
      });
    });
  }

  // Mini HUD Toggle & Opacity
  el.btnToggleHud.addEventListener('click', () => {
    const isShown = el.miniHudWidget.style.display === 'block';
    el.miniHudWidget.style.display = isShown ? 'none' : 'block';
    showToast(isShown ? 'Zoom HUD closed' : 'Zoom HUD opened');
  });

  el.btnCloseMiniHud.addEventListener('click', () => {
    el.miniHudWidget.style.display = 'none';
  });

  el.miniHudOpacity.addEventListener('input', (e) => {
    el.miniHudWidget.style.opacity = e.target.value / 100;
  });

  // Knowledge Base Modal
  el.btnOpenKB.addEventListener('click', () => {
    el.kbModal.style.display = 'flex';
    loadKnowledgeBase();
  });

  el.btnCloseKBModal.addEventListener('click', () => {
    el.kbModal.style.display = 'none';
  });

  el.kbSearchInput.addEventListener('input', (e) => {
    loadKnowledgeBase(e.target.value);
  });

  // ==========================================================================
  // 🎯 Intent Analyzer & Strategy Modal Events
  // ==========================================================================
  if (el.btnAnalyzeIntent) {
    el.btnAnalyzeIntent.addEventListener('click', () => {
      analyzeClientIntent();
    });
  }

  if (el.txtClientIntentInput) {
    el.txtClientIntentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        analyzeClientIntent();
      }
    });
  }

  // Preset Chips
  if (el.presetChips) {
    el.presetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const intentText = chip.getAttribute('data-intent');
        if (el.txtClientIntentInput) {
          el.txtClientIntentInput.value = intentText;
        }
        analyzeClientIntent(intentText);
      });
    });
  }

  // Close Intent Modal
  if (el.btnCloseIntentModal) {
    el.btnCloseIntentModal.addEventListener('click', () => {
      if (el.intentStrategyModal) el.intentStrategyModal.style.display = 'none';
    });
  }

  // Backdrop click to close Intent Modal
  if (el.intentStrategyModal) {
    el.intentStrategyModal.addEventListener('click', (e) => {
      if (e.target === el.intentStrategyModal) {
        el.intentStrategyModal.style.display = 'none';
      }
    });
  }

  // Copy from Intent Modal
  if (el.btnModalCopy) {
    el.btnModalCopy.addEventListener('click', () => {
      const pitch = el.modalPitchText.textContent.trim();
      navigator.clipboard.writeText(pitch);
      if (el.btnModalCopyText) el.btnModalCopyText.textContent = 'Copied!';
      showToast('Strategy pitch copied to clipboard!');
      setTimeout(() => {
        if (el.btnModalCopyText) el.btnModalCopyText.textContent = 'Copy Strategy Pitch';
      }, 1800);
    });
  }

  // Listen / TTS in Intent Modal
  if (el.btnModalListen) {
    el.btnModalListen.addEventListener('click', () => {
      const pitch = el.modalPitchText.textContent.trim();
      speakText(pitch);
      showToast('Playing strategy cue in ear (TTS)');
    });
  }

  // Theme Toggle Button
  if (el.btnThemeToggle) {
    el.btnThemeToggle.addEventListener('click', () => {
      toggleTheme();
    });
  }
}

// 🌓 Theme Controller (Dark / Light Mode)
function initTheme() {
  const savedTheme = localStorage.getItem('sales_copilot_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('sales_copilot_theme', newTheme);
  showToast(newTheme === 'light' ? '☀️ Light Mode Enabled' : '🌙 Dark Mode Enabled');
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    document.body.setAttribute('data-theme', 'light');
    if (el.themeIcon) el.themeIcon.className = 'fa-solid fa-sun text-amber';
    if (el.themeText) el.themeText.textContent = 'Light';
  } else {
    document.body.classList.remove('light-theme');
    document.body.setAttribute('data-theme', 'dark');
    if (el.themeIcon) el.themeIcon.className = 'fa-solid fa-moon';
    if (el.themeText) el.themeText.textContent = 'Dark';
  }
}

// Load KB Cards
async function loadKnowledgeBase(query = '') {
  try {
    const url = query ? `/api/battlecards?q=${encodeURIComponent(query)}` : '/api/battlecards';
    const res = await fetch(url);
    const data = await res.json();

    el.kbCardsContainer.innerHTML = '';
    (data.battlecards || []).forEach(card => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'kb-card-simple';
      cardDiv.innerHTML = `
        <div class="kb-q-title">Q${card.q_number}. ${card.question}</div>
        <div class="kb-p-body">${card.pitch}</div>
      `;
      cardDiv.addEventListener('click', () => {
        handleBattlecardResponse({
          q_number: card.q_number,
          question_matched: card.question,
          pitch: card.pitch,
          response: card.pitch,
          context: card.context
        });
        el.kbModal.style.display = 'none';
        showToast(`Loaded Q${card.q_number}`);
      });
      el.kbCardsContainer.appendChild(cardDiv);
    });
  } catch (err) {
    console.error(err);
  }
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initWebSocket();
  setupSpeechRecognition();
  setupEvents();
});
