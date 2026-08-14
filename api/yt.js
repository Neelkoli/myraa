/* ============================================================
   Vercel serverless function — resolve a query to a real YouTube
   video ID (no API key). Used by "play <song/video>" commands so
   the app can open the official, bulletproof single-video embed
   instead of the search-list player.

   Sources tried in order:
     1. YouTube search results HTML  (ytInitialData "videoId")
     2. Bing video search            (watch?v= links)
   ============================================================ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* First distinct 11-char videoId from YouTube search results. */
async function videoIdFromYoutube(q) {
  const r = await fetch(
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&hl=en',
    { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }
  );
  if (!r.ok) return null;
  const html = await r.text();
  const seen = [];
  const re = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = re.exec(html)) !== null && seen.length < 3) {
    if (seen.indexOf(m[1]) === -1) seen.push(m[1]);
  }
  return seen[0] || null;
}

/* First YouTube watch ID from Bing's video results. */
async function videoIdFromBing(q) {
  const r = await fetch(
    'https://www.bing.com/videos/search?q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': UA } }
  );
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/watch\?v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url, 'https://placeholder.invalid');
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    res.status(400).json({ error: 'missing query parameter q' });
    return;
  }

  let id = null;
  let source = null;
  try {
    id = await videoIdFromYoutube(q);
    if (id) source = 'youtube';
  } catch (e) { /* try next */ }
  if (!id) {
    try {
      id = await videoIdFromBing(q);
      if (id) source = 'bing';
    } catch (e) { /* give up */ }
  }

  if (!id) {
    res.status(200).json({ q, id: null, empty: true });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ q, id, source });
}
