// api/resolve.js — resuelve enlaces de Drive con la API oficial v3 (sin scraping)
export const config = { maxDuration: 60 };

const FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_DEPTH = 3;
const AUDIO_EXT = /\.(mp3|m4a|wav|flac|ogg|oga|opus|aac|weba|wma)$/i;

const idFromLink = (link) => {
  const f = link.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (f) return { id: f[1], kind: 'folder' };
  const file = link.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || link.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (file) return { id: file[1], kind: 'file' };
  const bare = link.match(/^([A-Za-z0-9_-]{10,})$/);
  if (bare) return { id: bare[1], kind: 'unknown' };
  return null;
};

const keyFromLink = (link) => (link.match(/[?&]resourcekey=([A-Za-z0-9_-]+)/) || [])[1] || null;

async function apiGet(url, headers) {
  const r = await fetch(url, { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + r.status));
  return data;
}

async function listFolder(folderId, key, rk, seen, out, depth) {
  if (depth > MAX_DEPTH) return;
  const headers = rk ? { 'X-Goog-Drive-Resource-Keys': `${folderId}/${rk}` } : {};
  const subfolders = [];
  let pageToken = null;
  do {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType)',
      pageSize: '1000',
      key,
    });
    if (pageToken) p.set('pageToken', pageToken);
    const data = await apiGet(FILES + '?' + p.toString(), headers);
    for (const f of data.files || []) {
      if (f.mimeType === FOLDER_MIME) { subfolders.push(f.id); continue; }
      if (seen.has(f.id)) continue;
      if (!/^audio\//i.test(f.mimeType) && !AUDIO_EXT.test(f.name)) continue;
      seen.add(f.id);
      out.push({ id: f.id, title: f.name, name: f.name, streamUrl: `/api/stream?id=${f.id}` });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  for (const sf of subfolders) await listFolder(sf, key, null, seen, out, depth + 1);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.GOOGLE_API_KEY;
  if (!key) return res.status(500).json({ error: 'Falta la variable GOOGLE_API_KEY en Vercel.' });

  let links = [];
  try {
    let b = await readBody(req);
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) {} }
    if (b && typeof b === 'object') {
      if (Array.isArray(b.links)) links = b.links;
      else if (b.json && Array.isArray(b.json.links)) links = b.json.links;
      else if (typeof b.url === 'string') links = [b.url];
    }
  } catch (e) {}
  if (!links.length && req.query.url) links = [req.query.url];

  links = links.map((s) => String(s).trim()).filter(Boolean);
  if (!links.length || (links.length === 1 && links[0] === 'ping')) {
    return res.status(200).json({ ok: true, tracks: [] });
  }

  const tracks = [];
  const seen = new Set();
  const warnings = [];

  for (const link of links) {
    const hit = idFromLink(link);
    if (!hit) { warnings.push('Enlace no reconocido: ' + link.slice(0, 50)); continue; }
    const rk = keyFromLink(link);

    try {
      if (hit.kind === 'file') {
        const f = await apiGet(`${FILES}/${hit.id}?fields=id,name,mimeType&key=${key}`,
          rk ? { 'X-Goog-Drive-Resource-Keys': `${hit.id}/${rk}` } : {});
        if (!seen.has(f.id)) {
          seen.add(f.id);
          tracks.push({ id: f.id, title: f.name, name: f.name, streamUrl: `/api/stream?id=${f.id}` });
        }
      } else {
        try {
          await listFolder(hit.id, key, rk, seen, tracks, 0);
        } catch (e) {
          if (hit.kind !== 'unknown') throw e;
          const f = await apiGet(`${FILES}/${hit.id}?fields=id,name,mimeType&key=${key}`);
          if (!seen.has(f.id)) {
            seen.add(f.id);
            tracks.push({ id: f.id, title: f.name, name: f.name, streamUrl: `/api/stream?id=${f.id}` });
          }
        }
      }
    } catch (e) {
      warnings.push(`${link.slice(0, 45)}: ${e.message}`);
    }
  }

  if (!tracks.length) {
    return res.status(404).json({
      error: warnings.length ? warnings.join(' · ') : 'No se encontraron audios en esos enlaces.',
      warnings,
    });
  }
  return res.status(200).json({ type: 'links', count: tracks.length, tracks, warnings });
}