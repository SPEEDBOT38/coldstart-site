// Local host: serves the static site and routes /api/* to the same handler Vercel runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './lib/app.js';
import { createStore } from './lib/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try { for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}

const PORT = Number(process.env.PORT) || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8' };
const PRIVATE = /^\/(lib|api|tests|node_modules|\.data|\.env|\.git|server\.js|package\.json|vercel\.json)(\/|$)/;
const api = createHandler({ store: createStore() });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) return api(req, res);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') { res.statusCode = 307; res.setHeader('location', '/v2.html'); return res.end(); }
  const file = path.join(ROOT, p);
  if (PRIVATE.test(p) || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('coldstart on http://127.0.0.1:' + PORT));
