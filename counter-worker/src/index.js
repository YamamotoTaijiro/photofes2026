const WORK_COUNT = 48;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/track') {
      return handleTrack(request, env);
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/stats')) {
      return handleStats(env);
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};

async function handleTrack(request, env) {
  let body;
  try {
    // navigator.sendBeacon()はtext/plainで送るため、Content-Typeによらず本文をJSONとして解釈する
    const text = await request.text();
    body = JSON.parse(text);
  } catch {
    return new Response('Invalid body', { status: 400, headers: CORS_HEADERS });
  }

  const photoIndex = Number(body && body.photo);
  if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= WORK_COUNT) {
    return new Response('Invalid photo index', { status: 400, headers: CORS_HEADERS });
  }

  await env.DB.prepare('INSERT INTO views (photo_index) VALUES (?)').bind(photoIndex).run();

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleStats(env) {
  const { results } = await env.DB.prepare(
    'SELECT photo_index, COUNT(*) AS count FROM views GROUP BY photo_index ORDER BY count DESC'
  ).all();

  const total = results.reduce((sum, row) => sum + row.count, 0);
  const maxCount = results.length ? results[0].count : 0;

  const rows = results.map(row => `
    <tr>
      <td>panel${row.photo_index}</td>
      <td>${row.count}</td>
      <td><div class="bar" style="width:${maxCount ? (row.count / maxCount) * 100 : 0}%"></div></td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>写真展AR 認識回数</title>
<style>
  body { font-family: sans-serif; background:#0c0c0d; color:#ece7df; padding:24px; }
  h1 { font-size:18px; font-weight:500; }
  p.total { color:#8b8681; margin-top:0; }
  table { border-collapse:collapse; width:100%; max-width:640px; }
  td { padding:8px 10px; border-bottom:1px solid #2a2a2a; font-size:14px; vertical-align:middle; }
  td:nth-child(1) { width:100px; }
  td:nth-child(2) { width:60px; text-align:right; }
  td:nth-child(3) { width:auto; }
  .bar { height:10px; background:#c9a24a; border-radius:5px; }
</style>
</head>
<body>
  <h1>写真展 AR ガイド - 認識回数</h1>
  <p class="total">総認識回数: ${total}</p>
  <table>${rows || '<tr><td colspan="3">まだデータがありません</td></tr>'}</table>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', ...CORS_HEADERS },
  });
}
