/*
 * Storage for shared boards, review notes, rendered images and generation
 * jobs. Two adapters behind one small interface:
 *
 *   getJSON(key)                         -> { data, etag } | null
 *   setJSON(key, data, { onlyIfMatch, onlyIfNew }) -> { modified, etag }
 *   getBinary(key)                       -> { data: Buffer, contentType } | null
 *   setBinary(key, buffer, contentType)
 *   list(prefix)                         -> [key, ...] (JSON entries under prefix)
 *   remove(key)
 *
 * fileStorage   — a directory on this machine (.data/ by default).
 * blobStorage   — Netlify: a Netlify Blobs store, strongly consistent.
 * redisStorage  — Vercel and other diskless hosts: Upstash Redis over HTTPS.
 *
 * Blobs is a key/value store with last-write-wins semantics, so the data is
 * laid out to never need a read-modify-write: every note, every panel status
 * and the editor seat is its own key with one natural writer (see router.js).
 * The conditional-write options are only used where losing a race is
 * harmless (claiming a generation job, creating a board).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{0,200}$/i;

function assertKey(key) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

/* ---------------- Local directory ---------------- */

function fileStorage(root) {
  const fileFor = (key, ext) => {
    assertKey(key);
    return path.join(root, `${key}${ext}`);
  };
  const etagOf = (text) => crypto.createHash('sha1').update(text).digest('hex');

  // Node runs this synchronously on one thread, so read-compare-write here is
  // atomic with respect to every other request this process handles.
  return {
    async getJSON(key) {
      try {
        const text = fs.readFileSync(fileFor(key, '.json'), 'utf8');
        return { data: JSON.parse(text), etag: etagOf(text) };
      } catch {
        return null;
      }
    },
    async setJSON(key, data, { onlyIfMatch, onlyIfNew } = {}) {
      const file = fileFor(key, '.json');
      let current = null;
      try {
        current = fs.readFileSync(file, 'utf8');
      } catch {
        current = null;
      }
      if (onlyIfNew && current !== null) return { modified: false };
      if (onlyIfMatch && (current === null || etagOf(current) !== onlyIfMatch)) {
        return { modified: false };
      }
      const text = JSON.stringify(data);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return { modified: true, etag: etagOf(text) };
    },
    async getBinary(key) {
      try {
        const data = fs.readFileSync(fileFor(key, '.bin'));
        const contentType = fs.readFileSync(fileFor(key, '.type'), 'utf8');
        return { data, contentType };
      } catch {
        return null;
      }
    },
    async setBinary(key, buffer, contentType) {
      const file = fileFor(key, '.bin');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
      fs.writeFileSync(fileFor(key, '.type'), contentType);
    },
    async list(prefix) {
      assertKey(prefix.replace(/\/$/, ''));
      const base = path.join(root, prefix);
      const keys = [];
      const walk = (dir, rel) => {
        let entries = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.forEach((e) => {
          if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
          else if (e.name.endsWith('.json')) keys.push(`${prefix}${rel}${e.name.slice(0, -5)}`);
        });
      };
      walk(base, '');
      return keys;
    },
    async remove(key) {
      ['.json', '.bin', '.type'].forEach((ext) => {
        try {
          fs.unlinkSync(fileFor(key, ext));
        } catch {
          /* already gone */
        }
      });
    },
  };
}

/* ---------------- Netlify Blobs ---------------- */

function blobStorage(store) {
  return {
    async getJSON(key) {
      assertKey(key);
      const entry = await store.getWithMetadata(key, { type: 'json' });
      return entry && entry.data !== null ? { data: entry.data, etag: entry.etag } : null;
    },
    async setJSON(key, data, { onlyIfMatch, onlyIfNew } = {}) {
      assertKey(key);
      const options = onlyIfMatch ? { onlyIfMatch } : onlyIfNew ? { onlyIfNew: true } : {};
      const result = await store.setJSON(key, data, options);
      return { modified: result ? result.modified !== false : true, etag: result && result.etag };
    },
    async getBinary(key) {
      assertKey(key);
      const entry = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!entry || !entry.data) return null;
      return {
        data: Buffer.from(entry.data),
        contentType: (entry.metadata && entry.metadata.contentType) || 'image/png',
      };
    },
    async setBinary(key, buffer, contentType) {
      assertKey(key);
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      await store.set(key, bytes, { metadata: { contentType } });
    },
    async list(prefix) {
      assertKey(prefix.replace(/\/$/, ''));
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
    async remove(key) {
      assertKey(key);
      await store.delete(key);
    },
  };
}

/* ---------------- Redis (Upstash, over HTTPS) ----------------
 *
 * For serverless hosts with no writable disk — Vercel in particular, where
 * the free Upstash Redis integration from the Marketplace provides
 * KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).
 * `redis` is an @upstash/redis client created with
 * automaticDeserialization: false, so values come back as the exact strings
 * stored and etags stay stable.
 *
 * Redis is strongly consistent, which suits the board layout in router.js
 * (one writer per key, small head/reviewstamp records polled every few
 * seconds). The conditional writes are native: onlyIfNew is SET NX, and
 * onlyIfMatch is an atomic compare-and-set in Lua against the SHA-1 etag.
 * Binary images are stored as JSON { contentType, data: base64 } under their
 * own key; list() only runs on board prefixes, which hold JSON entries.
 */

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
if redis.sha1hex(cur) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

function redisStorage(redis) {
  const etagOf = (text) => crypto.createHash('sha1').update(text).digest('hex');
  return {
    async getJSON(key) {
      assertKey(key);
      const text = await redis.get(key);
      if (text === null || text === undefined) return null;
      try {
        return { data: JSON.parse(text), etag: etagOf(text) };
      } catch {
        return null;
      }
    },
    async setJSON(key, data, { onlyIfMatch, onlyIfNew } = {}) {
      assertKey(key);
      const text = JSON.stringify(data);
      if (onlyIfNew) {
        const ok = await redis.set(key, text, { nx: true });
        return ok ? { modified: true, etag: etagOf(text) } : { modified: false };
      }
      if (onlyIfMatch) {
        const ok = await redis.eval(CAS_SCRIPT, [key], [onlyIfMatch, text]);
        return Number(ok) === 1 ? { modified: true, etag: etagOf(text) } : { modified: false };
      }
      await redis.set(key, text);
      return { modified: true, etag: etagOf(text) };
    },
    async getBinary(key) {
      assertKey(key);
      const text = await redis.get(key);
      if (!text) return null;
      try {
        const entry = JSON.parse(text);
        return { data: Buffer.from(entry.data, 'base64'), contentType: entry.contentType || 'image/png' };
      } catch {
        return null;
      }
    },
    async setBinary(key, buffer, contentType) {
      assertKey(key);
      await redis.set(key, JSON.stringify({ contentType, data: Buffer.from(buffer).toString('base64') }));
    },
    async list(prefix) {
      assertKey(prefix.replace(/\/$/, ''));
      // Keys are [a-z0-9/_-] only (assertKey), so no glob characters to escape.
      const keys = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, { match: `${prefix}*`, count: 500 });
        cursor = String(next);
        keys.push(...batch);
      } while (cursor !== '0');
      return keys;
    },
    async remove(key) {
      assertKey(key);
      await redis.del(key);
    },
  };
}

export { fileStorage, blobStorage, redisStorage };
