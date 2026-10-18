// api/search.js — busca carpetas públicas de Drive
export const config = { maxDuration: 30 };

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
  if (!key) return res.status(500).json({ error: 'Falta la variable GOOGLE_API_KEY en Vercel.' });

  const driveQ = `mimeType='application/vnd.google-apps.folder' and name contains '${q.replace(/'/g, "\\'")}' and trashed=false`;
  const url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(driveQ)
    + '&fields=' + encodeURIComponent('files(id,name)')
    + '&pageSize=30&orderBy=name&key=' + encodeURIComponent(key);

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (data.error && data.error.message) || 'Error de la API de Drive.' });
    return res.status(200).json({ results: (data.files || []).map((f) => ({ id: f.id, title: f.name })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}