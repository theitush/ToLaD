// The built page's URL for the browser scripts (designshot). The page fetches mammals.json beside it (ToLaD#247, #418),
// which a file:// page cannot, so dist-single is served over http on a free port, as the deployed site serves it.
// close() stops the server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };

export async function pageUrl(query, dir = 'dist-single') {
  const q = query ? `?${query}` : '';
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = join(root, p === '/' ? 'index.html' : p);
    if (!f.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(f);
      res.writeHead(200, { 'Content-Type': TYPES[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}/${q}`, close: () => server.close() };
}
