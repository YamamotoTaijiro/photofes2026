const WORK_COUNT = 48;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // /statsや/logは常に最新の集計を見せる必要があるため、エッジ・ブラウザのどちらにもキャッシュさせない
  'Cache-Control': 'no-store',
};

const AUTH_REALM = 'photofes2026 stats';

function isAuthorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = atob(header.slice(6));
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return password === env.STATS_PASSWORD;
}

function unauthorizedResponse() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${AUTH_REALM}"`, ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/track') {
      return handleTrack(request, env);
    }

    // /stats, /log, /thumb/*は写真ごとの認識ログ・サムネイルを含むため、誰でも見られないようBasic認証をかける
    const isProtected =
      request.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/stats' || url.pathname === '/log' || url.pathname.startsWith('/thumb/'));

    if (isProtected) {
      if (!isAuthorized(request, env)) return unauthorizedResponse();

      if (url.pathname === '/' || url.pathname === '/stats') return handleStats(env);
      if (url.pathname === '/log') return handleLog(env);
      if (url.pathname.startsWith('/thumb/')) return handleThumb(url, env);
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

  const ipAddress = request.headers.get('CF-Connecting-IP');
  const userAgent = request.headers.get('User-Agent');
  const uiLang = body.lang === 'en' ? 'en' : body.lang === 'ja' ? 'ja' : null;

  await env.DB.prepare(
    'INSERT INTO views (photo_index, ip_address, user_agent, ui_lang) VALUES (?, ?, ?, ?)'
  ).bind(photoIndex, ipAddress, userAgent, uiLang).run();

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
      <td><img src="/thumb/panel${row.photo_index}.jpg" alt="panel${row.photo_index}" loading="lazy"></td>
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
  td:nth-child(1) { width:64px; }
  td:nth-child(1) img { width:56px; height:56px; object-fit:cover; border-radius:4px; display:block; }
  td:nth-child(2) { width:100px; }
  td:nth-child(3) { width:60px; text-align:right; }
  td:nth-child(4) { width:auto; }
  .bar { height:10px; background:#c9a24a; border-radius:5px; }
</style>
</head>
<body>
  <h1>写真展 AR ガイド - 認識回数</h1>
  <p class="total">総認識回数: ${total}</p>
  <table>${rows || '<tr><td colspan="4">まだデータがありません</td></tr>'}</table>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', ...CORS_HEADERS },
  });
}

async function handleThumb(url, env) {
  const match = url.pathname.match(/^\/thumb\/panel(\d+)\.jpg$/);
  const photoIndex = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= WORK_COUNT) {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }

  const row = await env.DB.prepare(
    'SELECT image, content_type FROM thumbnails WHERE photo_index = ?'
  ).bind(photoIndex).first();

  if (!row) {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }

  // D1のBLOB列はドキュメント上ArrayBufferのはずだが、実際にはただの数値配列で返る既知の不具合があるため、
  // Uint8Arrayに変換してから返す(そのままだとResponseのbodyとして正しく扱われない)。
  const imageBytes = new Uint8Array(row.image);

  return new Response(imageBytes, {
    headers: { 'Content-Type': row.content_type, ...CORS_HEADERS },
  });
}

async function handleLog(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, photo_index, viewed_at, ip_address, user_agent, ui_lang FROM views ORDER BY id DESC LIMIT 500'
  ).all();

  const rows = results.map(row => `
    <tr>
      <td>${row.id}</td>
      <td>${row.viewed_at}</td>
      <td>panel${row.photo_index}</td>
      <td>${row.ui_lang ?? ''}</td>
      <td>${row.ip_address ?? ''}</td>
      <td>${row.user_agent ?? ''}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>写真展AR 認識ログ</title>
<style>
  body { font-family: sans-serif; background:#0c0c0d; color:#ece7df; padding:24px; }
  h1 { font-size:18px; font-weight:500; }
  p.note { color:#8b8681; margin-top:0; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th, td { padding:6px 10px; border-bottom:1px solid #2a2a2a; text-align:left; white-space:nowrap; }
  td:nth-child(6) { white-space:normal; word-break:break-all; }
</style>
</head>
<body>
  <h1>写真展 AR ガイド - 認識ログ(直近500件)</h1>
  <p class="note">除外したいIPアドレスがあれば、CloudflareダッシュボードまたはwranglerからそのIPの行をDELETEしてください。</p>
  <table>
    <tr><th>id</th><th>日時(UTC)</th><th>写真</th><th>言語</th><th>IPアドレス</th><th>User-Agent</th></tr>
    ${rows || '<tr><td colspan="6">まだデータがありません</td></tr>'}
  </table>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', ...CORS_HEADERS },
  });
}
