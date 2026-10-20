/* Every /api/* request lands here and is handed to the host-agnostic router
 * (server/router.js) — the same one the original Node server and Netlify
 * functions used. This file only adapts a Web Request into the router's plain
 * request object and its result back into a Response.
 *
 * Storage for shared boards, review notes and rendered images, first match:
 *   - SHARING=off: none — sharing is off and the UI says so
 *   - Upstash Redis env (KV_REST_API_URL + KV_REST_API_TOKEN, as Vercel's
 *     Marketplace integration sets them, or UPSTASH_REDIS_REST_URL/_TOKEN)
 *   - Netlify (NETLIFY=true): a Netlify Blobs store
 *   - Vercel without Redis (VERCEL=1): none — its filesystem is read-only,
 *     so sharing switches itself off instead of failing with 500s
 *   - otherwise: a directory on this machine (DATA_DIR, default ./.data)
 */

import path from 'node:path';
import { handleApi } from '@/server/router';
import { fileStorage, blobStorage, redisStorage } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A detailed line-art drawing can take minutes. 300s is the most Vercel's
// free (Hobby) plan allows — a higher value fails the deploy there.
export const maxDuration = 300;

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/* Board import posts base64 PDFs and images, and the client caps those at
   32MB of source bytes — roughly 43MB once base64-encoded. */
const MAX_BODY_BYTES = 48 * 1024 * 1024;

let storagePromise = null;
function getStorage() {
  if (!storagePromise) {
    storagePromise = (async () => {
      if ((process.env.SHARING || '').toLowerCase() === 'off') return null;
      const redis = redisEnv();
      if (redis) {
        const { Redis } = await import('@upstash/redis');
        return redisStorage(
          new Redis({ url: redis.url, token: redis.token, automaticDeserialization: false }),
        );
      }
      if (process.env.NETLIFY === 'true') {
        const { getStore } = await import('@netlify/blobs');
        return blobStorage(getStore({ name: 'never-bored', consistency: 'strong' }));
      }
      if (process.env.VERCEL) return null;
      // Runtime storage, not source: keep the bundler from tracing it.
      return fileStorage(
        path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), '.data')),
      );
    })();
  }
  return storagePromise;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 });
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Request body was not valid JSON'), { status: 400 });
  }
}

async function handle(request) {
  const url = new URL(request.url);
  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      body = await readBody(request);
    } catch (err) {
      return jsonResponse(err.status || 400, { error: err.message });
    }
  }

  const result = await handleApi(
    {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      // Header names arrive lower-cased, which is what the router expects.
      headers: Object.fromEntries(request.headers),
      body,
    },
    { storage: await getStorage(), env: process.env },
  );

  if (result.raw) {
    return new Response(result.raw, { status: result.status, headers: result.headers || {} });
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(result.headers || {}),
    },
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
