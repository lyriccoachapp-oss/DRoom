'use strict';
/* DRoom server: serves the built site from dist/ and the photo render API. No dependencies; Node 22+.
   Start with `npm start` (builds dist/ first). Settings come from the environment, see .env.example. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { validate, renderImage, RenderError } = require('./render');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_BODY = 8 * 1024 * 1024;

function createServer(env, opts) {
  env = env || process.env; opts = opts || {};
  const dist = opts.dist || path.join(__dirname, '..', 'dist');
  const limit = Math.max(1, parseInt(env.RENDER_LIMIT_PER_HOUR, 10) || 10), hits = new Map();
  /* Renders cost money, so each visitor gets a fixed number per hour. Accounts will replace this. */
  function allowed(ip) {
    const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600000);
    if (list.length >= limit) { hits.set(ip, list); return false; }
    list.push(now); hits.set(ip, list); return true;
  }
  const json = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); };
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new RenderError(413, 'too_large', 'The request is too large.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new RenderError(400, 'bad_json', 'Send JSON.')); } });
      req.on('error', reject);
    });
  }
  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/health') return json(res, 200, { ok: true, render: !!env.OPENAI_API_KEY });
    if (url === '/api/render') {
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
      try {
        const input = validate(await readBody(req));
        const ip = (env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
        if (!allowed(ip)) throw new RenderError(429, 'limit', 'You have used this hour\'s photo renders. Try again later.');
        return json(res, 200, await renderImage(input, env, opts.fetch));
      } catch (e) {
        if (e instanceof RenderError) return json(res, e.status, { error: e.code, message: e.message });
        console.error('[render] failed', e);
        return json(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let p; try { p = path.normalize(decodeURIComponent(url)); } catch (e) { res.writeHead(400); return res.end(); }
    if (p.endsWith(path.sep)) p = path.join(p, 'index.html');
    let file = path.join(dist, p);
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, data) => {
        if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  });
}

if (require.main === module) {
  const port = parseInt(process.env.PORT, 10) || 8080;
  createServer().listen(port, () => console.log('DRoom on http://localhost:' + port + '  (planner at /app/, photo render ' + (process.env.OPENAI_API_KEY ? 'on' : 'off: set OPENAI_API_KEY') + ')'));
}
module.exports = { createServer };
