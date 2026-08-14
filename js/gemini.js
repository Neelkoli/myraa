/* ============================================================
   MYRAA — Gemini client (Interactions API)
   Google retired the old generateContent endpoint for new users
   (models like gemini-2.5-flash are no longer available). This
   client uses the current Interactions API:
     POST https://generativelanguage.googleapis.com/v1beta/interactions
   - text + multimodal (vision) input
   - streaming via {"stream": true} + ?alt=sse (step.delta events)
   - multi-turn via previous_interaction_id (server-side state)
   - system_instruction as a plain string
   - Gemini 3.x: temperature/top_p/top_k deprecated → thinking_level

   Browser-safety notes (verified 2026):
   - Use API version v1beta (v1beta2 404s)
   - Auth via ?key= query param — custom headers like Api-Revision
     make the browser preflight fail with 403 (CORS block)
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.gemini = (function () {
  'use strict';

  const API = 'https://generativelanguage.googleapis.com/v1beta';

  function apiKey() { return MYRAA.config.get('apiKey'); }
  function model() { return MYRAA.config.get('model'); }
  function visionModel() { return MYRAA.config.get('visionModel'); }

  function isConfigured() { return !!(apiKey() && apiKey().trim()); }

  // Gemini 3.x no longer accepts temperature/top_p/top_k — use thinking_level.
  function genConfigFor(m) {
    return /^gemini-3/.test(m || '') ? { thinking_level: 'low' } : undefined;
  }

  function apiUrl(stream) {
    // key as a query param — the only auth that survives the browser CORS preflight
    const k = encodeURIComponent(apiKey() || '');
    return `${API}/interactions?key=${k}` + (stream ? '&alt=sse' : '');
  }

  async function post(body, { stream, signal } = {}) {
    const res = await fetch(apiUrl(stream), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) await throwFriendly(res);
    return res;
  }

  /* ---------- non-streaming single turn (vision, memory mining) ---------- */
  async function generateText(payload) {
    const body = { model: payload.model || model(), input: payload.text || '' };
    if (payload.system) body.system_instruction = payload.system;
    if (payload.response_format) body.response_format = payload.response_format;
    const gc = genConfigFor(body.model);
    if (gc) body.generation_config = gc;

    const res = await post(body);
    const data = await res.json();
    return extractOutputText(data);
  }

  /* ---------- streaming chat ---------- */
  // Returns { text, id } — the interaction id is used for the next turn.
  async function streamChat({ system, input, previousInteractionId, onDelta, signal }) {
    try {
      return await streamChatOnce({ system, input, previousInteractionId, onDelta, signal });
    } catch (err) {
      // The server-side conversation can expire (free tier retains ~1 day).
      // If the previous interaction is gone, silently start a fresh one.
      if (previousInteractionId && /interaction|not ?found|invalid/i.test(err.message)) {
        return await streamChatOnce({ system, input, previousInteractionId: null, onDelta, signal });
      }
      throw err;
    }
  }

  async function streamChatOnce({ system, input, previousInteractionId, onDelta, signal }) {
    const body = { model: model(), input: input || '', stream: true };
    if (system) body.system_instruction = system;
    if (previousInteractionId) body.previous_interaction_id = previousInteractionId;
    const gc = genConfigFor(body.model);
    if (gc) body.generation_config = gc;

    const res = await post(body, { stream: true, signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let interactionId = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // accept SSE "data: {...}" lines and bare JSON lines (NDJSON) alike
        const json = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (!json || json === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(json); } catch (e) { continue; }
        if (!evt) continue;

        // live API sends "event_type"; docs also showed "type" — accept both
        const type = evt.event_type || evt.type || '';

        if (type === 'interaction.created' || type === 'interaction.completed') {
          if (evt.interaction && evt.interaction.id) interactionId = evt.interaction.id;
        } else if (type === 'step.delta' && evt.delta) {
          // only stream the final text, never model thoughts
          if (evt.delta.type === 'text' && typeof evt.delta.text === 'string' && evt.delta.text) {
            full += evt.delta.text;
            if (onDelta) onDelta(evt.delta.text);
          }
        } else if (type === 'error' && evt.error) {
          throw new Error(evt.error.message || 'Gemini streaming error');
        }
      }
    }
    return { text: full, id: interactionId };
  }

  /* ---------- vision (screen analysis) ---------- */
  async function vision({ text, imageBase64, mimeType }) {
    const input = [];
    if (text) input.push({ type: 'text', text });
    if (imageBase64) input.push({ type: 'image', mime_type: mimeType || 'image/jpeg', data: imageBase64 });
    if (!input.length) return '';

    const body = { model: visionModel(), input };
    const gc = genConfigFor(body.model);
    if (gc) body.generation_config = gc;

    const res = await post(body);
    const data = await res.json();
    return extractOutputText(data);
  }

  /* ---------- helpers ---------- */
  function extractOutputText(data) {
    if (!data || !Array.isArray(data.steps)) return '';
    let out = '';
    for (const step of data.steps) {
      if (step.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const item of step.content) {
        if (item && item.type === 'text' && typeof item.text === 'string') out += item.text;
      }
    }
    return out;
  }

  async function throwFriendly(res) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || JSON.stringify(j);
    } catch (e) { /* no body */ }
    const statusText = res.status === 400 ? 'Bad request (check the model name)'
      : res.status === 401 || res.status === 403 ? 'API key rejected'
      : res.status === 404 ? 'Not found — the model or endpoint may be wrong'
      : res.status === 429 ? 'Rate limit — wait a moment'
      : `HTTP ${res.status}`;
    throw new Error(`${statusText}${detail ? ': ' + detail : ''}`);
  }

  // Models available to new users on the Interactions API (2026).
  const MODELS = [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ];

  return { apiKey, model, visionModel, isConfigured, generateText, streamChat, vision, MODELS };
})();
