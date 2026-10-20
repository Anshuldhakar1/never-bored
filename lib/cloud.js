/* Shared boards: one person edits, everyone else follows live and reviews.
 *
 * A board is shared by uploading it to /api/boards, which hands back two
 * links. Both carry a key in the URL #fragment (never sent to the server in a
 * request line or a Referer):
 *   edit link   — can edit, one person at a time, and can review
 *   review link — can watch live, comment on panels and approve them
 *
 * Editing is single-seat. The editor's page holds a short lease it keeps
 * renewing; everyone else is read-only and polls for new versions. Anyone with
 * the edit link can take the seat over, and the previous editor's page drops
 * to read-only on its next poll. That avoids merging two people's brush
 * strokes, which a storyboard tool has no sensible way to do.
 *
 * Review notes and approvals are stored apart from the board itself, so a
 * reviewer never needs the seat and never conflicts with the editor.
 *
 * While a shared board is open the store's persistence hook points here, so
 * edits go to the server instead of this browser's localStorage. The board
 * kept in localStorage is untouched and comes back on leaving.
 */

import {
  getProject,
  getRevision,
  setPersistence,
  setEditable,
  applyRemoteProject,
  reviveProjectData,
  replaceProject,
  loadLocalProject,
  makeProject,
  loadSettings,
  newId,
} from './store.js';
import { resetPlayback } from './stage.js';

const BOARDS_KEY = 'neverBored.boards.v1';
const NAME_KEY = 'neverBored.name.v1';
const AUTHOR_KEY = 'neverBored.author.v1';
const POLL_MS = 4000;
const POLL_HIDDEN_MS = 20000;
const LEASE_RENEW_MS = 25000;
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 5000;

/* The editor seat belongs to this tab; review notes to this browser, so you
   can still delete your own note after a reload. */
const TAB_ID = newId('c');
const AUTHOR_ID = (() => {
  try {
    let id = localStorage.getItem(AUTHOR_KEY);
    if (!id) {
      id = newId('a');
      localStorage.setItem(AUTHOR_KEY, id);
    }
    return id;
  } catch {
    return newId('a');
  }
})();

let caps = null;
let session = null;
const listeners = new Set();
let noticeHandler = () => {};

export function onCloudChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onCloudNotice(fn) {
  noticeHandler = fn;
}
/* Bumped on every change, as the React snapshot for the shared-board state. */
let cloudTick = 0;
export function getCloudTick() {
  return cloudTick;
}
/* 'full' when the board, the seat or the review changed; 'status' when only
   the save indicator did, which needs no more than the share bar redrawn. */
function emit(kind = 'full') {
  cloudTick += 1;
  listeners.forEach((fn) => fn(kind));
}

/* What the page shows about a session. Polls that change none of it (a lease
   renewed, nothing new) stay silent, so the panes are not rebuilt under
   someone's cursor every few seconds. */
function visibleState(s) {
  const lease = s.meta && s.meta.lease;
  return JSON.stringify([
    s.editing,
    s.gone,
    s.saveState,
    s.reviewStamp,
    s.meta && s.meta.title,
    lease ? [lease.clientId, lease.name] : null,
  ]);
}

/* ---------------- Server capabilities ---------------- */

/* A static host answers /api/status with its own 404 page, which is how the
   page learns there is no server to share through. */
export async function loadCaps() {
  try {
    const resp = await fetch('/api/status', { cache: 'no-store' });
    caps = resp.ok ? await resp.json() : {};
  } catch {
    caps = {};
  }
  emit();
  return caps;
}
export function serverCaps() {
  return caps || {};
}

/* ---------------- Identity ---------------- */

export function getName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}
export function setName(name) {
  try {
    localStorage.setItem(NAME_KEY, String(name).trim().slice(0, 40));
  } catch {
    /* best-effort */
  }
  emit();
}
export function authorId() {
  return AUTHOR_ID;
}

/* ---------------- Boards this browser has opened ---------------- */

