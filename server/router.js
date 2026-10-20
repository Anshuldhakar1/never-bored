/*
 * Every /api route, written once against a plain request object so any host
 * can adapt to it — here, the Next.js catch-all route handler:
 *
 *   handleApi({ method, path, query, headers, body }, ctx) -> { status, body | raw, headers }
 *
 * ctx = { storage, env, startJob? }. With startJob, generation runs as a
 * background job the page polls (hosts with a short function time limit);
 * without it, generation runs inline and answers when done.
 *
 * Routes
 *   GET  /api/status                      what this server can do
 *   POST /api/generate                    { task, content } -> result | 202 { job }
 *   GET  /api/generate?job=<id>           job result, or 202 while it runs
 *   GET  /api/raster/<id>                 a rendered panel image
 *   POST /api/boards                      share a board -> { id, editKey, reviewKey }
 *   GET  /api/boards/<id>?since=&rstamp=  board, review notes, editor lease
 *   PUT  /api/boards/<id>                 save (editor holding the lease)
 *   DELETE /api/boards/<id>               delete (edit key)
 *   POST /api/boards/<id>/lease           take, renew or release the editor seat
 *   POST /api/boards/<id>/review          comment, resolve, delete, set status
 *   POST /api/feedback                    beta feedback, when Netlify Forms is off
 *
 * Access: a board link carries a key (edit or review) in its #fragment, which
 * the page sends as x-board-key. The edit key is stored only as a hash. When
 * BETA_ACCESS_CODE is set, generating and creating boards also need that code
 * (x-access-code) — so a public beta link cannot be used to spend the key.
 */

import crypto from 'node:crypto';
import { runGeneration, describeBackend } from './generate-core.js';

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const RASTER_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const LEASE_MS = 75 * 1000;
const JOB_STALE_MS = 16 * 60 * 1000;
const MAX_DOC_CHARS = 4.5 * 1024 * 1024;
const MAX_COMMENTS = 800;
const STATUSES = ['approved', 'changes'];

/* ---------------- Helpers ---------------- */

const json = (status, body, headers) => ({ status, body, headers });
const error = (status, message, extra = {}) => json(status, { error: message, ...extra });

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const clip = (value, max) => String(value == null ? '' : value).slice(0, max);

function checkAccessCode(headers, env) {
  const code = (env.BETA_ACCESS_CODE || '').trim();
  if (!code) return null;
  if (safeEqual(headers['x-access-code'] || '', code)) return null;
  return error(401, 'This beta needs an access code. Enter it under API settings.', {
    code: 'access_code',
  });
}

function roleFor(meta, key) {
  if (!key) return null;
  const hashed = hashKey(key);
  if (safeEqual(hashed, meta.editHash)) return 'edit';
  if (safeEqual(hashed, meta.reviewHash)) return 'review';
  return null;
}

/* ---------------- Generation ---------------- */

function saveImageWith(storage) {
  if (!storage) return null;
  return async (bytes, contentType) => {
    const id = randomId(18);
    await storage.setBinary(`raster/${id}`, bytes, contentType);
    return `/api/raster/${id}`;
  };
}

async function postGenerate(req, ctx) {
  const denied = checkAccessCode(req.headers, ctx.env);
  if (denied) return denied;
  const body = req.body || {};
  if (!ctx.startJob) {
    const result = await runGeneration(body, {
      env: ctx.env,
      saveImage: saveImageWith(ctx.storage),
    });
    return json(result.status, result.body);
  }
  const id = randomId(16);
  await ctx.storage.setJSON(`jobs/${id}`, {
    status: 'queued',
    createdAt: Date.now(),
    input: { task: body.task, content: body.content, provider: body.provider },
  });
  await ctx.startJob(id);
  return json(202, { job: id });
}

