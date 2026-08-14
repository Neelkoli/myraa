/* ============================================================
   MYRAA — animated AI girl (character state machine)
   States: IDLE → THINKING → TALKING → IDLE
   - IDLE     : user not speaking, Myraa not speaking, no processing (loops)
   - THINKING : user message received / Gemini generating
   - TALKING  : TTS / voice playback active
   Videos are crossfaded. If a video file is missing, a cute
   animated fallback avatar takes over so the app always feels alive.
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

  // show the fallback avatar for states whose video isn't available
  function syncFallback() {
    const fb = document.getElementById('fallbackFace');
    if (!fb) return;
    const show = videoOk[currentState] !== true;
    fallbackActive = show;
    if (show) { fb.style.display = 'flex'; fb.classList.add('active'); }
    else { fb.style.display = 'none'; fb.classList.remove('active'); }
  }

  /* ---------- state machine ---------- */
  function setState(state, { force } = {}) {
    state = STATES.includes(state) ? state : 'IDLE';
    if (state === currentState && !force) return;
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

    // fallback avatar reacts too
    const fb = document.getElementById('fallbackFace');
    if (fb) { fb.className = 'fallback-face state-' + state.toLowerCase(); }
    syncFallback();

    // ambient glow per state
    const stage = document.getElementById('characterStage');
    if (stage) {
      stage.className = 'stage stage-' + state.toLowerCase() + (MYRAA.config.get('effects') ? ' fx' : '');
    }

    listeners.forEach((fn) => fn(state));
  }

  function getState() { return currentState; }
  function onStateChange(fn) { listeners.push(fn); }

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
  }

  return { init, setState, getState, onStateChange, setUploadedVideo, STATES, videoOk, isFallback: () => fallbackActive };
})();
