import { createServer } from 'node:http';
import { stat, open } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = +(process.env.PORT || 4177);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  let p = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
  return join(ROOT, safe);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('405');
    return;
  }

  let fp;
  try {
    fp = resolvePath(req.url);
  } catch {
    res.writeHead(400).end('400');
    return;
  }

  let st;
  try {
    st = await stat(fp);
    if (st.isDirectory()) throw new Error('dir');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  const type = MIME[extname(fp).toLowerCase()] || 'application/octet-stream';
  const size = st.size;
  const etag = `W/"${size}-${Math.floor(st.mtimeMs)}"`;

  /* 条件请求 */
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }

  const baseHeaders = {
    'Content-Type': type,
    'ETag': etag,
    'Cache-Control': 'public, max-age=300',
    // 隧道/代理传输大文件需要它
    'Accept-Ranges': 'bytes',
  };

  /* Range 支持：断点续传 + 隧道分块 */
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);

      if (start === null && end === null) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      if (start === null) {
        // suffix range: 最后 N 字节
        start = Math.max(0, size - end);
        end = size - 1;
      } else if (end === null || end >= size) {
        end = size - 1;
      }

      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }

      const len = end - start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': len,
      });
      if (req.method === 'HEAD') { res.end(); return; }
      await streamRange(res, fp, start, end);
      return;
    }
  }

  /* 完整响应：显式 Content-Length + 流式写出
     —— 之前用 readFile 一次性 res.end(data)，
        1.4MB 的 spine.json 经 Cloudflare 隧道会中断（code=000） */
  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': size,
  });

  if (req.method === 'HEAD') { res.end(); return; }
  await streamRange(res, fp, 0, size - 1);
});

async function streamRange(res, fp, start, end) {
  const CHUNK = 64 * 1024;
  let fh;
  try {
    fh = await open(fp, 'r');
    let pos = start;
    while (pos <= end) {
      const len = Math.min(CHUNK, end - pos + 1);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      // 背压处理：写满就先等 drain
      if (!res.write(bytesRead === len ? buf : buf.subarray(0, bytesRead))) {
        await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  } finally {
    await fh?.close().catch(() => {});
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}/`);
});