async function getJob(req, ctx) {
  const id = req.query.job;
  if (!ID_RE.test(id || '')) return error(400, 'Unknown job.');
  const entry = await ctx.storage.getJSON(`jobs/${id}`);
  if (!entry) return error(404, 'That job has expired. Try again.');
  const job = entry.data;
  if (job.status === 'done') {
    await ctx.storage.remove(`jobs/${id}`);
    return json(job.result.status, job.result.body);
  }
  if (Date.now() - job.createdAt > JOB_STALE_MS) {
    await ctx.storage.remove(`jobs/${id}`);
    return error(504, 'Generation timed out. Try again.');
  }
  return json(202, { job: id, status: job.status });
}

/* Runs one queued job to completion. Called by the background function. */
async function runJob(id, ctx) {
  if (!ID_RE.test(id || '')) return;
  const key = `jobs/${id}`;
  const entry = await ctx.storage.getJSON(key);
  if (!entry || entry.data.status !== 'queued') return;
  // Claim it, so a retried invocation cannot run the same job twice.
  const claimed = await ctx.storage.setJSON(
    key,
    { ...entry.data, status: 'running' },
    { onlyIfMatch: entry.etag },
  );
  if (!claimed.modified) return;

  let result;
  try {
    result = await runGeneration(entry.data.input, {
      env: ctx.env,
      saveImage: saveImageWith(ctx.storage),
    });
  } catch {
    result = { status: 500, body: { error: 'Generation failed on the server.' } };
  }
  await ctx.storage.setJSON(key, { status: 'done', createdAt: entry.data.createdAt, result });
}

