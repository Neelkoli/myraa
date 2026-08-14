/* ============================================================
   MYRAA — voice engine
   TTS: soft, cute, high-pitched anime voice (pitch +20..+35%,
   speed 0.9..0.95x) built on the Web Speech API.
   STT: continuous, natural conversation — no wake words, listens
   through silence, can be interrupted politely.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.voice = (function () {
  'use strict';

  let voices = [];
  let recognition = null;
  let listening = false;
  let onUserSpeech = null;       // callback(text)
  let onListeningChange = null;  // callback(bool)

  /* ---------- TTS ---------- */
  function getVoices() { return voices; }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) {
      // voices load async in Chrome
      window.speechSynthesis.onvoiceschanged = () => {
        voices = window.speechSynthesis.getVoices() || [];
        if (MYRAA.voice.onVoicesChanged) MYRAA.voice.onVoicesChanged(voices);
      };
    }
  }

  function pickVoice() {
    const preferred = MYRAA.config.get('voiceName');
    if (preferred) {
      const hit = voices.find((v) => v.name === preferred);
      if (hit) return hit;
    }
    // cute/female voice preference order
    const patterns = [
      /female/i, /zira/i, /samantha/i, /aria/i, /jenny/i, /google uk english female/i,
      /google us english/i, /natural/i, /susan/i, /karen/i, /moira/i, /tessa/i,
    ];
    for (const p of patterns) {
      const v = voices.find((vv) => p.test(vv.name) && vv.lang && /^en/i.test(vv.lang));
      if (v) return v;
    }
    return voices.find((v) => /^en/i.test(v.lang)) || voices[0] || null;
  }

  function isSpeaking() {
    return !!(window.speechSynthesis && window.speechSynthesis.speaking);
  }

  function interrupt() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // Cute voice: slightly slower (0.9–0.95x), higher pitch (+20–35%)
  function speak(text, { onStart, onEnd } = {}) {
    if (!('speechSynthesis' in window)) { if (onEnd) onEnd(); return; }
    interrupt();
    const utter = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) utter.voice = v;
    utter.rate = MYRAA.config.get('voiceRate');      // ~0.92
    utter.pitch = MYRAA.config.get('voicePitch');    // ~1.25
    utter.volume = 1;
    if (onStart) utter.onstart = onStart;
    if (onEnd) utter.onend = onEnd;
    utter.onerror = () => { if (onEnd) onEnd(); };
    // word boundaries give the avatar natural lip movement while speaking
    utter.onboundary = () => {
      if (MYRAA.voice.onLipPulse) MYRAA.voice.onLipPulse();
    };
    // small delay helps Chrome actually honor the voice
    window.speechSynthesis.speak(utter);
  }

  function testVoice() {
    speak('Hi TECH! It is so nice to see you again!', {});
  }

  /* ---------- STT / human conversation mode ---------- */
  function supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    return rec;
  }

  function startListening(cb) {
    if (!supported()) return false;
    onUserSpeech = cb;

    if (!recognition) {
      recognition = createRecognition();
      recognition._stopped = false;
      let finalText = '';
      let silenceTimer = null;

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += ' ' + r[0].transcript;
          else interim += r[0].transcript;
        }
        if (MYRAA.voice.onInterim) MYRAA.voice.onInterim(interim.trim());
        // user is talking → politely interrupt Myraa if she's speaking
        if (interim.trim() && MYRAA.voice.isSpeaking()) MYRAA.voice.interrupt();
        // reset the natural-silence window
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => { if (MYRAA.voice.onSilence) MYRAA.voice.onSilence(); }, 6500);
      };

      recognition.onend = () => {
        listening = false;
        if (onListeningChange) onListeningChange(false);
        // natural continuation: keep listening unless the user stopped
        if (MYRAA.config.get('conversationMode') && !recognition._stopped) {
          try { recognition.start(); } catch (e) { /* already starting */ }
        }
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          recognition._stopped = true;
          listening = false;
          if (onListeningChange) onListeningChange(false);
          MYRAA.ui && MYRAA.ui.toast('Microphone permission denied — check browser settings.', 'error');
        }
        // 'no-speech' → keep the conversation open; silence is normal
      };

      // flush finished thoughts periodically (no wake words needed)
      recognition._flushTimer = setInterval(() => {
        if (finalText.trim()) {
          const msg = finalText.trim();
          finalText = '';
          if (onUserSpeech) onUserSpeech(msg);
        }
      }, 1400);
    }

    recognition._stopped = false;
    try {
      recognition.start();
      listening = true;
      if (onListeningChange) onListeningChange(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stopListening() {
    if (recognition) {
      recognition._stopped = true;
      if (recognition._flushTimer) clearInterval(recognition._flushTimer);
      try { recognition.stop(); } catch (e) { /* noop */ }
    }
    listening = false;
    if (onListeningChange) onListeningChange(false);
  }

  return {
    getVoices, loadVoices, pickVoice, speak, testVoice, interrupt, isSpeaking,
    supported, startListening, stopListening, isListening: () => listening,
    setOnListeningChange: (fn) => { onListeningChange = fn; },
    onVoicesChanged: null, onInterim: null, onSilence: null, onLipPulse: null,
  };
})();
