const crypto = require('crypto');

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const COOKIE = 'nomi_github_session';
const scopes = 'repo,workflow';

function secret() {
  if (!process.env.GITHUB_OAUTH_SECRET) throw new Error('GITHUB_OAUTH_SECRET is not configured');
  return process.env.GITHUB_OAUTH_SECRET;
}
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function makeCookie(value) { const encoded = encode(value); return `${COOKIE}=${encoded}.${sign(encoded)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`; }
function readCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const value = raw.slice(COOKIE.length + 1);
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(encoded)))) return null;
  const session = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  return session.expiresAt > Date.now() ? session : null;
}
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
function redirect(res, location, cookie) { res.statusCode = 302; res.setHeader('Location', location); if (cookie) res.setHeader('Set-Cookie', cookie); res.end(); }
async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub API error (${response.status})`);
  return data;
}
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); }); }
function publicOrigin(req) { return process.env.APP_ORIGIN || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`; }

module.exports = async (req, res) => {
  try {
    const action = new URL(req.url, publicOrigin(req)).searchParams.get('action') || 'start';
    const origin = publicOrigin(req);
    if (req.method === 'GET' && action === 'start') {
      if (!process.env.GITHUB_CLIENT_ID) return json(res, 500, { error: 'GITHUB_CLIENT_ID is not configured' });
      const state = crypto.randomBytes(24).toString('hex');
      const callback = `${origin}/api/github?action=callback`;
      const location = `${GITHUB_AUTHORIZE}?client_id=${encodeURIComponent(process.env.GITHUB_CLIENT_ID)}&redirect_uri=${encodeURIComponent(callback)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
      return redirect(res, location, makeCookie({ state, expiresAt: Date.now() + 10 * 60 * 1000 }));
    }
    if (req.method === 'GET' && action === 'callback') {
      const query = new URL(req.url, origin).searchParams;
      const session = readCookie(req);
      if (!session || !query.get('state') || query.get('state') !== session.state) return json(res, 400, { error: 'OAuth state validation failed' });
      if (query.get('error')) return redirect(res, `${origin}/?github=denied`);
      const tokenResponse = await fetch(GITHUB_TOKEN, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: query.get('code'), redirect_uri: `${origin}/api/github?action=callback` }) });
      const token = await tokenResponse.json();
      if (!token.access_token) return json(res, 502, { error: token.error_description || 'GitHub token exchange failed' });
      const user = await github('/user', { headers: { Authorization: `Bearer ${token.access_token}` } });
      return redirect(res, `${origin}/?github=connected&login=${encodeURIComponent(user.login)}`, makeCookie({ token: token.access_token, login: user.login, expiresAt: Date.now() + 60 * 60 * 1000 }));
    }
    if (req.method === 'GET' && action === 'status') {
      const session = readCookie(req);
      return json(res, 200, { connected: Boolean(session?.token), login: session?.login || null });
    }
    if (req.method === 'POST') {
      const session = readCookie(req);
      if (!session?.token) return json(res, 401, { error: 'GitHub authorization required' });
      const input = await body(req);
      const owner = input.owner || session.login;
      const repo = String(input.repo || '').replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!repo) return json(res, 400, { error: 'Repository name is required' });
      const auth = { Authorization: `Bearer ${session.token}` };
      if (input.action === 'create-repo') {
        const created = await github('/user/repos', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: repo, private: Boolean(input.private), auto_init: false }) });
        return json(res, 200, { ok: true, url: created.html_url });
      }
      if (input.action === 'push') {
        const files = input.files && typeof input.files === 'object' ? input.files : {};
        const results = [];
        for (const [path, content] of Object.entries(files)) {
          const encoded = Buffer.from(String(content), 'utf8').toString('base64');
          const filePath = path.split('/').map(encodeURIComponent).join('/');
          let sha;
          try { sha = (await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`, { headers: auth })).sha; } catch (_) {}
          const result = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `NOMI AI: update ${path}`, content: encoded, ...(sha ? { sha } : {}) }) });
          results.push(result.content?.path || path);
        }
        return json(res, 200, { ok: true, files: results, url: `https://github.com/${owner}/${repo}` });
      }
      if (input.action === 'pages') {
        const pages = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: { branch: input.branch || 'main', path: input.path || '/' } }) });
        return json(res, 200, { ok: true, url: pages.html_url || `https://${owner}.github.io/${repo}` });
      }
      return json(res, 400, { error: 'Unknown GitHub action' });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) { return json(res, 500, { error: error.message }); }
};
