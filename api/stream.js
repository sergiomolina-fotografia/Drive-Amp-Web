// api/stream.js — Edge Runtime (sin techo de 60s para el streaming)
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ error: 'Falta el parámetro ?id de Google Drive' }, 400);

  try {
    let up = await fetch(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&authuser=0&confirm=t`,
      { redirect: 'follow' }
    );
    if (!up.ok) {
      up = await fetch(
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=t`,
        { redirect: 'follow' }
      );
    }
    if (!up.ok) return json({ error: 'No se pudo obtener el audio. Verificá que el archivo sea público.' }, 502);

    const headers = new Headers(CORS);
    headers.set('Content-Type', up.headers.get('content-type') || 'audio/mpeg');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400');
    const len = up.headers.get('content-length');
    if (len) headers.set('Content-Length', len);

    return new Response(up.body, { status: 200, headers });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}