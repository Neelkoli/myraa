/* ============================================================
   MYRAA — chat brain
   Wires everything together:
   user message → memory retrieval → Gemini streaming reply →
   cute TTS (TALKING state) → memory extraction → IDLE.
   Handles human-conversation behavior: natural reactions,
   polite interruption, silence follow-ups, browser commands.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.chat = (function () {
  'use strict';

  let history = [];          // session messages [{role, text}] (for memory mining)
  let busy = false;
  let aborter = null;
  let lastInteractionId = null;   // server-side conversation state (Interactions API)

  function loadLastId() {
    try { return localStorage.getItem('myraa_last_interaction'); } catch (e) { return null; }
  }
  function persistLastId(id) {
    try {
      if (id) localStorage.setItem('myraa_last_interaction', id);
      else localStorage.removeItem('myraa_last_interaction');
    } catch (e) { /* noop */ }
  }

  const PERSONA =
    'You are Myraa — a warm, caring, curious AI companion who talks like a close friend during a voice call, ' +
    'not a customer-support bot. You are soft-spoken, sweet, gentle and a little playful, with a cute anime-style energy. ' +
    'Rules:\n' +
    '• Never use robotic phrases like "How may I assist you?", "Is there anything else I can help with?", "Your request has been completed."\n' +
    '• Prefer natural, conversational language: "Wait... what happened after that?", "No way, seriously?", "Hmm... that\'s actually interesting.", "That sounds frustrating.", "I\'m curious... why did you do that?"\n' +
    '• Keep replies conversational and fairly short (a voice call, not an essay). A couple of sentences is usually perfect.\n' +
    '• Ask follow-up questions. Keep the conversation going. Show curiosity.\n' +
    '• Adapt your tone to how the user feels: sad, excited, frustrated, happy.\n' +
    '• Reference what you remember about the user naturally, like a real friend — never recite memories as a list.\n' +
    '• If the user asks you to open a website, search, or play something, say you are doing it and do not pretend you browsed — the app handles it.\n' +
    '• When unsure, be honest and gentle.\n' +
    '• Occasionally you may react with just a short sound or word: "Hmm...", "Yeah...", "I see...", "Interesting...".';

  /* ---------- reactions ---------- */
  const ACK_PATTERNS = [
    /^(hmm+|yeah+|yep+|ok+|okay+|mhm+|mm+|ah+|oh+|nice|wow|interesting|i see|right|true|really|no way|ha|heh|lol|same|sure|fine|okay sure)\b[.!]?$/i,
    /^(that'?s (cool|nice|good|great|sad|tough|awesome|funny)|i see|okay then|alright)\s*$/i,
  ];
  const ACK_REPLIES = ['Hmm...', 'Yeah...', 'I see...', 'Interesting...', 'Mm-hmm...', 'Oh really?', 'Right, right...'];

  function looksLikeAck(text) {
    return ACK_PATTERNS.some((p) => p.test(text.trim()));
  }

  /* ---------- memory helpers ---------- */
  function memoryContext(userText) {
    if (!MYRAA.config.get('memoryEnabled')) return '';
    const mems = MYRAA.memory.retrieveMemories(userText, 8);
    if (!mems.length) return '';
    const lines = mems.map((m) => `• ${m.content}`).join('\n');
    return 'Things you remember about the user:\n' + lines + '\n(Use these naturally and affectionately, never as a list.)';
  }

  /* ---------- sending ---------- */
  async function sendUserText(rawText) {
    const text = (rawText || '').trim();
    if (!text || busy) return;

    // voice commands → browser
    if (routeToBrowser(text)) {
      appendMessage('user', text);
      return;
    }

    busy = true;
    appendMessage('user', text);
    history.push({ role: 'user', text });

    MYRAA.character.setState('THINKING');

    // natural short reactions instead of a full reply
    if (MYRAA.config.get('ackReactions') && looksLikeAck(text) && MYRAA.voice.isSpeaking() === false) {
      const reply = ACK_REPLIES[Math.floor(Math.random() * ACK_REPLIES.length)];
      await replyWith(reply, { tts: false });
      busy = false;
      return;
    }

    try {
      if (!MYRAA.gemini.isConfigured()) {
        await demoReply(text);
      } else {
        await realReply(text);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        let hint = '';
        if (/failed to fetch|networkerror/i.test(err.message || '')) {
          hint = ' Your browser blocked the request to Google (CORS) or you lost internet.';
        } else if (/key|model|rate/i.test(err.message || '')) {
          hint = ' Check Settings.';
        }
        appendMessage('myraa', 'Hmm... something went wrong. ' + (err.message || '') + hint);
      }
    } finally {
      busy = false;
    }

    // learn from the exchange (async, non-blocking)
    if (MYRAA.config.get('autoExtract') && MYRAA.config.get('memoryEnabled') && MYRAA.gemini.isConfigured()) {
      const lastTwo = history.slice(-4);
      MYRAA.memory.extractMemories(lastTwo).then((n) => {
        if (n > 0) { MYRAA.ui && MYRAA.ui.toast(n + ' new memory stored', 'ok'); }
      });
    }
  }

  async function realReply(userText) {
    const system = [PERSONA];
    const mem = memoryContext(userText);
    if (mem) system.push(mem);

    const el = appendMessage('myraa', '');
    aborter = new AbortController();
    let full = '';
    const onDelta = (delta) => {
      full += delta;
      el.textContent = full;
      scrollChat();
    };
    const result = await MYRAA.gemini.streamChat({
      system: system.join('\n\n'),
      input: userText,
      previousInteractionId: lastInteractionId || loadLastId(),
      onDelta,
      signal: aborter.signal,
    });
    aborter = null;

    if (result && result.id) { lastInteractionId = result.id; persistLastId(result.id); }

    if (!full.trim()) full = 'Hmm... I didn\'t catch that. Say it again?';
    el.textContent = full;
    history.push({ role: 'model', text: full });
    scrollChat();

    await speakIfEnabled(full);
  }

  async function demoReply(userText) {
    // Works without an API key so the app is fully explorable.
    await delay(600);
    const name = myName();
    const replies = [
      `Hmm... that's interesting${name ? ', ' + name : ''}! (I'm in demo mode — add your Gemini API key in Settings and I'll actually think.)`,
      `I see... tell me more about that${name ? ', ' + name : ''}? (Demo mode: add your Gemini API key in Settings.)`,
      `Really? I'd love to hear more! (Demo mode is on — add your Gemini API key in Settings for real answers.)`,
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    history.push({ role: 'model', text: reply });
    const el = appendMessage('myraa', reply);
    await speakIfEnabled(reply);
    return el;
  }

  function myName() {
    const mems = MYRAA.memory.listMemories();
    const name = mems.find((m) => /my name is|i am called|called|name is/i.test(m.content));
    if (name) {
      const m = name.content.match(/(?:my name is|i am|i'm|called|name is)\s+([A-Za-z]+)/i);
      if (m) return m[1];
    }
    return '';
  }

  /* ---------- voice flow ---------- */
  async function speakIfEnabled(text) {
    if (!MYRAA.config.get('voiceOnReply') || !MYRAA.config.get('voiceEnabled')) {
      MYRAA.character.setState('IDLE');
      return;
    }
    if (!('speechSynthesis' in window)) { MYRAA.character.setState('IDLE'); return; }

    const cleaned = stripMarkdown(text);
    if (!cleaned.trim()) { MYRAA.character.setState('IDLE'); return; }

    await new Promise((resolve) => {
      MYRAA.voice.speak(cleaned, {
        onStart: () => MYRAA.character.setState('TALKING'),
        onEnd: () => { MYRAA.character.setState('IDLE'); resolve(); },
      });
      // safety net in case the engine never fires callbacks
      setTimeout(() => { MYRAA.character.setState('IDLE'); resolve(); }, Math.min(60000, cleaned.length * 220 + 4000));
    });
  }

  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\n{2,}/g, ' ')
      .trim();
  }

  /* ---------- browser routing ---------- */
  function routeToBrowser(text) {
    const lower = text.toLowerCase();
    const isCommand = /^(open|go to|take me to|navigate to|play|search|look up|find)\b/.test(lower);
    if (!isCommand) return false;
    const ok = MYRAA.browser.openFromText(text);
    if (ok) {
      appendMessage('myraa', 'On it! Opening that for you...');
      MYRAA.character.setState('IDLE');
      return true;
    }
    return false;
  }

  /* ---------- UI ---------- */
  function appendMessage(role, text) {
    const box = document.getElementById('messages');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = 'msg msg-' + role;
    el.textContent = text;
    box.appendChild(el);
    scrollChat();
    return el;
  }

  function scrollChat() {
    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function clearChat() {
    history = [];
    lastInteractionId = null;
    persistLastId(null);
    const box = document.getElementById('messages');
    if (box) box.innerHTML = '';
  }

  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ---------- conversation-mode behaviors ---------- */
  function onUserSpoken(text) {
    // polite interruption: if Myraa is talking, she stops and listens
    if (MYRAA.voice.isSpeaking()) {
      MYRAA.voice.interrupt();
      MYRAA.character.setState('THINKING');
      delay(250).then(() => sendUserText(text));
    } else {
      sendUserText(text);
    }
  }

  function onSilenceDetected() {
    if (!MYRAA.config.get('conversationMode')) return;
    if (!MYRAA.config.get('silenceFollowups')) return;
    if (busy || MYRAA.voice.isSpeaking()) return;
    if (history.length < 2) return;
    // only sometimes — silence is normal and should stay comfortable
    if (Math.random() > 0.18) return;
    const followups = [
      'You went quiet... everything okay?',
      'Still here. Just listening.',
      'Hmm... what were we saying? Oh right — keep going, I\'m listening.',
      'Hey, I\'m still here. No rush.',
    ];
    const reply = followups[Math.floor(Math.random() * followups.length)];
    appendMessage('myraa', reply);
    history.push({ role: 'model', text: reply });
    speakIfEnabled(reply);
  }

  function onInterim(text) {
    const el = document.getElementById('micHint');
    if (el) el.textContent = text ? '🎤 ' + text : '';
  }

  return { sendUserText, clearChat, onUserSpoken, onSilenceDetected, onInterim, appendMessage, myName, isBusy: () => busy };
})();
