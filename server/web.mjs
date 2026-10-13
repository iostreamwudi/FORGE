import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const root = resolve(process.env.FORGE_WEB_ROOT ?? './dist');
const host = process.env.FORGE_WEB_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.FORGE_WEB_PORT ?? '8082', 10);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const indexPath = join(root, 'index.html');

function releaseId() {
  return String(Math.floor(statSync(indexPath).mtimeMs));
}

function renderIndex(release) {
  const source = readFileSync(indexPath, 'utf8');
  const body = source.replace(/((?:src|href)="\/[^"?]+\.(?:js|css))"/g, '$1?forge_release=' + release + '"');
  return Buffer.from(body);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const requestUrl = new URL(req.url ?? '/', 'http://forge.local');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const candidate = normalize(join(root, pathname));
  const insideRoot = candidate === root || candidate.startsWith(root + '/');
  const filePath = insideRoot && existsSync(candidate) && statSync(candidate).isFile() ? candidate : indexPath;
  if (!existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('FORGE web build is not available.');
    return;
  }
  const isIndex = filePath === indexPath;
  const release = releaseId();
  if (isIndex && requestUrl.searchParams.get('forge_release') !== release) {
    requestUrl.searchParams.set('forge_release', release);
    res.writeHead(302, {
      Location: requestUrl.pathname + '?' + requestUrl.searchParams.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'X-Forge-Release': release,
    });
    res.end();
    return;
  }
  const body = isIndex ? renderIndex(release) : null;
  const size = body ? body.byteLength : statSync(filePath).size;
  const headers = {
    'Content-Type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'X-Content-Type-Options': 'nosniff',
    'X-Forge-Release': release,
    'Cache-Control': isIndex ? 'no-store, no-cache, must-revalidate, proxy-revalidate' : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  if (body) {
    res.end(body);
    return;
  }
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => console.log('FORGE web listening on http://' + host + ':' + port));
