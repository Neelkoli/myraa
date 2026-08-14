/* ============================================================
   MYRAA — screen sharing + screen vision mode
   Uses navigator.mediaDevices.getDisplayMedia() for a REAL screen
   capture, compresses frames, and lets Myraa analyze the user's
   screen with Gemini Vision — answering "what is on my screen?",
   "explain this code", "summarize this page", etc.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.screen = (function () {
  'use strict';

  let stream = null;
  let video = null;
  let captureTimer = null;
  let sharing = false;
  let paused = false;
  let visionMode = false;
  const screenContext = [];   // rolling summaries of recent frames
  const MAX_CONTEXT = 5;
  let onStatus = null;        // callback({sharing, paused, visionMode})

  /* ---------- lifecycle ---------- */
  async function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      MYRAA.ui && MYRAA.ui.toast('Screen capture is not supported in this browser.', 'error');
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        MYRAA.ui && MYRAA.ui.toast('Screen share permission was denied.', 'error');
      } else if (err.name === 'NotFoundError' || err.name === 'AbortError') {
        MYRAA.ui && MYRAA.ui.toast('Screen sharing cancelled.', 'error');
      } else {
        MYRAA.ui && MYRAA.ui.toast('Could not start screen share: ' + err.message, 'error');
      }
      return false;
    }

    const track = stream.getVideoTracks()[0];
    if (!track) { stopShare(); return false; }

    // handle user stopping via the browser's own "Stop sharing" bar
    track.addEventListener('ended', () => {
      stopShare();
      MYRAA.ui && MYRAA.ui.toast('Screen sharing stopped.', '');
    });

    video = document.getElementById('screenCaptureVideo');
    if (video) {
      video.srcObject = stream;
      video.style.display = 'block';
      video.play().catch(() => {});
    }

    sharing = true;
    paused = false;
    showIndicator(true);
    startCaptureLoop();
    emit();
    MYRAA.ui && MYRAA.ui.toast('Screen sharing active — Myraa can see your screen.', 'ok');
    return true;
  }

  function pauseShare() {
    if (!sharing || !stream) return;
    paused = true;
    stream.getVideoTracks().forEach((t) => { t.enabled = false; });
    emit();
  }
  function resumeShare() {
    if (!sharing || !stream) return;
    paused = false;
    stream.getVideoTracks().forEach((t) => { t.enabled = true; });
    emit();
  }

  function stopShare() {
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    sharing = false;
    paused = false;
    if (video) { video.srcObject = null; video.style.display = 'none'; }
    showIndicator(false);
    emit();
  }

  /* ---------- capture ---------- */
  function startCaptureLoop() {
    if (captureTimer) clearInterval(captureTimer);
    const interval = Math.max(2000, MYRAA.config.get('captureInterval') || 5000);
    captureTimer = setInterval(() => {
      if (!sharing || paused || !video || video.readyState < 2) return;
      captureFrame((dataUrl) => {
        if (!dataUrl) return;
        if (visionMode && MYRAA.gemini.isConfigured()) {
          analyzeFrame(dataUrl);           // maintain context automatically
        } else {
          rememberFrame(dataUrl);          // keep latest frame for on-demand questions
        }
      });
    }, interval);
  }

  function captureFrame(cb) {
    const canvas = document.createElement('canvas');
    const MAX_W = 1280;
    let w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { cb(null); return; }
    const scale = Math.min(1, MAX_W / w);
    w = Math.round(w * scale); h = Math.round(h * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    // compression before sending (requirement: use image compression)
    canvas.toBlob((blob) => {
      if (!blob) { cb(null); return; }
      const reader = new FileReader();
      reader.onload = () => { cb(reader.result.split(',')[1]); }; // base64
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.7);
  }

  let lastFrame = null;   // {b64, ts}

  function rememberFrame(b64) {
    lastFrame = { b64, ts: Date.now() };
  }

  async function analyzeFrame(b64) {
    try {
      const summary = await MYRAA.gemini.vision({
        text: 'You are Myraa looking at the user\'s screen right now. ' +
              'Give a SHORT (under 40 words) summary of what is visible: the website/app, ' +
              'main content, and anything notable. No greetings.',
        imageBase64: b64,
        mimeType: 'image/jpeg',
        temperature: 0.3,
      });
      rememberFrame(b64);
      screenContext.push({ ts: Date.now(), summary });
      if (screenContext.length > MAX_CONTEXT) screenContext.shift();
      if (MYRAA.ui && MYRAA.ui.onScreenContext) MYRAA.ui.onScreenContext(summary);
    } catch (e) {
      console.warn('Frame analysis failed:', e);
      rememberFrame(b64);
    }
  }

  /* ---------- ask about the screen ---------- */
  async function ask(question) {
    if (!sharing) {
      throw new Error('Screen sharing is not active. Click "Share Screen" first.');
    }
    if (!MYRAA.gemini.isConfigured()) {
      throw new Error('Add your Gemini API key in Settings to enable Screen Vision.');
    }
    let latest = lastFrame;
    if (!latest || Date.now() - latest.ts > 10000) {
      // grab a fresh frame on demand
      await new Promise((resolve) => captureFrame((b64) => { if (b64) rememberFrame(b64); resolve(); }));
      latest = lastFrame;
    }
    const contextText = screenContext.length
      ? 'Recent screen context:\n' + screenContext.slice(-3).map((c) => '• ' + c.summary).join('\n')
      : 'No prior context yet.';
    return MYRAA.gemini.vision({
      text: 'You are Myraa looking at the user\'s screen. ' +
            'Using the visible screen and the recent context, answer the user naturally and helpfully.\n\n' +
            contextText + '\n\nUser question: ' + question,
      imageBase64: latest ? latest.b64 : null,
      mimeType: 'image/jpeg',
      temperature: 0.5,
    });
  }

  /* ---------- UI ---------- */
  function showIndicator(show) {
    const el = document.getElementById('screenIndicator');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function emit() { if (onStatus) onStatus({ sharing, paused, visionMode }); }
  function setOnStatus(fn) { onStatus = fn; }

  function setVisionMode(on) {
    visionMode = on;
    MYRAA.config.set('screenVisionMode', on);
    if (on && !sharing) {
      // enable but ask user to start sharing
      MYRAA.ui && MYRAA.ui.toast('Start screen sharing to activate Screen Vision.', '');
    }
    emit();
  }

  return {
    startShare, pauseShare, resumeShare, stopShare,
    setVisionMode, ask, setOnStatus,
    isSharing: () => sharing, isPaused: () => paused, isVisionMode: () => visionMode,
  };
})();
