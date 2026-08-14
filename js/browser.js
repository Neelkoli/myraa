/* ============================================================
   MYRAA — integrated web browser
   Real tabs, address bar, back/forward/refresh/home, history and
   an embeddable YouTube player for "play <song/video>" commands.
   Note: websites decide whether they allow being framed. For sites
   that block embedding (Google, Facebook, Twitter, Gmail, ...) the
   panel shows an "Open externally" action, so nothing is a dead end.
   ============================================================ */
window.MYRAA = window.MYRAA || {};

MYRAA.browser = (function () {
  'use strict';

  let tabs = [];            // {id, title, url, history[], idx}
  let activeId = null;
  let nextId = 1;

  // Local start page — always loads, looks native, and can talk to Myraa.
  const HOME = startPageUrl();
  const YT_EMBED = 'https://www.youtube-nocookie.com/embed/';
  const YT_SEARCH_EMBED = 'https://www.youtube.com/embed?listType=search&list=';

  // Sites that almost always refuse to be embedded in an iframe
  const KNOWN_BLOCKERS = [
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'reddit.com', 'wikipedia.org', 'gmail.com', 'netflix.com', 'amazon.com', 'chatgpt.com',
    'openai.com', 'whatsapp.com', 'discord.com', 'twitch.tv', 'linkedin.com', 'pinterest.com',
    'duckduckgo.com', 'bing.com', 'yahoo.com',
  ];

  /* ---------- local start page ---------- */
  function startPageUrl() {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
      body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#ede9ff;background:radial-gradient(700px 400px at 50% 0%,#241543 0%,transparent 60%),linear-gradient(160deg,#07040f,#120b26)}
      h1{font-size:34px;letter-spacing:.3em;background:linear-gradient(100deg,#a78bfa,#f0abfc,#67e8f9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:800}
      .tag{color:rgba(237,233,255,.5);font-size:12px;letter-spacing:.25em;text-transform:uppercase;margin-bottom:14px}
      .box{width:min(480px,86vw);padding:16px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.06);backdrop-filter:blur(14px)}
      input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);color:#ede9ff;font-size:14px;outline:none}
      .links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
      a{color:#c4b5fd;text-decoration:none;font-size:13px;padding:8px 14px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.05)}
      a:hover{background:rgba(167,139,250,.25)}
      .hint{color:rgba(237,233,255,.4);font-size:11px;max-width:440px;text-align:center;line-height:1.6}
    </style></head><body>
      <div><h1>HIYUKI</h1><div class="tag">browser</div></div>
      <div class="box"><input id="q" placeholder="Search or type a web address…" autofocus></div>
      <div class="links">
        <a href="https://example.com">Example</a>
        <a href="https://openstreetmap.org">OpenStreetMap</a>
        <a href="https://archive.org">Archive.org</a>
        <a href="https://www.openstreetmap.org/export/embed.html?bbox=-0.2,51.4,0.2,51.6">Map</a>
      </div>
      <div class="hint">Sites that refuse to be embedded (Google, YouTube, Wikipedia…) can be opened externally with the ↗ button in the address bar. Try saying "play Naruto opening" in the chat!</div>
      <script>
        const q=document.getElementById('q');
        const go=()=>{const v=q.value.trim();if(v)window.parent.postMessage({type:'myraa-navigate',value:v},'*')};
        q.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
        document.body.addEventListener('click',e=>{if(e.target.tagName==='A'&&e.target.href){} });
      <\/script>
    </body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  /* ---------- helpers ---------- */
  function normalizeUrl(input) {
    let s = (input || '').trim();
    if (!s) return null;
    if (s.indexOf(' ') === -1 && !/^https?:\/\//i.test(s)) {
      if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) s = 'https://' + s;
    }
    return s;
  }

  function isYoutubeWatchUrl(u) {
    return /(^|\.)youtube\.com\/watch\?v=|youtu\.be\//i.test(u);
  }

  function youtubeIdFromUrl(u) {
    const m = u.match(/[?&]v=([\w-]{6,})/) || u.match(/youtu\.be\/([\w-]{6,})/);
    return m ? m[1] : null;
  }

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function isBlocker(u) {
    const h = hostOf(u);
    return KNOWN_BLOCKERS.some((b) => h === b || h.endsWith('.' + b));
  }

  /* ---------- parsing voice/text commands ---------- */
  const KNOWN_SITES = {
    youtube: 'youtube.com', yt: 'youtube.com',
    gmail: 'mail.google.com', gmailcom: 'mail.google.com',
    chatgpt: 'chatgpt.com', 'chat gpt': 'chatgpt.com', openai: 'openai.com',
    google: 'google.com', github: 'github.com', 'stack overflow': 'stackoverflow.com',
    instagram: 'instagram.com', facebook: 'facebook.com', twitter: 'x.com', x: 'x.com',
    reddit: 'reddit.com', netflix: 'netflix.com', amazon: 'amazon.com', whatsapp: 'web.whatsapp.com',
    discord: 'discord.com', twitch: 'twitch.tv', linkedin: 'linkedin.com',
    wikipedia: 'wikipedia.org', bing: 'bing.com', yahoo: 'yahoo.com',
    example: 'example.com', 'my channel': 'youtube.com',
  };

  function isUrlLike(s) {
    return /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s);
  }

  function knownSite(rest) {
    const key = rest.trim().toLowerCase().replace(/\s+/g, ' ');
    return KNOWN_SITES[key] || null;
  }

  // returns {type:'url'|'search'|'youtube'|'youtubeSearch', value}
  function parseCommand(text) {
    const t = (text || '').trim();
    const lower = t.toLowerCase();

    if (/^(open|go to|take me to|navigate to)\s+(youtube|yt)$/i.test(lower)) {
      return { type: 'youtube', value: '' };
    }
    if (/^play\s+/i.test(lower)) {
      const rest = t.replace(/^play\s+/i, '').replace(/\s+on\s+(youtube|yt)\s*$/i, '');
      return { type: 'youtubeSearch', value: rest };
    }
    if (/^(search|look up|find)\s+/i.test(lower)) {
      const rest = t.replace(/^(search|look up|find)\s+/i, '');
      if (/on\s+(youtube|yt)\s*$/i.test(rest)) {
        return { type: 'youtubeSearch', value: rest.replace(/\s+on\s+(youtube|yt)\s*$/i, '') };
      }
      return { type: 'search', value: rest };
    }
    if (/^(open|go to|take me to|navigate to)\s+/i.test(lower)) {
      const rest = t.replace(/^(open|go to|take me to|navigate to)\s+/i, '');
      const site = knownSite(rest);
      if (site) return { type: 'url', value: site };
      if (isUrlLike(rest)) return { type: 'url', value: rest };
      return { type: 'search', value: rest };
    }
    // bare URL
    if (isUrlLike(t)) return { type: 'url', value: t };
    return { type: 'search', value: t };
  }

  function resolveCommand(cmd) {
    switch (cmd.type) {
      case 'url': {
        const u = normalizeUrl(cmd.value);
        return u ? { url: u } : null;
      }
      case 'search':
        return { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(cmd.value) };
      case 'youtube':
        return { url: 'https://www.youtube.com/', special: 'youtube' };
      case 'youtubeSearch':
        return { url: YT_SEARCH_EMBED + encodeURIComponent(cmd.value), title: 'YouTube: ' + cmd.value, special: 'youtube' };
      default:
        return null;
    }
  }

  /* ---------- tab management ---------- */
  function currentTab() { return tabs.find((t) => t.id === activeId) || null; }

  function createTab(url, opts) {
    const id = nextId++;
    const tab = { id, title: opts && opts.title ? opts.title : 'New tab', url: '', history: [], idx: -1 };
    tabs.push(tab);
    activeId = id;
    renderTabs();
    if (url) navigate(tab, url, opts);
    else navigate(tab, HOME);
    updateAddressBar();
    return tab;
  }

  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    tabs.splice(i, 1);
    if (tabs.length === 0) { createTab(HOME); return; }
    if (activeId === id) {
      activeId = tabs[Math.max(0, i - 1)].id;
      const t = currentTab();
      setIframe(t.url || 'about:blank');
      updateAddressBar();
    }
    renderTabs();
  }

  function switchTab(id) {
    closeSearch();
    activeId = id;
    const t = currentTab();
    setIframe(t.url || 'about:blank');
    renderTabs();
    updateAddressBar();
  }

  function renderTabs() {
    const bar = document.getElementById('browserTabs');
    if (!bar) return;
    bar.innerHTML = '';
    tabs.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'browser-tab' + (t.id === activeId ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'browser-tab-title';
      title.textContent = t.title || 'New tab';
      title.addEventListener('click', () => switchTab(t.id));
      const close = document.createElement('span');
      close.className = 'browser-tab-close';
      close.textContent = '×';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
      el.appendChild(title);
      el.appendChild(close);
      bar.appendChild(el);
    });
  }

  /* ---------- navigation ---------- */
  function setIframe(url) {
    const frame = document.getElementById('browserFrame');
    if (!frame) return;
    frame.src = url;
    setLoading(true);
  }

  function setLoading(on) {
    const el = document.getElementById('browserLoading');
    if (el) el.style.display = on ? 'block' : 'none';
  }

  function navigate(tab, url, opts) {
    closeSearch();
    tab.url = url;
    if (tab.idx < tab.history.length - 1) tab.history = tab.history.slice(0, tab.idx + 1);
    tab.history.push(url);
    tab.idx = tab.history.length - 1;

    const title = opts && opts.title ? opts.title : titleFor(url);
    tab.title = title;

    // YouTube watch links play inside the embed player
    if (isYoutubeWatchUrl(url)) {
      const id = youtubeIdFromUrl(url);
      if (id) { tab.url = YT_EMBED + id; tab.title = 'YouTube'; }
    }

    setIframe(tab.url);
    pushGlobalHistory(url);
    renderTabs();
    updateAddressBar();
    updateBlockStrip(url);
  }

  function titleFor(url) {
    const h = hostOf(url);
    if (isYoutubeWatchUrl(url)) return 'YouTube';
    return h || 'Page';
  }

  function goBack() {
    closeSearch();
    const t = currentTab();
    if (!t || t.idx <= 0) return;
    t.idx--;
    t.url = t.history[t.idx];
    setIframe(t.url);
    updateAddressBar();
    updateBlockStrip(t.url);
  }
  function goForward() {
    closeSearch();
    const t = currentTab();
    if (!t || t.idx >= t.history.length - 1) return;
    t.idx++;
    t.url = t.history[t.idx];
    setIframe(t.url);
    updateAddressBar();
    updateBlockStrip(t.url);
  }
  function reload() {
    closeSearch();
    const t = currentTab();
    if (!t || !t.url) return;
    setIframe(t.url);
    setLoading(true);
  }
  function goHome() {
    const t = currentTab();
    if (!t) return;
    navigate(t, HOME);
  }

  function openAddress(raw) {
    const t = currentTab();
    if (!t) return;
    const value = (raw || '').trim();
    if (!value || value === 'search the web…') return;   // placeholder, not a real query
    const cmd = parseCommand(value);
    if (cmd.type === 'search') { showSearch(cmd.value); return; }
    const resolved = resolveCommand(cmd);
    if (!resolved) { MYRAA.ui && MYRAA.ui.toast('Could not open that.', 'error'); return; }
    navigate(t, resolved.url, { title: resolved.title, special: resolved.special });
  }

  function openExternal() {
    const t = currentTab();
    if (!t || !t.url) return;
    let url = t.url;
    // unwrap youtube embed for external open
    if (url.indexOf(YT_EMBED) === 0) {
      const id = url.slice(YT_EMBED.length).split(/[?#]/)[0];
      url = 'https://www.youtube.com/watch?v=' + id;
    }
    if (url.indexOf(YT_SEARCH_EMBED) === 0) {
      const q = decodeURIComponent(url.split('list=')[1] || '');
      url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    }
    window.open(url, '_blank');
  }

  function updateAddressBar() {
    const t = currentTab();
    const input = document.getElementById('browserAddress');
    if (input && t) input.value = t.url === HOME ? 'search the web…' : t.url;
  }

  function updateBlockStrip(url) {
    const strip = document.getElementById('browserBlockedStrip');
    if (!strip) return;
    // YouTube's embed player is embeddable — don't flag it
    const isYouTubeEmbed = /youtube(-nocookie)?\.com\/embed/.test(url);
    if (!isYouTubeEmbed && isBlocker(url)) {
      strip.style.display = 'flex';
      strip.querySelector('.blocked-host').textContent = hostOf(url);
    } else {
      strip.style.display = 'none';
    }
  }

  /* ---------- history ---------- */
  function pushGlobalHistory(url) {
    try {
      const h = JSON.parse(localStorage.getItem('myraa_browser_history')) || [];
      if (h[h.length - 1] !== url) {
        h.push({ url, ts: Date.now() });
        localStorage.setItem('myraa_browser_history', JSON.stringify(h.slice(-100)));
      }
    } catch (e) { /* noop */ }
  }

  /* ---------- in-app search (DuckDuckGo HTML can't be framed) ---------- */
  const SEARCH_TABS = ['web', 'news', 'videos', 'maps'];
  const SEARCH_TAB_LABELS = { web: 'Web', news: 'News', videos: 'Videos', maps: 'Maps' };
  let activeSearchTab = 'web';
  let currentSearchQuery = '';
  let searchPlayable = false;
  // Bumped on every view reset; async renderers check it so a slow fetch
  // from a previous tab can't paint into the newly active tab.
  let searchEpoch = 0;

  // Heuristic: a short query without question/news words is probably a song
  // or video title, so offer "Play on YouTube".
  const MEDIA_STOP = /\b(how|what|why|when|where|who|which|is|are|am|do|does|did|the|a|an|and|or|of|for|to|in|on|at|with|best|top|meaning|definition|review|tutorial|guide|recipe|vs|versus|near|weather|news|today|latest|now|open|closed|history|science|food|health|travel|money|definition)\b/i;
  function looksLikeMedia(q) {
    const s = (q || '').trim();
    return s.length >= 3 && s.length <= 60 && !MEDIA_STOP.test(s);
  }

  function playOnYouTube(q) {
    const tab = currentTab();
    if (!tab || !q) return;
    closeSearch();
    navigate(tab, YT_SEARCH_EMBED + encodeURIComponent(q), { title: 'YouTube: ' + q, special: 'youtube' });
  }

  function rememberSearch(q) {
    try {
      let h = JSON.parse(localStorage.getItem('myraa_search_history')) || [];
      h = h.filter((x) => x.q.toLowerCase() !== q.toLowerCase());
      h.unshift({ q, ts: Date.now() });
      localStorage.setItem('myraa_search_history', JSON.stringify(h.slice(0, 30)));
    } catch (e) { /* noop */ }
  }

  function showSearch(query) {
    const q = (query || '').trim();
    if (!q) return;
    const overlay = document.getElementById('browserSearch');
    if (!overlay) return;
    currentSearchQuery = q;
    searchPlayable = looksLikeMedia(q);
    const qEl = document.getElementById('searchQuery');
    const ext = document.getElementById('searchExternal');
    const playBtn = document.getElementById('searchPlay');
    if (qEl) qEl.textContent = q;
    if (ext) ext.href = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    if (playBtn) playBtn.style.display = searchPlayable ? 'inline-block' : 'none';
    activeSearchTab = 'web';
    renderSearchTabs();
    clearSearchResults();
    const head = document.getElementById('searchResultsHead');
    if (head) head.style.display = 'block';
    overlay.style.display = 'flex';
    const strip = document.getElementById('browserBlockedStrip');
    if (strip) strip.style.display = 'none';
    setLoading(false);
    rememberSearch(q);
    runSearch(q);
  }

  function closeSearch() {
    const overlay = document.getElementById('browserSearch');
    if (overlay) overlay.style.display = 'none';
  }

  function clearSearchResults() {
    searchEpoch++;
    const instant = document.getElementById('searchInstant');
    const results = document.getElementById('searchResults');
    const status = document.getElementById('searchStatus');
    if (instant) instant.innerHTML = '';
    if (results) results.innerHTML = '';
    if (status) status.textContent = '';
  }

  function renderSearchTabs() {
    const bar = document.getElementById('searchTabs');
    if (!bar) return;
    bar.innerHTML = '';
    SEARCH_TABS.forEach((t) => {
      const el = document.createElement('button');
      el.className = 'search-tab' + (t === activeSearchTab ? ' active' : '');
      el.textContent = SEARCH_TAB_LABELS[t];
      el.addEventListener('click', () => activateSearchTab(t));
      bar.appendChild(el);
    });
  }

  function activateSearchTab(t) {
    activeSearchTab = t;
    renderSearchTabs();
    clearSearchResults();
    const head = document.getElementById('searchResultsHead');
    if (head) head.style.display = (t === 'videos' || t === 'maps') ? 'none' : 'block';
    if (t === 'web') runSearch(currentSearchQuery);
    else if (t === 'news') runNewsSearch(currentSearchQuery);
    else if (t === 'videos') runVideoSearch(currentSearchQuery);
    else if (t === 'maps') runMapSearch(currentSearchQuery);
  }

  /* ---- Web: full results via Vercel proxy, falling back to instant answers ---- */
  async function runSearch(q) {
    const epoch = searchEpoch;
    const status = document.getElementById('searchStatus');
    if (status) status.textContent = 'Searching…';
    // Full web results come from /api/search (Vercel serverless). On localhost
    // that endpoint doesn't exist, so we fall back to the CORS-open APIs below.
    const proxied = await tryWebProxy(q, epoch);
    if (proxied) {
      if (status && epoch === searchEpoch) status.textContent = '';
      return;
    }
    const enc = encodeURIComponent(q);
    // DuckDuckGo instant answers (no key, CORS open)
    fetch('https://api.duckduckgo.com/?q=' + enc + '&format=json&no_html=1&skip_disambig=1')
      .then((r) => r.json())
      .then((data) => { if (epoch === searchEpoch) renderInstant(data); })
      .catch(() => {});
    // Wikipedia article search (no key, CORS via origin=*)
    await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + enc +
      '&format=json&origin=*&srlimit=10')
      .then((r) => r.json())
      .then((data) => { if (epoch === searchEpoch) renderWiki(data); })
      .catch(() => {});
    if (epoch !== searchEpoch) return;
    const instant = document.getElementById('searchInstant');
    const results = document.getElementById('searchResults');
    const has = (instant && instant.children.length) || (results && results.children.length);
    if (status && !has) {
      status.textContent = 'No results here — try a different search, or open DuckDuckGo externally below.';
    } else if (status) {
      status.textContent = '';
    }
  }

  async function tryWebProxy(q, epoch) {
    const results = document.getElementById('searchResults');
    if (!results) return false;
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&max=12');
      if (!res.ok) return false;
      const data = await res.json();
      const list = (data && data.results) || [];
      if (!list.length) return false;
      if (epoch !== searchEpoch) return true;   // stale — discard silently
      list.forEach((r) => {
        results.appendChild(buildCard({
          source: 'Web', title: r.title, snippet: r.snippet, url: r.url, icon: '🌐',
        }));
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---- News: Hacker News Algolia (no key, CORS open) ---- */
  async function runNewsSearch(q) {
    const epoch = searchEpoch;
    const status = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
    if (status) status.textContent = 'Searching news…';
    try {
      const res = await fetch('https://hn.algolia.com/api/v1/search?query=' +
        encodeURIComponent(q) + '&tags=story&hitsPerPage=12');
      const data = await res.json();
      const hits = (data && data.hits) || [];
      if (epoch !== searchEpoch) return;
      if (!hits.length) {
        if (status) status.textContent = 'No news found for that — try the Web tab.';
        return;
      }
      hits.forEach((h) => {
        const url = h.url || ('https://news.ycombinator.com/item?id=' + h.objectID);
        const snippet = decodeEntities((h.story_text || h.title || '').replace(/<[^>]+>/g, '')).slice(0, 200);
        results.appendChild(buildCard({
          source: 'Hacker News', title: h.title || 'Hacker News', snippet, url, icon: '📰',
        }));
      });
      if (status) status.textContent = '';
    } catch (e) {
      if (epoch === searchEpoch && status) status.textContent = 'News search unavailable — try the Web tab.';
    }
  }

  /* ---- Videos: Wikimedia Commons video files (MediaWiki API, no key, CORS open) ---- */
  async function runVideoSearch(q) {
    const epoch = searchEpoch;
    const status = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
    if (status) status.textContent = 'Searching videos…';
    try {
      const res = await fetch('https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=' +
        encodeURIComponent(q + ' filetype:video') + '&srnamespace=6&format=json&origin=*&srlimit=8');
      const data = await res.json();
      if (epoch !== searchEpoch) return;
      const list = (data.query && data.query.search) || [];
      if (!list.length) {
        // Commons has little copyrighted media — hand the query to YouTube
        const panel = document.createElement('div');
        panel.className = 'search-videos-empty';
        const txt = document.createElement('div');
        txt.textContent = 'No open-archive videos matched, but YouTube almost certainly has it:';
        const btn = document.createElement('button');
        btn.className = 'search-videos-btn';
        btn.textContent = '▶ Play “' + q.slice(0, 28) + '” on YouTube';
        btn.addEventListener('click', () => playOnYouTube(q));
        panel.appendChild(txt);
        panel.appendChild(btn);
        results.appendChild(panel);
        if (status) status.textContent = '';
        return;
      }
      // Second call: resolve each file to its watch page + direct URL
      const meta = await fetch('https://commons.wikimedia.org/w/api.php?action=query&titles=' +
        encodeURIComponent(list.map((s) => s.title).join('|')) +
        '&prop=imageinfo&iiprop=url&format=json&origin=*');
      const metaData = await meta.json();
      if (epoch !== searchEpoch) return;
      const pages = (metaData.query && metaData.query.pages) || {};
      list.forEach((s) => {
        const page = pages[s.title] || Object.values(pages).find((x) => x.title === s.title) || {};
        const info = (page.imageinfo && page.imageinfo[0]) || {};
        const pageUrl = info.descriptionurl ||
          'https://commons.wikimedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_'));
        const title = s.title.replace(/^File:/, '').replace(/\.(webm|mp4|ogv|mpg|mpeg|avi|mov)$/i, '');
        results.appendChild(buildCard({
          source: 'Video', title: title.slice(0, 80),
          snippet: 'Video file on Wikimedia Commons — click to watch',
          url: pageUrl, icon: '🎬',
        }));
      });
      // Still offer the full YouTube experience for the query
      const btn = document.createElement('button');
      btn.className = 'search-videos-btn';
      btn.textContent = '▶ See “' + q.slice(0, 28) + '” on YouTube';
      btn.addEventListener('click', () => playOnYouTube(q));
      results.appendChild(btn);
      if (status) status.textContent = '';
    } catch (e) {
      const panel = document.createElement('div');
      panel.className = 'search-videos-empty';
      const txt = document.createElement('div');
      txt.textContent = 'Video search hiccuped — try YouTube directly:';
      const btn = document.createElement('button');
      btn.className = 'search-videos-btn';
      btn.textContent = '▶ Play “' + q.slice(0, 28) + '” on YouTube';
      btn.addEventListener('click', () => playOnYouTube(q));
      panel.appendChild(txt);
      panel.appendChild(btn);
      results.appendChild(panel);
      if (status) status.textContent = '';
    }
  }

  /* ---- Maps: Nominatim places + OpenStreetMap embed (no key, CORS open) ---- */
  async function runMapSearch(q) {
    const epoch = searchEpoch;
    const status = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
    if (status) status.textContent = 'Finding places…';
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?q=' +
        encodeURIComponent(q) + '&format=json&limit=5');
      const places = await res.json();
      if (epoch !== searchEpoch) return;
      if (!places.length) {
        if (status) status.textContent = 'No places found for that — try the Web tab.';
        return;
      }
      const p = places[0];
      const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
      const d = 0.02;
      const frame = document.createElement('iframe');
      frame.className = 'search-media-frame';
      frame.loading = 'lazy';
      frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' +
        (lon - d) + ',' + (lat - d) + ',' + (lon + d) + ',' + (lat + d) +
        '&layer=mapnik&marker=' + lat + ',' + lon;
      results.appendChild(frame);
      places.forEach((pl) => {
        results.appendChild(buildCard({
          source: 'OpenStreetMap', title: pl.display_name.slice(0, 80),
          snippet: pl.display_name, icon: '🗺️',
          url: 'https://www.openstreetmap.org/?mlat=' + pl.lat + '&mlon=' + pl.lon +
            '#map=16/' + pl.lat + '/' + pl.lon,
        }));
      });
      if (status) status.textContent = '';
    } catch (e) {
      if (status) status.textContent = 'Map search unavailable — try the Web tab.';
    }
  }

  function renderInstant(data) {
    if (!data) return;
    const box = document.getElementById('searchInstant');
    if (!box) return;
    if (data.AbstractText && data.AbstractURL) {
      box.appendChild(buildCard({
        source: 'DuckDuckGo', title: data.Heading || data.AbstractText.slice(0, 70),
        snippet: decodeEntities(data.AbstractText), url: data.AbstractURL, icon: '🦆',
      }));
    }
    const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    topics.slice(0, 6).forEach((t) => {
      if (t.Topics) { t.Topics.slice(0, 3).forEach((x) => push(x)); } else { push(t); }
    });
    function push(x) {
      if (x.FirstURL && x.Text) {
        box.appendChild(buildCard({
          source: 'DuckDuckGo', title: x.Text.slice(0, 90), snippet: decodeEntities(x.Text), url: x.FirstURL, icon: '🦆',
        }));
      }
    }
  }

  function decodeEntities(s) {
    return (s || '')
      .replace(/&amp;/g, '&')
      .replace(/&#?0?39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  function renderWiki(data) {
    const list = (data.query && data.query.search) || [];
    const results = document.getElementById('searchResults');
    if (!results) return;
    list.forEach((s) => {
      const title = s.title;
      const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
      const snippet = decodeEntities((s.snippet || '').replace(/<[^>]+>/g, ''));
      results.appendChild(buildCard({ source: 'Wikipedia', title, snippet, url, icon: '📚' }));
    });
  }

  function buildCard({ source, title, snippet, url, icon }) {
    const card = document.createElement('div');
    card.className = 'search-card';
    const top = document.createElement('div');
    top.className = 'search-card-top';
    const src = document.createElement('span');
    src.className = 'search-src';
    src.textContent = icon + ' ' + source;
    const btns = document.createElement('div');
    btns.className = 'search-card-btns';
    if (searchPlayable) {
      const play = document.createElement('button');
      play.className = 'search-play';
      play.textContent = '▶ Play';
      play.title = 'Play this on YouTube';
      play.addEventListener('click', (e) => { e.stopPropagation(); playOnYouTube(title); });
      btns.appendChild(play);
    }
    const ext = document.createElement('button');
    ext.className = 'search-ext';
    ext.textContent = '↗';
    ext.title = 'Open in new browser tab';
    ext.addEventListener('click', (e) => { e.stopPropagation(); window.open(url, '_blank'); });
    btns.appendChild(ext);
    top.appendChild(src);
    top.appendChild(btns);
    const t = document.createElement('div');
    t.className = 'search-title';
    t.textContent = title;
    const sn = document.createElement('div');
    sn.className = 'search-snippet';
    sn.textContent = snippet;
    const host = document.createElement('div');
    host.className = 'search-host';
    try { host.textContent = new URL(url).hostname; } catch (e) { host.textContent = url; }
    card.appendChild(top); card.appendChild(t); card.appendChild(sn); card.appendChild(host);
    card.addEventListener('click', () => {
      const tab = currentTab();
      if (tab) navigate(tab, url);
    });
    return card;
  }

  function showHistory() {
    const list = document.getElementById('browserHistoryList');
    const overlay = document.getElementById('browserHistory');
    if (!list || !overlay) return;
    list.innerHTML = '';
    // Recent in-app searches, always handy to revisit
    let searches = [];
    try { searches = JSON.parse(localStorage.getItem('myraa_search_history')) || []; } catch (e) { }
    if (searches.length) {
      const head = document.createElement('div');
      head.className = 'history-head-small';
      head.textContent = 'Recent searches';
      list.appendChild(head);
      const wrap = document.createElement('div');
      wrap.className = 'history-search-chips';
      searches.slice(0, 15).forEach((s) => {
        const chip = document.createElement('button');
        chip.className = 'history-chip';
        chip.textContent = s.q;
        chip.addEventListener('click', () => {
          overlay.style.display = 'none';
          openPanel();
          if (!currentTab()) createTab();
          showSearch(s.q);
        });
        wrap.appendChild(chip);
      });
      list.appendChild(wrap);
    }
    // Browsed URL history
    let h = [];
    try { h = JSON.parse(localStorage.getItem('myraa_browser_history')) || []; } catch (e) { }
    h.slice().reverse().forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.textContent = item.url;
      el.title = item.url;
      el.addEventListener('click', () => {
        overlay.style.display = 'none';
        const t = currentTab();
        if (t) navigate(t, item.url);
      });
      list.appendChild(el);
    });
    overlay.style.display = 'flex';
  }

  /* ---------- frame load feedback ---------- */
  function bindFrameEvents() {
    const frame = document.getElementById('browserFrame');
    if (!frame) return;
    frame.addEventListener('load', () => {
      setLoading(false);
      const t = currentTab();
      if (t) {
        t.title = titleFor(t.url);
        renderTabs();
        updateAddressBar();
      }
    });
  }

  /* ---------- open from chat ---------- */
  function openFromText(text) {
    const cmd = parseCommand(text);
    if (cmd.type === 'search') {
      openPanel();
      createTab();
      showSearch(cmd.value);
      return true;
    }
    const resolved = resolveCommand(cmd);
    if (!resolved) return false;
    openPanel();
    createTab(resolved.url, { title: resolved.title, special: resolved.special });
    return true;
  }

  function openPanel() {
    const p = document.getElementById('browserPanel');
    if (p) p.classList.add('open');
  }
  function closePanel() {
    const p = document.getElementById('browserPanel');
    if (p) p.classList.remove('open');
  }

  function init() {
    bindFrameEvents();
    createTab();
    const input = document.getElementById('browserAddress');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { openAddress(input.value); }
      });
    }
    const closeBtn = document.getElementById('searchClose');
    if (closeBtn) closeBtn.addEventListener('click', closeSearch);
    const playBtn = document.getElementById('searchPlay');
    if (playBtn) playBtn.addEventListener('click', () => playOnYouTube(currentSearchQuery));
    // start page talks to Myraa
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'myraa-navigate' && typeof e.data.value === 'string') {
        openAddress(e.data.value);
      }
    });
  }

  return { init, openFromText, openAddress, openPanel, closePanel, createTab, parseCommand, showHistory };
})();
