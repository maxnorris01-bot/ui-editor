import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

/** Tiny static server so the harness page and its blob: SVG previews share one http origin. */
export async function serve(root: string): Promise<{ url: string; server: Server }> {
  const page = '<!doctype html><meta charset="utf-8"><title>harness</title><div id="host"></div>';
  const server = createServer((req, res) => {
    if (req.url === '/engine.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(readFileSync(`${root}/build/engine.js`));
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page);
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, server };
}
