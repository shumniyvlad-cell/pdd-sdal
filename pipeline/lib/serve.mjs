// Мини-сервер статики для site/ — рендеру нужен http, а не file://
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './paths.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webp': 'image/webp' };

export function serveSite() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(SITE)) { rsp.writeHead(403).end(); return; }
      fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, buf) => {
        if (err) { rsp.writeHead(404).end(); return; }
        rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}