export function myBoards() {
  try {
    const list = JSON.parse(localStorage.getItem(BOARDS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((b) => b && b.id && b.key) : [];
  } catch {
    return [];
  }
}
function rememberBoard(entry) {
  const list = myBoards().filter((b) => b.id !== entry.id);
  list.unshift({ ...entry, openedAt: Date.now() });
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* best-effort */
  }
}
export function forgetBoard(id) {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(myBoards().filter((b) => b.id !== id)));
  } catch {
    /* best-effort */
  }
  emit();
}

/* ---------------- Links ---------------- */

const LINK_RE = /^#?board=([A-Za-z0-9_-]{8,40})&key=([A-Za-z0-9_-]{8,80})$/;

export function parseBoardHash(hash) {
  const m = LINK_RE.exec(hash || '');
  return m ? { id: m[1], key: m[2] } : null;
}
function linkFor(id, key) {
  return `${location.origin}${location.pathname}#board=${id}&key=${key}`;
}

/* ---------------- Requests ---------------- */

async function api(path, { method = 'GET', body, key, keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['x-board-key'] = key;
  const code = (loadSettings().accessCode || '').trim();
  if (code) headers['x-access-code'] = code;
  const resp = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `Request failed (${resp.status})`);
    err.status = resp.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

/* ---------------- Session ---------------- */

export function currentBoard() {
  if (!session) return null;
  const meta = session.meta || {};
  return {
    id: session.id,
    title: meta.title || getProject().title,
    role: session.role,
    editing: session.editing,
    lease: meta.lease || null,
    saveState: session.saveState,
    gone: session.gone,
  };
}

export function boardLinks() {
  if (!session) return { edit: null, review: null };
  const reviewKey =
    session.role === 'review' ? session.key : session.meta && session.meta.reviewKey;
  return {
    edit: session.role === 'edit' ? linkFor(session.id, session.key) : null,
    review: reviewKey ? linkFor(session.id, reviewKey) : null,
  };
}

function teardown() {
  if (!session) return;
  clearTimeout(session.pollTimer);
  clearTimeout(session.saveTimer);
  clearTimeout(session.leaseTimer);
  session.closed = true;
  session = null;
}

function applyProject(data) {
  const project = reviveProjectData(data.project);
  if (!project) return false;
  applyRemoteProject(project);
  session.version = data.version;
  session.lastSavedRevision = getRevision();
  return true;
}

export async function openSharedBoard(id, key) {
  const data = await api(`/api/boards/${id}`, { key });
  const project = reviveProjectData(data.project);
  if (!project) throw new Error('This board could not be read.');

  teardown();
  session = {
    id,
    key,
    role: data.meta.role,
    meta: data.meta,
    version: data.version,
    reviewStamp: data.review ? data.review.stamp : data.meta.reviewStamp,
    review: data.review || { stamp: '', comments: [], statuses: {} },
    editing: false,
    saveState: 'saved',
    lastSavedRevision: 0,
    gone: false,
  };
  setEditable(false);
  setPersistence({ save: scheduleSave });
  applyRemoteProject(project);
  // A different board is on screen now: Play starts from its beginning.
  resetPlayback();
  session.lastSavedRevision = getRevision();
  rememberBoard({ id, key, role: session.role, title: data.meta.title });

  if (session.role === 'edit') await claimSeat(false);
  schedulePoll();
  emit();
  return currentBoard();
}

/* Uploads the board on screen as a new shared board and switches to it. */
export async function shareCurrentBoard() {
  const project = getProject();
  const data = await api('/api/boards', {
    method: 'POST',
    body: { project, clientId: TAB_ID, name: getName() || 'Someone' },
  });
  rememberBoard({ id: data.id, key: data.editKey, role: 'edit', title: project.title });
  history.replaceState(null, '', `#board=${data.id}&key=${data.editKey}`);
  await openSharedBoard(data.id, data.editKey);
  return boardLinks();
}

/* Back to the board kept in this browser. */
export function leaveSharedBoard() {
  if (!session) return;
  if (session.editing) {
    // Hand the seat back now rather than leaving others waiting for it to lapse.
    api(`/api/boards/${session.id}/lease`, {
      method: 'POST',
      key: session.key,
      body: { clientId: TAB_ID, release: true },
    }).catch(() => {});
  }
  teardown();
  setPersistence(null);
  setEditable(true);
  replaceProject(loadLocalProject() || makeProject(), { resetHistory: true });
  resetPlayback();
  history.replaceState(null, '', location.pathname + location.search);
  emit();
}

export async function deleteSharedBoard() {
  if (!session || session.role !== 'edit') return;
  const id = session.id;
  await api(`/api/boards/${id}`, { method: 'DELETE', key: session.key });
  forgetBoard(id);
  leaveSharedBoard();
}

/* ---------------- The editor seat ---------------- */

async function claimSeat(takeover) {
  if (!session || session.role !== 'edit') return false;
  const s = session;
  try {
    const data = await api(`/api/boards/${s.id}/lease`, {
      method: 'POST',
      key: s.key,
      body: { clientId: TAB_ID, name: getName() || 'Someone', takeover },
    });
    if (s.closed) return false;
    s.meta = data.meta;
    if (!s.editing) {
      // Start from exactly what the last editor saved.
      const fresh = await api(`/api/boards/${s.id}`, { key: s.key });
      if (s.closed) return false;
      applyProject(fresh);
      s.meta = fresh.meta;
      s.editing = true;
      setEditable(true);
    }
    clearTimeout(s.leaseTimer);
    s.leaseTimer = setTimeout(() => renewSeat(), LEASE_RENEW_MS);
    emit();
    return true;
  } catch (err) {
    if (s.closed) return false;
    if (err.status === 409 && err.data.meta) s.meta = err.data.meta;
    if (!takeover && err.status === 409) {
      s.editing = false;
      setEditable(false);
      emit();
      return false;
    }
    throw err;
  }
}

async function renewSeat() {
  if (!session || !session.editing) return;
  const s = session;
  try {
    const data = await api(`/api/boards/${s.id}/lease`, {
      method: 'POST',
      key: s.key,
      body: { clientId: TAB_ID, name: getName() || 'Someone' },
    });
    if (s.closed) return;
    s.meta = data.meta;
  } catch (err) {
    if (s.closed) return;
    if (err.status === 409) {
      loseSeat(err.data.meta);
      return;
    }
  }
  clearTimeout(s.leaseTimer);
  s.leaseTimer = setTimeout(() => renewSeat(), LEASE_RENEW_MS);
}

function loseSeat(meta) {
  if (!session) return;
  if (meta) session.meta = meta;
  const wasEditing = session.editing;
  session.editing = false;
  clearTimeout(session.leaseTimer);
  setEditable(false);
  if (wasEditing) {
    const who = session.meta && session.meta.lease ? session.meta.lease.name : 'Someone';
    noticeHandler(`${who} took over editing — you are watching live now.`);
  }
  emit();
}

export async function takeOverEditing() {
  if (!session || session.role !== 'edit') return false;
  return claimSeat(true);
}

/* ---------------- Saving ---------------- */

function scheduleSave() {
  if (!session || !session.editing) return;
  if (getRevision() === session.lastSavedRevision) return;
  clearTimeout(session.saveTimer);
  session.saveState = 'pending';
  session.saveTimer = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
}

async function flushSave({ keepalive = false } = {}) {
  const s = session;
  if (!s || !s.editing) return;
  if (s.saving) {
    s.saveAgain = true;
    return;
  }
  const revision = getRevision();
  if (revision === s.lastSavedRevision) return;

  s.saving = true;
  s.saveState = 'saving';
  emit('status');
  try {
    const data = await api(`/api/boards/${s.id}`, {
      method: 'PUT',
      key: s.key,
      keepalive,
      body: { clientId: TAB_ID, baseVersion: s.version, project: getProject() },
    });
    if (s.closed) return;
    s.version = data.version;
    s.meta = data.meta;
    s.lastSavedRevision = revision;
    s.saveState = 'saved';
  } catch (err) {
    if (s.closed) return;
    if (err.status === 409 && err.data.code === 'lease') {
      loseSeat(err.data.meta);
    } else if (err.status === 409 && err.data.code === 'stale') {
      // Someone saved in between (a takeover that has since lapsed). Theirs
      // is the board of record; reload it rather than overwrite it.
      try {
        const fresh = await api(`/api/boards/${s.id}`, { key: s.key });
        if (!s.closed) applyProject(fresh);
        noticeHandler('The board changed on the server — reloaded the latest version.');
        s.saveState = 'saved';
      } catch {
        s.saveState = 'error';
      }
    } else {
      s.saveState = 'error';
      clearTimeout(s.saveTimer);
      s.saveTimer = setTimeout(() => flushSave(), SAVE_RETRY_MS);
    }
  } finally {
    s.saving = false;
    if (!s.closed) {
      if (s.saveAgain) {
        s.saveAgain = false;
        scheduleSave();
      }
      emit(s.editing ? 'status' : 'full');
    }
  }
}

/* ---------------- Following live ---------------- */

function schedulePoll() {
  if (!session) return;
  clearTimeout(session.pollTimer);
  session.pollTimer = setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
}

async function poll() {
  const s = session;
  if (!s) return;
  const before = visibleState(s);
  try {
    const data = await api(
      `/api/boards/${s.id}?since=${s.version}&rstamp=${encodeURIComponent(s.reviewStamp)}`,
      { key: s.key },
    );
    if (s.closed) return;
    s.meta = data.meta;
    if (data.review) {
      s.review = data.review;
      s.reviewStamp = data.review.stamp;
    }
    const lease = data.meta.lease;
    if (s.editing && lease && lease.clientId !== TAB_ID) {
      loseSeat(data.meta);
    } else if (s.editing && !lease) {
      // Our lease lapsed (a sleeping laptop); quietly take it back.
      claimSeat(false).catch(() => {});
    } else if (!s.editing && s.role === 'edit' && !lease) {
      // The editor left — the seat is free, so the next editor in line gets it.
      claimSeat(false).catch(() => {});
    }
    // The editor is the only writer, so it never takes the server's copy over
    // its own: that copy can be a save behind what is on screen.
    if (data.project && !s.editing && data.version > s.version) applyProject(data);
    if (visibleState(s) !== before) emit();
  } catch (err) {
    if (s.closed) return;
    if (err.status === 404 || err.status === 403) {
      s.gone = true;
      s.editing = false;
      setEditable(false);
      emit();
      return;
    }
  }
  schedulePoll();
}

document.addEventListener('visibilitychange', () => {
  if (session && !document.hidden) {
    clearTimeout(session.pollTimer);
    poll();
  }
});

window.addEventListener('pagehide', () => {
  if (!session || !session.editing) return;
  flushSave({ keepalive: true });
  api(`/api/boards/${session.id}/lease`, {
    method: 'POST',
    key: session.key,
    keepalive: true,
    body: { clientId: TAB_ID, release: true },
  }).catch(() => {});
});

/* ---------------- Review ---------------- */

export function panelReview(panelId) {
  if (!session || !session.review) return null;
  const comments = session.review.comments.filter((c) => c.panelId === panelId);
  return {
    status: session.review.statuses[panelId] || null,
    comments,
    open: comments.filter((c) => !c.resolved).length,
  };
}

export function reviewTotals() {
  if (!session || !session.review) return null;
  const statuses = Object.values(session.review.statuses);
  return {
    approved: statuses.filter((s) => s.status === 'approved').length,
    changes: statuses.filter((s) => s.status === 'changes').length,
    open: session.review.comments.filter((c) => !c.resolved).length,
  };
}

export function canDeleteComment(comment) {
  return Boolean(session) && (session.role === 'edit' || comment.clientId === AUTHOR_ID);
}

async function reviewOp(op) {
  if (!session) throw new Error('Open a shared board to review it.');
  const s = session;
  const data = await api(`/api/boards/${s.id}/review`, {
    method: 'POST',
    key: s.key,
    body: { ...op, name: getName() || 'Someone', clientId: AUTHOR_ID },
  });
  if (s.closed) return;
  s.review = data.review;
  s.reviewStamp = data.review.stamp;
  emit();
}

export const addComment = (panelId, text) => reviewOp({ op: 'comment', panelId, text });
export const setPanelStatus = (panelId, status) => reviewOp({ op: 'status', panelId, status });
export const resolveComment = (commentId, resolved) =>
  reviewOp({ op: 'resolve', commentId, resolved });
export const deleteComment = (commentId) => reviewOp({ op: 'delete', commentId });
