import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export async function startStaticServer(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) throw new Error('Path outside test root');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolveClose => server.close(resolveClose))
  };
}
