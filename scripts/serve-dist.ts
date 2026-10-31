/** 极简静态服务器，只用于本地验证 web 导出产物 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 8099);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0] ?? '/';
  const rel = url === '/' ? 'index.html' : normalize(url).replace(/^([/\\])+/, '');
  try {
    const buf = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    const buf = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'content-type': types['.html'] ?? 'text/html' });
    res.end(buf);
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
