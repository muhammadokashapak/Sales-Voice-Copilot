importScripts('lib/config.js');

// ============================================================
// Sales Co-Pilot - Background Service Worker (THE BRAIN)
// Orchestrates: Tab Capture → Offscreen STT → Backend Query → Content Script Popup
// ============================================================

// --- State Management ---
let isCapturing = false;
let activeTabId = null;
let wsConnection = null;
let backendOnline = false;
let pingIntervalId = null;
let reconnectTimeoutId = null;
let lastTranscript = '';
let lastTranscriptTime = 0;

// --- Message Listener (Central Router) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'start_capture':
      startCapture(message.meetingUrl).then(sendResponse);
      return true; // Keep channel open for async response

    case 'stop_capture':
      stopCapture().then(sendResponse);
      return true;

    case 'get_status':
      sendResponse({
        isCapturing,
        backendOnline,
        activeTabId
      });
      break;

    case 'transcript_result':
      // Final transcript from offscreen document
      handleFinalTranscript(message.text, message.timestamp);
      break;

    case 'transcript_interim':
      // Interim transcript - forward to popup and content script for live display
      broadcastToPopup({
        type: 'transcript_update',
        data: { text: message.text }
      });
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: 'transcript_update',
          data: { text: message.text, interim: true }
        }).catch(() => {});
      }
      break;

    case 'audio_chunk':
      // Audio chunk from offscreen MediaRecorder (for Whisper STT)
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify({
          type: 'audio_chunk',
          audio_base64: message.audio_base64,
          format: message.format || '.webm'
        }));
      }
      break;

    case 'content_ready':
      if (isCapturing && sender.tab?.id === activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'capture_started' }).catch(() => {});
      }
      break;
  }
});

// Helper: Check if a URL is an internal browser page where capture is restricted
function isInternalPage(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return lower.startsWith('chrome://') || 
         lower.startsWith('chrome-extension://') || 
         lower.startsWith('edge://') || 
         lower.startsWith('about:') || 
         lower.startsWith('chrome-search://') ||
         lower.startsWith('devtools://');
}

// --- Tab Audio Capture Flow ---
async function startCapture(meetingUrl = null) {
  if (isCapturing) return { success: true, message: 'Already capturing' };

  try {
    let targetTab = null;

    // 1. If meeting URL provided, find existing tab or open new tab
    if (meetingUrl && meetingUrl.trim().length > 0) {
      let rawUrl = meetingUrl.trim();
      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        rawUrl = 'https://' + rawUrl;
      }

      // Check if tab with matching URL is already open
      const allTabs = await chrome.tabs.query({});
      const cleanMatch = rawUrl.toLowerCase().replace(/https?:\/\//, '').replace(/\/$/, '');
      targetTab = allTabs.find(t => t.url && t.url.toLowerCase().includes(cleanMatch));

      if (targetTab) {
        // Activate existing meeting tab
        await chrome.tabs.update(targetTab.id, { active: true });
        await new Promise(r => setTimeout(r, 300));
      } else {
        // Create new tab for meeting URL
        targetTab = await chrome.tabs.create({ url: rawUrl, active: true });
        // Wait for tab to load
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === targetTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 4500);
        });
      }
    } else {
      // 1b. Use current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return { success: false, error: 'No active tab found. Please open Google Meet or Zoom.' };
      }
      targetTab = tab;

      // If user is currently on an internal page (like chrome://extensions), auto-open Google Meet
      if (isInternalPage(targetTab.url)) {
        targetTab = await chrome.tabs.create({ url: 'https://meet.google.com/', active: true });
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === targetTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 4000);
        });
      }
    }

    if (!targetTab || isInternalPage(targetTab.url)) {
      return { success: false, error: 'Please paste a meeting link or switch to a meeting tab.' };
    }

    activeTabId = targetTab.id;

    // 2. Ensure content script is injected into the active tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content/content.js']
      });
    } catch (e) {
      // Content script already active or injected
    }

    // 3. Get stream ID using tabCapture API
    let streamId = null;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId });
    } catch (err) {
      return { success: false, error: 'Could not access audio on this tab. Please ensure you are on a live meeting page.' };
    }

    if (!streamId) {
      return { success: false, error: 'Failed to initialize tab audio stream.' };
    }

    // 4. Create offscreen document for audio processing
    await ensureOffscreenDocument();

    // 5. Send stream ID to offscreen document to start STT
    chrome.runtime.sendMessage({
      type: 'start_stt',
      streamId: streamId
    });

    // 6. Connect WebSocket to FastAPI backend
    connectWebSocket();

    // 7. Start periodic health checks
    startHealthChecks();

    isCapturing = true;

    // Notify content script in the active tab to display floating widget HUD
    chrome.tabs.sendMessage(activeTabId, {
      type: 'capture_started'
    }).catch(() => {});

    return { success: true, tabId: activeTabId };
  } catch (error) {
    await stopCapture();
    return { success: false, error: error.message || 'Failed to start meeting capture' };
  }
}

async function stopCapture() {
  isCapturing = false;

  // Close offscreen document
  try {
    if (await chrome.offscreen.hasDocument()) {
      chrome.runtime.sendMessage({ type: 'stop_stt' });
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {}

  // Close WebSocket
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
  clearTimeout(reconnectTimeoutId);

  // Stop health checks
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }

  // Notify content script to clear overlays
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'capture_stopped' }).catch(() => {});
  }

  // Notify popup
  broadcastToPopup({ type: 'status_update', data: { isCapturing: false } });

  activeTabId = null;
  return { success: true };
}

