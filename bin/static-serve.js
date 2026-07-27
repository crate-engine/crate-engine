// static-serve.js — in-box GET-only static server for the smoke rung.
//
// Usage: node static-serve.js <port> [dir]
// Serves <dir> (default cwd). GET/HEAD only (the rung never POSTs, and neither
// does its server — Rider 4); path traversal refused; unknown paths 404. This
// is the prod-serve fallback for plain-HTML projects (no build, no dev script):
// the "artifact that would deploy" IS the tree, so serving it is the honest smoke.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2], 10);
if (!port) {
  console.error('usage: static-serve.js <port> [dir]');
  process.exit(2);
}
const root = path.resolve(process.argv[3] || '.');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = urlPath.replace(/\/+$/, '') || '/';
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    let target = file;
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    } catch {
      /* fall through to the extensionless-html try below */
    }
    if (!fs.existsSync(target) && !path.extname(target)) {
      target = `${target}.html`; // pretty-URL projects: /about -> about.html
    }
    if (!fs.existsSync(target)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
    });
    req.method === 'HEAD' ? res.end() : fs.createReadStream(target).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`static-serve: ${root} on ${port}`));
