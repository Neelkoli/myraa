/* ============================================================
   Vercel serverless function — full web search proxy
   Search engines refuse CORS calls from the browser and often
   block datacenter IPs, so this function tries a chain of
   no-key sources server-side and returns clean JSON:
     1. Bing RSS      (https://www.bing.com/search?q=X&format=rss)
     2. DuckDuckGo HTML (https://html.duckduckgo.com/html/?q=X)
     3. DuckDuckGo lite  (https://lite.duckduckgo.com/lite/?q=X)
   ============================================================ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#?0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/* ---------- source 1: Bing RSS ---------- */
function parseBingRss(xml, max) {
  const results = [];
  const items = xml.split('<item>').slice(1);
  for (const item of items) {
    const t = item.match(/<title>(.*?)<\/title>/s);
    const l = item.match(/<link>(.*?)<\/link>/s);
    const d = item.match(/<description>(.*?)<\/description>/s);
    if (!t || !l) continue;
    const title = decodeEntities(t[1].replace(/<[^>]+>/g, ''));
    const url = l[1].trim();
    if (!/^https?:/i.test(url)) continue;
    const snippet = d ? decodeEntities(d[1].replace(/<[^>]+>/g, '')) : '';
    results.push({ title, url, snippet: snippet.slice(0, 300) });
    if (results.length >= max) break;
  }
  return results;
}

/* ---------- source 2: DuckDuckGo HTML ---------- */
function parseDdgHtml(html, max) {
  const results = [];
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
    if (!/^https?:/i.test(href)) continue;
    const title = decodeEntities(a[2].replace(/<[^>]+>/g, ''));
    const sn = b.match(/class="result__snippet"[^>]*>(.*?)<\/a>/s);
    const snippet = sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')) : '';
    results.push({ title, url: href, snippet: snippet.slice(0, 300) });
    if (results.length >= max) break;
  }
  return results;
}

/* ---------- source 3: DuckDuckGo lite ---------- */
function parseDdgLite(html, max) {
  const results = [];
  const links = html.match(/class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs) || [];
  const anchors = Array.from(html.matchAll(/class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs));
  for (const m of anchors) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!/^https?:/i.test(url)) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ''));
    // snippet usually follows in the same <tr>, a <td class="result-snippet">
    const rest = html.slice(m.index);
    const sn = rest.match(/class="result-snippet"[^>]*>(.*?)<\/td>/s);
    const snippet = sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')) : '';
    results.push({ title, url, snippet: snippet.slice(0, 300) });
    if (results.length >= max) break;
  }
  return results;
}

async function fetchSource(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error('status ' + r.status);
  return r.text();
}

/* Resolve a result page's og:image server-side (browsers can't due to CORS). */
async function fetchOgImage(url, timeoutMs) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (!m) return null;
    let img = (m[1] || '').trim();
    if (!img) return null;
    if (img.indexOf('//') === 0) img = 'https:' + img;
    else if (img.indexOf('/') === 0) img = new URL(img, url).href;
    if (!/^https?:/i.test(img)) return null;
    return img.slice(0, 500);
  } catch (e) {
    return null;
  }
}

/* Attach og:image to the top few results (parallel, timeout-capped). */
async function enrichWithImages(results, count) {
  const top = results.slice(0, count);
  await Promise.all(top.map(async (r) => {
    try {
      r.image = await fetchOgImage(r.url, 3500);
    } catch (e) {
      r.image = null;
    }
  }));
}

export default async function handler(req, res) {
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

  const enc = encodeURIComponent(q);
  const attempts = [
    { name: 'bing', fn: () => fetchSource('https://www.bing.com/search?q=' + enc + '&format=rss'), parse: parseBingRss },
    { name: 'ddg-html', fn: () => fetchSource('https://html.duckduckgo.com/html/?q=' + enc), parse: parseDdgHtml },
    { name: 'ddg-lite', fn: () => fetchSource('https://lite.duckduckgo.com/lite/?q=' + enc), parse: parseDdgLite },
  ];

  for (const attempt of attempts) {
    try {
      const body = await attempt.fn();
      const results = attempt.parse(body, max);
      if (results.length) {
        await enrichWithImages(results, 3);
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).json({ query: q, source: attempt.name, results });
        return;
      }
    } catch (e) { /* try next source */ }
  }

  res.status(200).json({ query: q, results: [], empty: true });
}