// --- Offscreen Document Management ---
async function ensureOffscreenDocument() {
  try {
    if (await chrome.offscreen.hasDocument()) return;

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capturing tab audio for real-time speech recognition'
    });
  } catch (e) {}
}

// --- Transcript Handling with Debouncing ---
function handleFinalTranscript(text, timestamp) {
  if (!text || text.trim().length < (CONFIG.MIN_QUERY_LENGTH || 3)) return;

  const cleanText = text.trim();
  const now = Date.now();

  // Debounce: skip if identical text was sent very recently
  if (cleanText === lastTranscript && (now - lastTranscriptTime) < (CONFIG.DEBOUNCE_MS || 1500)) {
    return;
  }

  lastTranscript = cleanText;
  lastTranscriptTime = now;

  // Forward transcript to popup and content script for live display
  broadcastToPopup({
    type: 'transcript_update',
    data: { text: cleanText }
  });
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, {
      type: 'transcript_update',
      data: { text: cleanText, final: true }
    }).catch(() => {});
  }

  // Send to backend for RAG strategy lookup via WebSocket
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify({
      type: 'extension_query',
      text: cleanText
    }));
  }
}

// --- WebSocket Connection to FastAPI Backend ---
function connectWebSocket(retryCount = 0) {
  if (wsConnection) {
    wsConnection.close();
  }

  try {
    wsConnection = new WebSocket(CONFIG.WS_URL);

    wsConnection.onopen = () => {
      backendOnline = true;
      retryCount = 0;
      broadcastToPopup({ type: 'status_update', data: { backendOnline: true } });

      // Send authenticated user identity to backend
      chrome.storage.local.get(['sales_copilot_user'], (res) => {
        if (res.sales_copilot_user && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.send(JSON.stringify({
            type: 'auth_identify',
            user: res.sales_copilot_user
          }));
        }
      });
    };

    wsConnection.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Handle transcription_complete from Whisper STT
        if (msg.type === 'transcription_complete') {
          broadcastToPopup({
            type: 'transcript_update',
            data: { text: msg.text }
          });
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, {
              type: 'transcript_update',
              data: { text: msg.text, latency_ms: msg.stt_latency_ms, final: true }
            }).catch(() => {});
          }
        }

        // Handle Real-Time Intent & Psychology Strategy Response
        if (msg.type === 'intent_strategy_response' && activeTabId) {
          const intentData = msg.data;
          if (intentData && intentData.is_match) {
            chrome.tabs.sendMessage(activeTabId, {
              type: 'show_strategy',
              data: {
                question: intentData.client_intent_summary || intentData.intent_title,
                pitch: intentData.recommended_pitch,
                mindset: intentData.client_mindset,
                hidden_concern: intentData.hidden_concern,
                dos: intentData.dos,
                donts: intentData.donts,
                confidence: intentData.confidence_percent || 95,
                q_number: intentData.matched_card_id,
                match_source: 'Intent Psychology Engine'
              }
            }).catch(() => {});

            broadcastToPopup({
              type: 'strategy_found',
              data: { pitch: intentData.recommended_pitch }
            });
          }
        }

        // Handle multi-strategy response from extension_query
        if (msg.type === 'extension_strategies' && activeTabId) {
          const strategies = msg.data?.strategies || [];
          if (strategies.length > 0) {
            const bestStrategy = strategies[0];
            chrome.tabs.sendMessage(activeTabId, {
              type: 'show_strategy',
              data: {
                question: bestStrategy.question_matched,
                pitch: bestStrategy.pitch,
                context: bestStrategy.context,
                confidence: bestStrategy.confidence_percent,
                q_number: bestStrategy.q_number,
                match_source: bestStrategy.match_source
              }
            }).catch(() => {});

            broadcastToPopup({
              type: 'strategy_found',
              data: {
                pitch: bestStrategy.pitch,
                count: strategies.length
              }
            });

            chrome.storage.local.set({ latestStrategies: strategies });
          }
        }

        // Handle standard battlecard_response
        if (msg.type === 'battlecard_response' && activeTabId) {
          const data = msg.data;
          if (data && data.success) {
            chrome.tabs.sendMessage(activeTabId, {
              type: 'show_strategy',
              data: {
                question: data.question_matched,
                pitch: data.response || data.pitch,
                context: data.context,
                confidence: data.confidence_percent,
                q_number: data.q_number,
                match_source: data.match_source
              }
            }).catch(() => {});

            broadcastToPopup({
              type: 'strategy_found',
              data: { pitch: data.response || data.pitch }
            });
          }
        }

        // Handle dynamic custom document / knowledge base update
        if (msg.type === 'knowledge_base_updated') {
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, {
              type: 'knowledge_base_updated',
              data: msg.data
            }).catch(() => {});
          }
          broadcastToPopup({
            type: 'knowledge_base_updated',
            data: msg.data
          });
        }

      } catch (e) {}
    };

    wsConnection.onclose = () => {
      backendOnline = false;
      broadcastToPopup({ type: 'status_update', data: { backendOnline: false } });

      if (isCapturing) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        reconnectTimeoutId = setTimeout(() => connectWebSocket(retryCount + 1), delay);
      }
    };

    wsConnection.onerror = () => {};
  } catch (error) {}
}

// --- Health Checks ---
function startHealthChecks() {
  if (pingIntervalId) clearInterval(pingIntervalId);

  pingIntervalId = setInterval(async () => {
    if (!isCapturing) return;
    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/ping`);
      backendOnline = response.ok;
    } catch (e) {
      backendOnline = false;
    }
  }, CONFIG.PING_INTERVAL);
}

// --- Helper: Broadcast to popup ---
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

