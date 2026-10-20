// api/search.js — busca carpetas públicas de Drive por nombre
export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FOLDER_RE = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/;

async function folderTitle(id) {
  try {
    const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    const t = m && m[1].replace(/\s+/g, ' ').trim();
    if (!t || /^(google drive|iniciar|sign in)/i.test(t)) return null;
    return t;
  } catch (e) { return null; }
}

async function viaCse(q, key, cx) {
  const url = 'https://www.googleapis.com/customsearch/v1?num=10'
    + '&q=' + encodeURIComponent('site:drive.google.com/drive/folders ' + q)
    + '&key=' + encodeURIComponent(key) + '&cx=' + encodeURIComponent(cx);
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Error de Custom Search');
  return (d.items || []).map((i) => (i.link.match(FOLDER_RE) || [])[1]).filter(Boolean);
}

async function viaScrape(q) {
  const url = 'https://www.google.com/search?num=30&hl=es'
    + '&q=' + encodeURIComponent('site:drive.google.com/drive/folders ' + q);
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8' } });
  const html = await r.text();
  const ids = [];
  for (const m of html.matchAll(new RegExp(FOLDER_RE.source, 'g'))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let q = req.query.q || req.query.query;
  if (!q && req.body) {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) {} }
    if (b) q = b.query || (b.json && b.json.query);
  }
  q = String(q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Consulta muy corta.' });

  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;

  let ids = [];
  const notes = [];
  if (key && cx) {
    try { ids = await viaCse(q, key, cx); } catch (e) { notes.push('CSE: ' + e.message); }
  }
  if (ids.length < 3) {
    try {
      for (const id of await viaScrape(q)) if (!ids.includes(id)) ids.push(id);
    } catch (e) { notes.push('Scrape: ' + e.message); }
  }

  if (!ids.length) {
    return res.status(200).json({ results: [], notes: notes.length ? notes : ['Sin resultados.'] });
  }

  const results = await Promise.all(
    ids.slice(0, 12).map(async (id) => ({
      id,
      title: (await folderTitle(id)) || 'Carpeta de Drive',
      url: `https://drive.google.com/drive/folders/${id}`,
    }))
  );
  return res.status(200).json({ results });
}