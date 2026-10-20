/* Transient studio state that is not part of the document: the status line,
 * which generation is running, progress through a multi-scene job, and the
 * toast queue. Kept apart from store.js because none of it is persisted or
 * undoable, and apart from React so plain modules (actions.js) can drive it.
 */

const state = {
  status: '',
  artBusy: null, // quick | sketch | art | raster
  artError: '',
  progress: null, // { label, done, total }
  building: false,
  toasts: [],
};

let tick = 0;
const listeners = new Set();

export function subscribeBus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getBusTick() {
  return tick;
}
export function getBus() {
  return state;
}

function emit() {
  tick += 1;
  listeners.forEach((fn) => fn());
}

export function setStatus(message) {
  if (state.status === (message || '')) return;
  state.status = message || '';
  emit();
}

export function setArtBusy(kind, errorText = '') {
  state.artBusy = kind || null;
  state.artError = errorText || '';
  emit();
}

export function setProgress(progress) {
  state.progress = progress;
  emit();
}

export function setBuilding(building) {
  state.building = Boolean(building);
  emit();
}

/* ---------------- Toasts ---------------- */

let toastId = 0;
const timers = new Map();

/* toast(message, { type: 'info' | 'success' | 'error', ms, action: { label, run } }) */
export function toast(message, options = {}) {
  const opts = typeof options === 'number' ? { ms: options } : options;
  const id = ++toastId;
  const entry = {
    id,
    message,
    type: opts.type || 'info',
    action: opts.action || null,
  };
  state.toasts = [...state.toasts.slice(-2), entry];
  emit();
  const ms = opts.ms || (entry.action ? 6000 : entry.type === 'error' ? 5200 : 2800);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
  return id;
}

export function dismissToast(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!state.toasts.some((t) => t.id === id)) return;
  state.toasts = state.toasts.filter((t) => t.id !== id);
  emit();
}
