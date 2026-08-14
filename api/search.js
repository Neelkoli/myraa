/* ============================================================
   Vercel serverless function — full web search proxy
   DuckDuckGo's search page can't be called from the browser
   (CORS) nor embedded (frame busting), so this function fetches
   the HTML results server-side and returns clean JSON.
   No API key required.
   ============================================================ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseResults(html, max) {
  const results = [];
  // Each result block starts with <div class="result results_links ...
  const blocks = html.split('<div class="result results_links');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
    if (!a) continue;
    let href = a[1];
    if (href.indexOf('/l/?uddg=') !== -1) {
      try {
        href = decodeURIComponent(href.split('uddg=')[1].split('&')[0]);
      } catch (e) { /* keep raw href */ }
    }
    const title = decodeEntities(a[2].replace(/<[^>]+>/g, ''));
    const sn = b.match(/class="result__snippet"[^>]*>(.*?)<\/a>/s);
    const snippet = sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')) : '';
    results.push({ title, url: href, snippet: snippet.slice(0, 300) });
    if (results.length >= max) break;
  }
  return results;
}

export default async function handler(req, res) {
  // Only GET is meaningful here
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url, 'https://placeholder.invalid');
  const q = (url.searchParams.get('q') || '').trim();
  const max = Math.min(parseInt(url.searchParams.get('max') || '10', 10) || 10, 20);
  if (!q) {
    res.status(400).json({ error: 'missing query parameter q' });
    return;
  }
  try {
    const r = await fetch(
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
      {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (!r.ok) {
      res.status(502).json({ error: 'upstream search failed (' + r.status + ')' });
      return;
    }
    const html = await r.text();
    const results = parseResults(html, max);
    if (!results.length) {
      res.status(200).json({ query: q, results: [], empty: true });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ query: q, results });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
