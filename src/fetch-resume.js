/*
 * 分块断点续传加载器
 *
 * 为什么需要：本站经 Cloudflare 隧道（澳洲链路约 40KB/s），
 * spine.json 1.4MB / flower_spine.bin 1.5MB 一次性下载容易中途断开。
 * Range 请求 + 分块重试可以保证：断了就从断点续，不用从头再来。
 */

const CHUNK = 256 * 1024;        // 每块 256KB
const MAX_RETRY = 8;             // 单块最多重试 8 次
const RETRY_BASE_MS = 600;

/**
 * 以 Range 分块下载一个二进制文件，带断点续传与指数退避重试。
 * @param {string} url
 * @param {(loaded:number, total:number)=>void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchWithResume(url, onProgress) {
  /* ① 先探测总大小 */
  let total = 0;
  let acceptsRanges = false;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (head.ok) {
        total = parseInt(head.headers.get("content-length") || "0", 10);
        acceptsRanges =
          (head.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");
      }
      break;
    } catch {
      if (attempt === MAX_RETRY) break;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }

  /* 拿不到大小或服务端不支持 Range → 退回一次性下载（也带重试） */
  if (!total || !acceptsRanges) {
    return fetchWholeWithRetry(url, onProgress);
  }

  const out = new Uint8Array(total);
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK - 1, total - 1);
    let ok = false;

    for (let attempt = 0; attempt <= MAX_RETRY && !ok; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${offset}-${end}` },
          cache: "no-store",
          signal: AbortSignal.timeout(60000),
        });

        if (res.status !== 206) {
          /* 服务端忽略了 Range，返回 200 全量 → 直接吞掉整包 */
          if (res.status === 200) {
            const buf = new Uint8Array(await res.arrayBuffer());
            onProgress?.(buf.length, buf.length);
            return buf.buffer;
          }
          throw new Error(`unexpected status ${res.status}`);
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        const want = end - offset + 1;

        if (buf.length !== want) {
          /* 长度不足 → 只写入已收到的部分，下轮从新的 offset 续 */
          out.set(buf, offset);
          offset += buf.length;
          onProgress?.(offset, total);
          throw new Error(`short chunk ${buf.length}/${want}`);
        }

        out.set(buf, offset);
        offset += want;
        onProgress?.(offset, total);
        ok = true;
      } catch (e) {
        if (attempt === MAX_RETRY) {
          throw new Error(`chunk ${offset}-${end} failed after ${MAX_RETRY} retries: ${e.message}`);
        }
        await sleep(RETRY_BASE_MS * Math.min(2 ** attempt, 8000));
      }
    }
  }

  return out.buffer;
}

async function fetchWholeWithRetry(url, onProgress) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const buf = await res.arrayBuffer();
      onProgress?.(buf.byteLength, buf.byteLength);
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRY) break;
      await sleep(RETRY_BASE_MS * Math.min(2 ** attempt, 8000));
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * JSON 版：先按 Range 拿字节，再 parse。
 */
export async function fetchJSONWithResume(url, onProgress) {
  const buf = await fetchWithResume(url, onProgress);
  return JSON.parse(new TextDecoder().decode(buf));
}
