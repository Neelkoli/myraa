/* ============================================================
   HIYUKI — animated AI girl (character state machine)
   States: IDLE → THINKING → TALKING → IDLE
   - IDLE     : user not speaking, Hiyuki not speaking, no processing (loops)
   - THINKING : user message received / Gemini generating
   - TALKING  : TTS / voice playback active
   Videos are crossfaded. If a video file is missing, the animated
   white-haired girl avatar takes over — she breathes, blinks,
   glances around, tilts her head, smiles, and moves her lips in
   sync with the spoken reply.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.character = (function () {
  'use strict';

  const STATES = ['IDLE', 'THINKING', 'TALKING'];
  let currentState = 'IDLE';
  let listeners = [];

  const videoEls = {};   // state -> <video>
  const videoOk = {};    // state -> bool (file loads)
  let fallbackActive = false;
  let uploaded = {};     // state -> objectURL (from Settings upload)

  const FADE_MS = 650;

  /* ---------- video setup ---------- */
  function videoPath(state) {
    if (uploaded[state]) return uploaded[state];
    return MYRAA.config.get('video' + state.charAt(0) + state.slice(1).toLowerCase());
  }

  function ensureVideos() {
    const stage = document.getElementById('characterStage');
    if (!stage) return;
    STATES.forEach((state) => {
      if (videoEls[state]) { videoEls[state].parentNode && videoEls[state].parentNode.removeChild(videoEls[state]); }
      const v = document.createElement('video');
      v.className = 'char-video char-' + state.toLowerCase();
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      const src = videoPath(state);
      v.src = src;
      v.addEventListener('error', () => { videoOk[state] = false; syncFallback(); });
      v.addEventListener('canplay', () => {
        videoOk[state] = true;
        if (state === currentState) { v.play().catch(() => {}); }
        syncFallback();
      });
      stage.insertBefore(v, stage.firstChild);
      videoEls[state] = v;
    });
  }

  // show the animated avatar for states whose video isn't available
  function syncFallback() {
    const av = document.getElementById('animeAvatar');
    if (!av) return;
    const show = videoOk[currentState] !== true;
    fallbackActive = show;
    if (show) { av.style.display = 'flex'; av.classList.add('active'); }
    else { av.style.display = 'none'; av.classList.remove('active'); }
  }

  /* ---------- state machine ---------- */
  function setState(state, { force } = {}) {
    state = STATES.includes(state) ? state : 'IDLE';
    if (state === currentState && !force) return;
    const previous = currentState;
    currentState = state;

    const status = document.getElementById('charStatus');
    if (status) {
      status.textContent = state;
      status.className = 'chip chip-' + state.toLowerCase();
    }

    STATES.forEach((s) => {
      const v = videoEls[s];
      if (!v) return;
      if (s === state) {
        v.classList.add('active');
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        v.classList.remove('active');
        v.pause();
      }
    });

    // the anime girl reacts to each state
    const av = document.getElementById('animeAvatar');
    if (av) { av.className = 'anime-avatar state-' + state.toLowerCase(); }
    syncFallback();

    // lip movement while speaking
    if (state === 'TALKING') startLipSync();
    else if (previous === 'TALKING') stopLipSync();

    // ambient glow per state
    const stage = document.getElementById('characterStage');
    if (stage) {
      stage.className = 'stage stage-' + state.toLowerCase() + (MYRAA.config.get('effects') ? ' fx' : '');
    }

    listeners.forEach((fn) => fn(state));
  }

  function getState() { return currentState; }
  function onStateChange(fn) { listeners.push(fn); }

  /* ---------- lip movement (TTS) ---------- */
  let lipTimer = null;
  let mouthOpenEl = null;
  let mouthClosedEl = null;

  function mouthEls() {
    if (!mouthOpenEl) mouthOpenEl = document.getElementById('mouthOpen');
    if (!mouthClosedEl) mouthClosedEl = document.getElementById('mouthClosed');
    return mouthOpenEl && mouthClosedEl;
  }

  function setMouthOpen(amount) {
    if (!mouthEls()) return;
    const a = Math.max(0, Math.min(1, amount));
    if (a < 0.08) {
      mouthOpenEl.style.opacity = '0';
      mouthClosedEl.style.opacity = '1';
      mouthOpenEl.style.transform = 'scaleY(0.2)';
    } else {
      mouthOpenEl.style.opacity = '1';
      mouthClosedEl.style.opacity = '0';
      mouthOpenEl.style.transform = `scaleY(${0.35 + a * 0.9})`;
    }
  }

  function startLipSync() {
    stopLipSync();
    setMouthOpen(0.3);
    lipTimer = setInterval(() => {
      // human-ish talking: open, close, linger slightly
      const roll = Math.random();
      if (roll < 0.45) setMouthOpen(0.25 + Math.random() * 0.45);
      else if (roll < 0.8) setMouthOpen(0.6 + Math.random() * 0.4);
      else setMouthOpen(0.1);
    }, 130);
  }

  function stopLipSync() {
    if (lipTimer) { clearInterval(lipTimer); lipTimer = null; }
    setMouthOpen(0);
  }

  // called from TTS word boundaries for finer lip sync
  function lipPulse() {
    if (currentState !== 'TALKING') return;
    setMouthOpen(0.55 + Math.random() * 0.4);
  }

  /* ---------- human-like idle actions ---------- */
  let actionTimer = null;
  let blinkTimer = null;

  function addClass(name, ms) {
    const av = document.getElementById('animeAvatar');
    if (!av) return;
    av.classList.add(name);
    setTimeout(() => av.classList.remove(name), ms);
  }

  function blinkOnce() { addClass('blinking', 150); }

  function glanceOnce() {
    const dir = Math.random() < 0.5 ? 'glance-l' : 'glance-r';
    addClass(dir, 900);
  }

  function smileOnce() { addClass('smiling', 2200); }

  function tiltOnce() {
    const dir = Math.random() < 0.5 ? 'tilting-l' : 'tilting-r';
    addClass(dir, 1600);
  }

  function scheduleAction() {
    if (actionTimer) clearTimeout(actionTimer);
    actionTimer = setTimeout(() => {
      if (currentState === 'TALKING') { scheduleAction(); return; }
      const r = Math.random();
      if (r < 0.28) blinkOnce();
      else if (r < 0.5) glanceOnce();
      else if (r < 0.72) smileOnce();
      else if (r < 0.9) tiltOnce();
      else blinkOnce();
      scheduleAction();
    }, 1200 + Math.random() * 3200);
  }

  /* ---------- video uploads from Settings ---------- */
  function setUploadedVideo(state, objectUrl) {
    uploaded[state] = objectUrl;
    videoOk[state] = undefined;
    ensureVideos();
    setState(currentState, { force: true });
  }

  /* ---------- boot ---------- */
  function init() {
    ensureVideos();
    setState('IDLE', { force: true });
    // preload others quietly
    STATES.forEach((s) => { if (videoEls[s]) videoEls[s].load(); });
    scheduleAction();
  }

  return {
    init, setState, getState, onStateChange, setUploadedVideo, lipPulse,
    STATES, videoOk, isFallback: () => fallbackActive,
  };
})();
