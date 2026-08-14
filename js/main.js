/* ============================================================
   MYRAA — app shell
   Boots the modules, wires every button, renders settings &
   memory, runs the ambient particles, handles mic + keyboard.
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------- UI helpers shared across modules ---------- */
  const ui = {
    toast(msg, kind) {
      const box = $('toasts');
      if (!box) return;
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
    },
    setStatus(s) {
      const el = $('mainStatus');
      if (el) el.textContent = s;
    },
    onScreenContext(summary) {
      // keep Screen Vision panel warm with the latest understanding
      const el = $('screenVisionNote');
      if (el) el.textContent = '👁 Myraa sees: ' + summary;
    },
  };
  MYRAA.ui = ui;

  /* ---------- settings ---------- */
  function initSettings() {
    const setVal = (id, key) => {
      const el = $(id);
      if (!el) return;
      const v = MYRAA.config.get(key);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    };
    setVal('setApiKey', 'apiKey');
    setVal('setModel', 'model');
    setVal('setVisionModel', 'visionModel');
    setVal('setVoiceRate', 'voiceRate');
    setVal('setVoicePitch', 'voicePitch');
    setVal('setVoiceEnabled', 'voiceEnabled');
    setVal('setVoiceOnReply', 'voiceOnReply');
    setVal('setConversationMode', 'conversationMode');
    setVal('setAckReactions', 'ackReactions');
    setVal('setSilenceFollowups', 'silenceFollowups');
    setVal('setMemoryEnabled', 'memoryEnabled');
    setVal('setAutoExtract', 'autoExtract');
    setVal('setCaptureInterval', 'captureInterval');
    setVal('setEffects', 'effects');

    ['setModel', 'setVisionModel'].forEach((id) => {
      const sel = $(id);
      if (!sel || sel.tagName !== 'SELECT') return;
      sel.innerHTML = '';
      MYRAA.gemini.MODELS.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        sel.appendChild(opt);
      });
      sel.value = MYRAA.config.get(id === 'setModel' ? 'model' : 'visionModel');
    });

    // populate voices
    const voiceSel = $('setVoiceName');
    if (voiceSel) {
      const refresh = (vs) => {
        const cur = MYRAA.config.get('voiceName');
        voiceSel.innerHTML = '<option value="">Auto (cute female)</option>';
        (vs || []).forEach((v) => {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = v.name + ' (' + v.lang + ')';
          voiceSel.appendChild(opt);
        });
        voiceSel.value = cur || '';
      };
      MYRAA.voice.onVoicesChanged = refresh;
      refresh(MYRAA.voice.getVoices());
    }
  }

  function saveSettings() {
    const getVal = (id, key, type) => {
      const el = $(id);
      if (!el) return;
      let v = el.value;
      if (type === 'number') v = parseFloat(v);
      if (el.type === 'checkbox') v = el.checked;
      MYRAA.config.set(key, v);
    };
    getVal('setApiKey', 'apiKey');
    getVal('setModel', 'model');
    getVal('setVisionModel', 'visionModel');
    getVal('setVoiceRate', 'voiceRate', 'number');
    getVal('setVoicePitch', 'voicePitch', 'number');
    getVal('setVoiceEnabled', 'voiceEnabled');
    getVal('setVoiceOnReply', 'voiceOnReply');
    getVal('setConversationMode', 'conversationMode');
    getVal('setAckReactions', 'ackReactions');
    getVal('setSilenceFollowups', 'silenceFollowups');
    getVal('setMemoryEnabled', 'memoryEnabled');
    getVal('setAutoExtract', 'autoExtract');
    getVal('setCaptureInterval', 'captureInterval', 'number');
    getVal('setEffects', 'effects');

    // live-apply
    $('charStatus') && MYRAA.character.setState(MYRAA.character.getState(), { force: true });
    ui.toast('Settings saved', 'ok');
    closeModal('settingsModal');
  }

  function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove('open');
  }

  /* ---------- memory viewer ---------- */
  function renderMemory() {
    const list = $('memoryList');
    if (!list) return;
    const mems = MYRAA.memory.listMemories();
    list.innerHTML = '';
    if (!mems.length) {
      list.innerHTML = '<div class="memory-empty">No memories yet.<br>Talk to Myraa and she\'ll start remembering you — name, hobbies, goals, everything.</div>';
      return;
    }
    mems.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'memory-item';
      const badge = document.createElement('span');
      badge.className = 'memory-cat cat-' + m.category;
      badge.textContent = m.category;
      const content = document.createElement('div');
      content.className = 'memory-content';
      content.textContent = m.content;
      const meta = document.createElement('div');
      meta.className = 'memory-meta';
      meta.textContent = `★ ${m.importance} · seen ${m.count}× · since ${MYRAA.memory.fmtDate(m.firstSeen)}`;
      const del = document.createElement('button');
      del.className = 'memory-del';
      del.textContent = '✕';
      del.addEventListener('click', () => { MYRAA.memory.deleteMemory(m.id); renderMemory(); });
      el.appendChild(badge); el.appendChild(content); el.appendChild(meta); el.appendChild(del);
      list.appendChild(el);
    });
  }

  /* ---------- screen indicator ---------- */
  function initScreenUI() {
    MYRAA.screen.setOnStatus((s) => {
      const ind = $('screenIndicator');
      const btn = $('btnScreenShare');
      if (ind) {
        ind.style.display = s.sharing ? 'flex' : 'none';
        ind.querySelector('.screen-ind-title').textContent = s.paused ? 'Screen sharing — paused' : 'Screen Sharing Active';
      }
      if (btn) btn.classList.toggle('active', s.sharing);
      const visionBtn = $('btnVisionMode');
      if (visionBtn) visionBtn.classList.toggle('active', s.visionMode);
    });
    const vision = $('setVisionMode');
    if (vision) vision.checked = MYRAA.config.get('screenVisionMode');
  }

  /* ---------- mic / conversation mode ---------- */
  function updateMicUI() {
    const btn = $('btnMic');
    const listening = MYRAA.voice.isListening();
    if (btn) {
      btn.classList.toggle('active', listening);
      btn.title = listening ? 'Stop listening' : 'Start voice conversation';
    }
    ui.setStatus(listening ? 'listening' : 'idle');
  }

  function toggleMic() {
    if (MYRAA.voice.isListening()) {
      MYRAA.voice.stopListening();
    } else {
      const ok = MYRAA.voice.startListening(MYRAA.chat.onUserSpoken);
      if (!ok && !MYRAA.voice.supported()) {
        ui.toast('Voice input isn\'t supported in this browser — try Chrome or Edge.', 'error');
      }
    }
    updateMicUI();
  }

  /* ---------- particles ---------- */
  function initParticles() {
    const canvas = $('particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, parts = [];
    const resize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    const N = 60;
    for (let i = 0; i < N; i++) {
      parts.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.8, s: 0.0004 + Math.random() * 0.0012, o: 0.1 + Math.random() * 0.5 });
    }
    (function loop() {
      ctx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.y -= p.s;
        if (p.y < -0.02) p.y = 1.02;
        p.x += Math.sin((Date.now() / 6000) + p.r * 40) * 0.0004;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160, 140, 255, ${p.o})`;
        ctx.fill();
      });
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- video uploads ---------- */
  function initVideoUploads() {
    const map = { setVideoIdle: 'IDLE', setVideoThinking: 'THINKING', setVideoTalking: 'TALKING' };
    Object.keys(map).forEach((id) => {
      const input = $(id);
      if (!input) return;
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        MYRAA.character.setUploadedVideo(map[id], url);
        ui.toast(map[id] + ' video loaded — ' + file.name, 'ok');
      });
    });
  }

  /* ---------- wiring ---------- */
  function wire() {
    // main actions
    const send = () => {
      const input = $('chatInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      MYRAA.chat.sendUserText(text);
    };
    $('btnSend').addEventListener('click', send);
    const input = $('chatInput');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('btnMic').addEventListener('click', toggleMic);

    // panels
    $('btnBrowser').addEventListener('click', () => {
      const p = $('browserPanel');
      if (p.classList.contains('open')) MYRAA.browser.closePanel();
      else MYRAA.browser.openPanel();
    });
    $('btnBrowserClose').addEventListener('click', () => MYRAA.browser.closePanel());
    $('btnNewTab').addEventListener('click', () => MYRAA.browser.createTab());
    $('btnBack').addEventListener('click', () => MYRAA.browser.goBack());
    $('btnFwd').addEventListener('click', () => MYRAA.browser.goForward());
    $('btnReload').addEventListener('click', () => MYRAA.browser.reload());
    $('btnHome').addEventListener('click', () => MYRAA.browser.goHome());
    $('btnGo').addEventListener('click', () => MYRAA.browser.openAddress($('browserAddress').value));
    $('btnExternal').addEventListener('click', () => MYRAA.browser.openExternal());
    $('btnHistory').addEventListener('click', () => MYRAA.browser.showHistory());
    $('btnHistoryClose').addEventListener('click', () => { $('browserHistory').style.display = 'none'; });
    $('btnBlockedOpen').addEventListener('click', () => MYRAA.browser.openExternal());

    // screen
    $('btnScreenShare').addEventListener('click', () => {
      if (MYRAA.screen.isSharing()) MYRAA.screen.stopShare();
      else MYRAA.screen.startShare();
    });
    $('btnVisionMode').addEventListener('click', () => {
      MYRAA.screen.setVisionMode(!MYRAA.screen.isVisionMode());
      const v = $('setVisionMode');
      if (v) v.checked = MYRAA.screen.isVisionMode();
      ui.toast(MYRAA.screen.isVisionMode() ? 'Screen Vision mode ON — Myraa keeps watching your screen.' : 'Screen Vision mode OFF.', '');
    });
    $('screenPause').addEventListener('click', () => {
      if (MYRAA.screen.isPaused()) MYRAA.screen.resumeShare();
      else MYRAA.screen.pauseShare();
    });
    $('screenStop').addEventListener('click', () => MYRAA.screen.stopShare());

    // memory / settings
    $('btnMemory').addEventListener('click', () => {
      renderMemory();
      $('memoryModal').classList.add('open');
    });
    $('memoryClose').addEventListener('click', () => closeModal('memoryModal'));
    $('memoryClear').addEventListener('click', () => {
      if (confirm('Erase ALL memories about you?')) {
        MYRAA.memory.clearMemories();
        renderMemory();
        ui.toast('Memory cleared', 'ok');
      }
    });
    $('memoryExtract').addEventListener('click', async () => {
      const msgs = MYRAA.memory.loadChatlog().slice(-8).map((m) => ({ role: m.role, text: m.text }));
      if (!msgs.length) { ui.toast('No saved conversations to mine yet.', ''); return; }
      ui.toast('Mining saved conversations for memories...', '');
      const n = await MYRAA.memory.extractMemories(msgs);
      renderMemory();
      ui.toast(n > 0 ? n + ' memories stored' : 'No new memories found', 'ok');
    });

    $('btnSettings').addEventListener('click', () => { initSettings(); $('settingsModal').classList.add('open'); });
    $('settingsClose').addEventListener('click', () => closeModal('settingsModal'));
    $('settingsSave').addEventListener('click', saveSettings);
    $('btnTestVoice').addEventListener('click', () => MYRAA.voice.testVoice());
    $('btnClearChat').addEventListener('click', () => { MYRAA.chat.clearChat(); MYRAA.memory.clearChatlog(); ui.toast('Conversation cleared', 'ok'); });

    // modals close on backdrop click / Esc
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
        $('browserHistory') && ($('browserHistory').style.display = 'none');
      }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    // migrate saved models that Google no longer serves to new accounts
    const LEGACY_DEAD = [
      'gemini-2.5-flash', 'gemini-2.5-flash-lite',
      'gemini-2.0-flash', 'gemini-2.0-flash-lite',
      'gemini-1.5-flash', 'gemini-1.5-pro',
    ];
    ['model', 'visionModel'].forEach((k) => {
      if (LEGACY_DEAD.includes(MYRAA.config.get(k))) {
        MYRAA.config.set(k, MYRAA.config.DEFAULTS[k]);
      }
    });

    initParticles();
    MYRAA.voice.loadVoices();
    MYRAA.character.init();
    MYRAA.browser.init();
    wire();
    initScreenUI();
    initVideoUploads();
    MYRAA.voice.setOnListeningChange(() => updateMicUI());
    MYRAA.voice.onInterim = MYRAA.chat.onInterim;
    MYRAA.voice.onSilence = MYRAA.chat.onSilenceDetected;

    // status text follows the character state machine
    MYRAA.character.onStateChange((s) => {
      const main = $('mainStatus');
      if (!main) return;
      if (s === 'IDLE' && MYRAA.voice.isListening()) main.textContent = 'listening';
      else main.textContent = s.toLowerCase();
    });

    // restore conversation mode checkbox
    const conv = $('setConversationMode');
    if (conv) conv.checked = MYRAA.config.get('conversationMode');

    const name = MYRAA.chat.myName && MYRAA.chat.myName();
    setTimeout(() => {
      const msg = MYRAA.gemini.isConfigured()
        ? (name ? `Hey ${name}, I'm here. What's on your mind?` : 'Hi! I\'m Myraa. What\'s on your mind?')
        : 'Hi, I\'m Myraa! Add your Gemini API key in Settings (⚙️) so I can really talk — everything else works in demo mode.';
      MYRAA.chat.appendMessage && MYRAA.chat.appendMessage('myraa', msg);
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
