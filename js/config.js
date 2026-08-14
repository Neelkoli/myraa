/* ============================================================
   MYRAA — configuration & defaults
   Everything the user changes is persisted in localStorage.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.config = (function () {
  'use strict';

  const DEFAULTS = {
    apiKey: '',
    model: 'gemini-3.7-flash',
    visionModel: 'gemini-3.7-flash',

    // Cute anime voice (see CUTE VOICE PROMPT): pitch +20..+35%, speed 0.9..0.95x
    voiceRate: 0.92,
    voicePitch: 1.25,
    voiceName: '',
    voiceEnabled: true,
    voiceOnReply: true,

    // Human conversation mode
    conversationMode: false,   // continuous listening, natural behavior
    ackReactions: true,        // short "Hmm... / I see..." reactions
    silenceFollowups: true,    // occasionally ask after long silence

    // Memory
    memoryEnabled: true,
    autoExtract: true,

    // Screen vision
    captureInterval: 5000,     // ms between frames
    screenVisionMode: false,

    // Character
    effects: true,
    characterScale: 1,

    // Videos — drop these files into assets/videos/ (exact names)
    videoIdle: 'assets/videos/JUST WAITNG.mp4',
    videoThinking: 'assets/videos/ANIMA GIRL THINKING.mp4',
    videoTalking: 'assets/videos/ANIMA GIRL TAKING.mp4',
  };

  function get(key) {
    const raw = localStorage.getItem('myraa_' + key);
    if (raw === null) return DEFAULTS[key];
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }

  function set(key, value) {
    localStorage.setItem('myraa_' + key, JSON.stringify(value));
  }

  function reset() {
    Object.keys(DEFAULTS).forEach((k) => localStorage.removeItem('myraa_' + k));
  }

  // Video paths that are overridable at runtime (uploaded via file input).
  const videoKeys = ['videoIdle', 'videoThinking', 'videoTalking'];

  return { DEFAULTS, get, set, reset, videoKeys };
})();