async function getRaster(id, ctx) {
  if (!RASTER_ID_RE.test(id || '')) return error(404, 'Not found');
  const entry = await ctx.storage.getBinary(`raster/${id}`);
  if (!entry) return error(404, 'Not found');
  return {
    status: 200,
    raw: entry.data,
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

/* ---------------- Boards ----------------
 *
 * Storage layout. Blobs is last-write-wins, so nothing here is a
 * read-modify-write of a shared record; each key has one natural writer:
 *
 *   boards/<id>/meta           keys and creation time — written once
 *   boards/<id>/doc            { version, project } — only the seat holder writes
 *   boards/<id>/head           { version, title, updatedAt } — written after doc,
 *                              so a poll reads a few bytes, not the whole board
 *   boards/<id>/lease          the editor seat { clientId, name, until }
 *   boards/<id>/notes/<noteId> one review note each
 *   boards/<id>/status/<panel> one approval decision per panel
 *   boards/<id>/reviewstamp    a random token rewritten after every review
 *                              change; pollers refetch notes when it differs
 */

const PANEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NOTE_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const keyFor = (id, part) => `boards/${id}/${part}`;

function validProject(project) {
  return (
    project &&
    typeof project === 'object' &&
    Array.isArray(project.sequences) &&
    project.sequences.length > 0 &&
    JSON.stringify(project).length <= MAX_DOC_CHARS
  );
}

async function readJSON(ctx, key) {
  const entry = await ctx.storage.getJSON(key);
  return entry ? entry.data : null;
}

async function readLease(ctx, id) {
  const lease = await readJSON(ctx, keyFor(id, 'lease'));
  return lease && lease.until > Date.now() ? lease : null;
}

/* Loads what every board request needs and works out the caller's role. */
async function openBoard(id, req, ctx) {
  const meta = await readJSON(ctx, keyFor(id, 'meta'));
  if (!meta) return { fail: error(404, 'This board no longer exists.') };
  const role = roleFor(meta, req.headers['x-board-key']);
  if (!role) return { fail: error(403, 'This link is not valid for this board.') };
  return { meta, role };
}

async function boardState(id, meta, role, ctx) {
  const [head, lease, stamp] = await Promise.all([
    readJSON(ctx, keyFor(id, 'head')),
    readLease(ctx, id),
    readJSON(ctx, keyFor(id, 'reviewstamp')),
  ]);
  return {
    id,
    role,
    title: head ? head.title : 'Untitled Board',
    version: head ? head.version : 1,
    updatedAt: head ? head.updatedAt : meta.createdAt,
    reviewStamp: stamp ? stamp.stamp : '',
    lease: lease ? { clientId: lease.clientId, name: lease.name, until: lease.until } : null,
    // Editors can hand out the review link; reviewers only have their own.
    reviewKey: role === 'edit' ? meta.reviewKey : undefined,
  };
}

async function readReview(id, ctx) {
  const [noteKeys, statusKeys, stamp] = await Promise.all([
    ctx.storage.list(keyFor(id, 'notes/')),
    ctx.storage.list(keyFor(id, 'status/')),
    readJSON(ctx, keyFor(id, 'reviewstamp')),
  ]);
  const notes = await Promise.all(noteKeys.map((k) => readJSON(ctx, k)));
  const statusEntries = await Promise.all(statusKeys.map((k) => readJSON(ctx, k)));
  const statuses = {};
  statusKeys.forEach((k, i) => {
    if (statusEntries[i]) statuses[k.slice(k.lastIndexOf('/') + 1)] = statusEntries[i];
  });
  return {
    stamp: stamp ? stamp.stamp : '',
    comments: notes.filter(Boolean).sort((a, b) => a.at - b.at),
    statuses,
  };
}

async function touchReview(id, ctx) {
  await ctx.storage.setJSON(keyFor(id, 'reviewstamp'), { stamp: randomId(9) });
}

async function createBoard(req, ctx) {
  const denied = checkAccessCode(req.headers, ctx.env);
  if (denied) return denied;
  const body = req.body || {};
  const project = body.project;
  if (!validProject(project)) return error(400, 'That board is empty or too large to share.');

  const id = randomId(9);
  const editKey = randomId(18);
  const reviewKeyValue = randomId(18);
  const now = Date.now();
  const meta = {
    id,
    createdAt: now,
    editHash: hashKey(editKey),
    reviewHash: hashKey(reviewKeyValue),
    // Kept so any editor can share the review link later. It only grants
    // what the link itself grants: reading and commenting.
    reviewKey: reviewKeyValue,
  };
  const title = clip(project.title || 'Untitled Board', 90);
  await ctx.storage.setJSON(keyFor(id, 'doc'), { version: 1, project });
  await ctx.storage.setJSON(keyFor(id, 'head'), { version: 1, title, updatedAt: now });
  await ctx.storage.setJSON(keyFor(id, 'reviewstamp'), { stamp: randomId(9) });
  // Whoever shares the board starts out holding the editor seat.
  const clientId = clip(body.clientId, 64);
  if (clientId) {
    await ctx.storage.setJSON(keyFor(id, 'lease'), {
      clientId,
      name: clip(body.name || 'Someone', 40),
      until: now + LEASE_MS,
    });
  }
  const created = await ctx.storage.setJSON(keyFor(id, 'meta'), meta, { onlyIfNew: true });
  if (!created.modified) return error(409, 'Could not create the board. Try again.');
  return json(201, {
    id,
    editKey,
    reviewKey: reviewKeyValue,
    meta: await boardState(id, meta, 'edit', ctx),
  });
}

async function getBoard(id, req, ctx) {
  const { fail, meta, role } = await openBoard(id, req, ctx);
  if (fail) return fail;
  const state = await boardState(id, meta, role, ctx);
  const out = { meta: state };

  const since = Number(req.query.since);
  if (!(since >= state.version)) {
    const doc = await readJSON(ctx, keyFor(id, 'doc'));
    out.project = doc ? doc.project : null;
    out.version = doc ? doc.version : state.version;
  }
  if (req.query.rstamp === undefined || req.query.rstamp !== state.reviewStamp) {
    out.review = await readReview(id, ctx);
  }
  return json(200, out);
}

async function saveBoard(id, req, ctx) {
  const { fail, meta, role } = await openBoard(id, req, ctx);
  if (fail) return fail;
  if (role !== 'edit') return error(403, 'This link can review the board but not edit it.');
  const body = req.body || {};
  const lease = await readLease(ctx, id);
  if (!lease || lease.clientId !== body.clientId) {
    return error(409, 'Someone else is editing this board now.', {
      code: 'lease',
      meta: await boardState(id, meta, role, ctx),
    });
  }
  const head = await readJSON(ctx, keyFor(id, 'head'));
  const current = head ? head.version : 1;
  if (Number(body.baseVersion) !== current) {
    return error(409, 'The board changed since you loaded it.', {
      code: 'stale',
      meta: await boardState(id, meta, role, ctx),
    });
  }
  if (!validProject(body.project)) return error(400, 'That board is empty or too large to save.');

  const version = current + 1;
  const title = clip(body.project.title || 'Untitled Board', 90);
  // Doc first, then head: a poll that sees the new head always finds the
  // board it describes.
  await ctx.storage.setJSON(keyFor(id, 'doc'), { version, project: body.project });
  await ctx.storage.setJSON(keyFor(id, 'head'), { version, title, updatedAt: Date.now() });
  return json(200, { version, meta: await boardState(id, meta, role, ctx) });
}

async function deleteBoard(id, req, ctx) {
  const { fail, role } = await openBoard(id, req, ctx);
  if (fail) return fail.status === 404 ? json(200, { deleted: true }) : fail;
  if (role !== 'edit') return error(403, 'Only someone with the edit link can delete this board.');
  // Meta first, so the links stop working even if a later delete fails.
  await ctx.storage.remove(keyFor(id, 'meta'));
  const keys = await ctx.storage.list(`boards/${id}/`);
  await Promise.all(keys.map((k) => ctx.storage.remove(k)));
  return json(200, { deleted: true });
}

/* One editor at a time. The seat is a lease the editor's page renews every
   few seconds; if the page closes it lapses on its own. Anyone with the edit
   link can take the seat over — the previous editor's page sees that on its
   next poll and drops to read-only. */
async function lease(id, req, ctx) {
  const { fail, meta, role } = await openBoard(id, req, ctx);
  if (fail) return fail;
  if (role !== 'edit') return error(403, 'This link can review the board but not edit it.');
  const body = req.body || {};
  const clientId = clip(body.clientId, 64);
  if (!clientId) return error(400, 'Missing client id.');

  const current = await readLease(ctx, id);
  if (body.release) {
    if (current && current.clientId === clientId) await ctx.storage.remove(keyFor(id, 'lease'));
  } else if (current && current.clientId !== clientId && !body.takeover) {
    return error(409, `${current.name} is editing this board.`, {
      code: 'lease',
      meta: await boardState(id, meta, role, ctx),
    });
  } else {
    await ctx.storage.setJSON(keyFor(id, 'lease'), {
      clientId,
      name: clip(body.name || 'Someone', 40),
      until: Date.now() + LEASE_MS,
    });
  }
  return json(200, { meta: await boardState(id, meta, role, ctx) });
}

async function review(id, req, ctx) {
  const { fail, role } = await openBoard(id, req, ctx);
  if (fail) return fail;
  const op = req.body || {};
  const author = clip(op.name || 'Someone', 40);
  const clientId = clip(op.clientId, 64);

  if (op.op === 'comment') {
    const panelId = String(op.panelId || '');
    const text = clip(op.text, 1000).trim();
    if (!PANEL_ID_RE.test(panelId) || !text) return error(400, 'Write a note first.');
    const existing = await ctx.storage.list(keyFor(id, 'notes/'));
    if (existing.length >= MAX_COMMENTS) return error(400, 'This board has too many notes.');
    const at = Date.now();
    const noteId = `${at.toString(36)}-${randomId(6)}`;
    await ctx.storage.setJSON(keyFor(id, `notes/${noteId}`), {
      id: noteId,
      panelId,
      author,
      clientId,
      text,
      at,
      resolved: false,
    });
  } else if (op.op === 'resolve' || op.op === 'delete') {
    const noteId = String(op.commentId || '');
    if (!NOTE_ID_RE.test(noteId)) return error(400, 'That note is gone.');
    const key = keyFor(id, `notes/${noteId}`);
    const note = await readJSON(ctx, key);
    if (!note) return error(404, 'That note is gone.');
    if (op.op === 'resolve') {
      await ctx.storage.setJSON(key, { ...note, resolved: Boolean(op.resolved) });
    } else {
      // Your own notes, or anyone's if you hold the edit link.
      if (role !== 'edit' && note.clientId !== clientId) {
        return error(403, 'You can only delete your own notes.');
      }
      await ctx.storage.remove(key);
    }
  } else if (op.op === 'status') {
    const panelId = String(op.panelId || '');
    if (!PANEL_ID_RE.test(panelId)) return error(400, 'No panel given.');
    const key = keyFor(id, `status/${panelId}`);
    if (STATUSES.includes(op.status)) {
      await ctx.storage.setJSON(key, { status: op.status, by: author, at: Date.now() });
    } else {
      await ctx.storage.remove(key);
    }
  } else {
    return error(400, 'Unknown review action.');
  }

  await touchReview(id, ctx);
  return json(200, { review: await readReview(id, ctx) });
}

/* ---------------- Feedback ---------------- */

/* The page posts feedback to Netlify Forms first; this is where it lands when
   form detection is off or the app runs somewhere else. */
async function feedback(req, ctx) {
  const body = req.body || {};
  const message = clip(body.message, 4000).trim();
  if (!message) return error(400, 'Write something first.');
  const entry = {
    at: new Date().toISOString(),
    message,
    email: clip(body.email, 120),
    kind: clip(body.kind, 20),
    page: clip(body.page, 300),
  };
  await ctx.storage.setJSON(`feedback/${Date.now()}-${randomId(4)}`, entry);
  return json(201, { ok: true });
}

/* ---------------- Router ---------------- */

async function handleApi(req, ctx) {
  const method = (req.method || 'GET').toUpperCase();
  const parts = (req.path || '').replace(/\/+$/, '').split('/').filter(Boolean); // ['api', ...]
  if (parts[0] !== 'api') return error(404, 'Not found');
  const [, resource, id, action] = parts;

  try {
    if (resource === 'status' && method === 'GET') {
      return json(200, {
        ...describeBackend(ctx.env),
        collab: Boolean(ctx.storage),
        accessCode: Boolean((ctx.env.BETA_ACCESS_CODE || '').trim()),
        jobs: Boolean(ctx.startJob),
      });
    }
    if (resource === 'generate' && !id) {
      if (method === 'POST') return await postGenerate(req, ctx);
      if (method === 'GET' && req.query.job) return await getJob(req, ctx);
      return error(405, 'Method not allowed');
    }
    if (resource === 'raster' && id && method === 'GET') return await getRaster(id, ctx);
    if (resource === 'feedback' && !id && method === 'POST' && ctx.storage) {
      return await feedback(req, ctx);
    }

    if (resource === 'boards') {
      if (!ctx.storage) return error(501, 'Shared boards are not available on this server.');
      if (!id) {
        return method === 'POST' ? await createBoard(req, ctx) : error(405, 'Method not allowed');
      }
      if (!ID_RE.test(id)) return error(404, 'No such board.');
      if (!action) {
        if (method === 'GET') return await getBoard(id, req, ctx);
        if (method === 'PUT') return await saveBoard(id, req, ctx);
        if (method === 'DELETE') return await deleteBoard(id, req, ctx);
        return error(405, 'Method not allowed');
      }
      if (action === 'lease' && method === 'POST') return await lease(id, req, ctx);
      if (action === 'review' && method === 'POST') return await review(id, req, ctx);
    }
    return error(404, 'Not found');
  } catch (err) {
    // Our own errors carry a status and a message meant for people; anything
    // else is an internal failure whose detail stays in the server log.
    if (err && err.status) return error(err.status, err.message);
    console.error(err);
    return error(500, 'Server error');
  }
}

export { handleApi, runJob };
