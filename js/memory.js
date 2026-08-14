/* ============================================================
   MYRAA — long-term memory system
   Remembers → Understands → Updates → Forgets → Retrieves → Uses.
   Stores durable facts about the user (not raw chat logs).
   Persisted in localStorage so memories survive across months.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.memory = (function () {
  'use strict';

  const MEM_KEY = 'myraa_memories';
  const CHAT_KEY = 'myraa_chatlog';
  const MAX_CHATLOG = 200;   // keep recent turns for context, not as "memory"

  /* ---------- storage ---------- */
  function loadMemories() {
    try { return JSON.parse(localStorage.getItem(MEM_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveMemories(list) { localStorage.setItem(MEM_KEY, JSON.stringify(list)); }

  function loadChatlog() {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveChatlog(list) {
    localStorage.setItem(CHAT_KEY, JSON.stringify(list.slice(-MAX_CHATLOG)));
  }

  /* ---------- extract: ask Gemini what matters ---------- */
  const EXTRACT_SYSTEM =
    'You are the memory system of an AI companion named Myraa. ' +
    'Read the conversation and extract only durable, useful facts about the USER: ' +
    'name, age, hobbies, favorite games/movies/creators, personality, goals, projects, ' +
    'fears, habits, relationships, preferences, life events. ' +
    'Do NOT store greetings, small talk, or one-off requests. ' +
    'Return ONLY valid JSON, no markdown, exactly: ' +
    '{"memories":[{"category":"identity|preference|relationship|goal|project|habit|life_event|other","content":"short fact about the user","importance":1..10}]} ' +
    'If nothing is worth remembering return {"memories":[]}.';

  async function extractMemories(messages) {
    const text = messages
      .map((m) => (m.role === 'user' ? 'USER: ' : 'MYRAA: ') + m.text)
      .join('\n');
    try {
      const raw = await MYRAA.gemini.generateText({
        system: EXTRACT_SYSTEM,
        text: 'Conversation:\n' + text,
        response_format: [{ type: 'text', mime_type: 'application/json' }],
      });
      const json = parseJsonLoose(raw);
      if (json && Array.isArray(json.memories)) {
        const added = updateMemories(json.memories);
        return added;
      }
    } catch (e) { console.warn('Memory extraction failed:', e); }
    return 0;
  }

  /* ---------- update / merge ---------- */
  function updateMemories(newMemories) {
    const store = loadMemories();
    let added = 0;
    for (const mem of newMemories) {
      if (!mem || !mem.content || typeof mem.content !== 'string') continue;
      const content = mem.content.trim().replace(/\s+/g, ' ');
      if (!content) continue;
      const importance = clamp(parseInt(mem.importance, 10) || 5, 1, 10);
      const category = sanitizeCategory(mem.category);
      const now = Date.now();

      const existing = findSimilar(store, content);
      if (existing) {
        existing.content = mergeText(existing.content, content);
        existing.importance = Math.max(existing.importance, importance);
        existing.lastSeen = now;
        existing.count = (existing.count || 1) + 1;
      } else {
        store.push({
          id: 'm' + now.toString(36) + Math.random().toString(36).slice(2, 6),
          category, content, importance, firstSeen: now, lastSeen: now, count: 1,
        });
        added++;
      }
    }
    // forget: drop stale, low-value memories (older than 180 days and seen once)
    const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
    const pruned = store.filter((m) => !(m.lastSeen < cutoff && (m.count || 1) === 1 && m.importance < 4));
    saveMemories(pruned);
    return added;
  }

  function findSimilar(store, content) {
    const words = new Set(content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    if (!words.size) return null;
    let best = null, bestScore = 0;
    for (const m of store) {
      const mw = new Set(m.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      let overlap = 0;
      for (const w of words) if (mw.has(w)) overlap++;
      const score = overlap / Math.sqrt(words.size * Math.max(mw.size, 1));
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return bestScore >= 0.55 ? best : null;
  }

  function mergeText(a, b) {
    // keep the richer, more complete phrasing
    return b.length > a.length ? b : a;
  }

  /* ---------- retrieve ---------- */
  function retrieveMemories(query, limit) {
    const store = loadMemories();
    const q = (query || '').toLowerCase();
    const qWords = new Set(q.split(/\W+/).filter((w) => w.length > 2));
    const now = Date.now();
    const scored = store.map((m) => {
      let score = m.importance * 0.6;
      // recency: last 30 days strong
      const days = (now - m.lastSeen) / 86400000;
      score += Math.max(0, 2.5 - days / 30);
      // frequency
      score += Math.min(1.5, (m.count || 1) * 0.3);
      // keyword match against the current topic
      if (qWords.size) {
        const mw = new Set(m.content.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
        let overlap = 0;
        for (const w of qWords) if (mw.has(w)) overlap++;
        score += overlap * 2.2;
      }
      return { m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit || 8).map((s) => s.m);
  }

  function listMemories() { return loadMemories().slice().sort((a, b) => b.importance - a.importance); }

  function deleteMemory(id) { saveMemories(loadMemories().filter((m) => m.id !== id)); }

  function clearMemories() { localStorage.removeItem(MEM_KEY); }

  function clearChatlog() { localStorage.removeItem(CHAT_KEY); }

  /* ---------- helpers ---------- */
  function parseJsonLoose(raw) {
    try { return JSON.parse(raw); } catch (e) { }
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { } }
    return null;
  }
  function sanitizeCategory(c) {
    const ok = ['identity', 'preference', 'relationship', 'goal', 'project', 'habit', 'life_event', 'other'];
    return ok.includes(c) ? c : 'other';
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

  return {
    loadMemories, saveMemories, loadChatlog, saveChatlog,
    extractMemories, updateMemories, retrieveMemories, listMemories,
    deleteMemory, clearMemories, clearChatlog, fmtDate,
  };
})();
