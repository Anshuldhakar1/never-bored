/* The document model and everything that mutates it.
 *
 * Shape: Project → Sequences → Scenes → Panels → Layers. That nesting is the
 * whole reason the rewrite exists — the previous version had one flat array of
 * shots, which is fine for a single scene and falls apart the moment you board
 * anything with structure.
 *
 * A panel owns its artwork as a stack of layers, its timing in frames, and an
 * optional camera move. Drawing, stick-figure sketch and generated line art
 * are all vector markup. The one exception is a rendered image layer, which
 * holds a checked image URL (never markup) and is always made from the
 * panel's vector art.
 *
 * Mutation goes through commit() so that undo, autosave and re-render all
 * happen together. Reaching into the object returned by getProject() and
 * changing it directly will paint the screen but lose the change on reload and
 * leave a hole in the undo stack.
 */

import { ASPECT_RATIOS, VALID_SHOT_TYPES } from './vocab.js';
import { sanitizeSvgMarkup, isSafeRasterSrc } from './svgsafe.js';

const STORAGE_KEY = 'neverBored.project.v2';
const LEGACY_KEY = 'neverBored.v1';
const SETTINGS_KEY = 'neverBored.settings.v1';
const UNDO_LIMIT = 60;
const COALESCE_MS = 600;
const SAVE_DEBOUNCE_MS = 400;
const MAX_SAVE_DELAY = 2000;

let uid = 0;
export function newId(prefix = 'x') {
  uid += 1;
  return `${prefix}${Date.now().toString(36)}${uid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

/* ---------------- Factories ---------------- */

export function makeLayer(overrides = {}) {
  return {
    id: newId('l'),
    name: 'Layer',
    // 'art' hand-drawn | 'sketch' stick figures | 'ai' generated line art |
    // 'raster' rendered image (src, no svg)
    kind: 'art',
    visible: true,
    locked: false,
    opacity: 1,
    svg: '',
    ...overrides,
  };
}

export function makePanel(overrides = {}) {
  return {
    id: newId('p'),
    shotType: 'MEDIUM',
    angle: 'EYE-LEVEL',
    lens: 'NORMAL',
    movement: 'STATIC',
    transition: 'CUT',
    action: '',
    dialogue: '',
    notes: '',
    durationFrames: 48,
    layers: [makeLayer({ name: 'Art', kind: 'art' })],
    camera: {
      enabled: false,
      start: { x: 0, y: 0, zoom: 1 },
      end: { x: 0, y: 0, zoom: 1 },
      easing: 'ease-in-out',
    },
    ...overrides,
  };
}

export function makeScene(overrides = {}) {
  return {
    id: newId('s'),
    name: 'Scene 1',
    slug: '',
    // The screenplay text of this scene, when it came from an imported script.
    scriptText: '',
    panels: [makePanel()],
    ...overrides,
  };
}

export function makeSequence(overrides = {}) {
  return {
    id: newId('q'),
    name: 'Sequence 1',
    scenes: [makeScene()],
    ...overrides,
  };
}

export function makeProject(overrides = {}) {
  const seq = makeSequence();
  return {
    id: newId('proj'),
    title: 'Untitled Board',
    aspect: '16:9',
    fps: 24,
    scene: '',
    artStyle: 'storyboard',
    sequences: [seq],
    ...overrides,
  };
}

/* ---------------- Live state ---------------- */

let project = makeProject();
let ui = {
  sequenceId: null,
  sceneId: null,
  panelId: null,
  layerId: null,
  tool: 'brush',
  brushColor: '#1B1400',
  brushWidth: 4,
  onionSkin: false,
  showCamera: true,
  showGuides: false,
  playing: false,
  playheadFrame: 0,
  stageZoom: 1,
  migrationNote: null,
};

let undoStack = [];
let redoStack = [];
/* Shared boards are edited by one person at a time; everyone else sees a
   live, read-only copy. commit() is the choke point, so the guard lives here
   rather than in every control. */
let editable = true;
/* Where the board is saved. null = this browser's localStorage; a cloud board
   installs a hook that pushes changes to the server instead. */
let persistence = null;
/* Bumped on every document change (not on selection or view changes), so a
   save hook can tell whether there is anything new to write. */
let revision = 0;
let lastCoalesce = { key: null, at: 0 };
const listeners = new Set();

export function getProject() {
  return project;
}
export function getUI() {
  return ui;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let notifyQueued = false;
/* Bumped once per delivered notification. React reads it as the snapshot for
   useSyncExternalStore, so every pane re-renders off one coalesced tick. */
let tick = 0;
export function getTick() {
  return tick;
}
function notify() {
  // Coalesced to one paint per frame: a single commit can touch the navigator,
  // stage, timeline and inspector, and they should not each trigger a reflow.
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    tick += 1;
    listeners.forEach((fn) => fn());
  });
}

/* Selection and view changes. Not undoable — nobody expects ctrl-Z to move the
   playhead back — but still persisted so a reload reopens the same panel. */
export function update(mutate) {
  mutate(ui);
  scheduleSave();
  notify();
}

/* Document changes. Pushes an undo entry, saves, re-renders.
   coalesceKey groups a burst of related edits (a slider drag, one brush
   stroke) into a single undo step. */
export function isEditable() {
  return editable;
}
export function setEditable(next) {
  editable = Boolean(next);
  notify();
}

export function setPersistence(hook) {
  persistence = hook || null;
}

export function getRevision() {
  return revision;
}

export function commit(mutate, { coalesceKey = null } = {}) {
  if (!editable) return false;
  const now = Date.now();
  const coalescing =
    coalesceKey !== null && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < COALESCE_MS;

  if (!coalescing) {
    undoStack.push(clone(project));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }
  lastCoalesce = { key: coalesceKey, at: now };

  mutate(project);
  revision += 1;
  scheduleSave();
  notify();
  return true;
}

export function canUndo() {
  return editable && undoStack.length > 0;
}
export function canRedo() {
  return editable && redoStack.length > 0;
}

export function undo() {
  if (!editable || !undoStack.length) return false;
  redoStack.push(clone(project));
  project = undoStack.pop();
  revision += 1;
  lastCoalesce = { key: null, at: 0 };
  reconcileSelection();
  scheduleSave();
  notify();
  return true;
}

export function redo() {
  if (!editable || !redoStack.length) return false;
  undoStack.push(clone(project));
  project = redoStack.pop();
  revision += 1;
  lastCoalesce = { key: null, at: 0 };
  reconcileSelection();
  scheduleSave();
  notify();
  return true;
}

/* ---------------- Lookups ---------------- */

export function activeSequence() {
  return project.sequences.find((s) => s.id === ui.sequenceId) || project.sequences[0] || null;
}

export function activeScene() {
  const seq = activeSequence();
  if (!seq) return null;
  return seq.scenes.find((s) => s.id === ui.sceneId) || seq.scenes[0] || null;
}

export function activePanel() {
  const scene = activeScene();
  if (!scene) return null;
  return scene.panels.find((p) => p.id === ui.panelId) || scene.panels[0] || null;
}

export function activeLayer() {
  const panel = activePanel();
  if (!panel) return null;
  return panel.layers.find((l) => l.id === ui.layerId) || panel.layers[0] || null;
}

/* Every panel in the project in reading order, each tagged with the scene and
   sequence it belongs to. The timeline, playback and export all walk this. */
export function allPanels() {
  const out = [];
  project.sequences.forEach((seq) => {
    seq.scenes.forEach((scene) => {
      scene.panels.forEach((panel) => {
        out.push({ panel, scene, sequence: seq });
      });
    });
  });
  return out;
}

export function findPanel(panelId) {
  return allPanels().find((entry) => entry.panel.id === panelId) || null;
}

export function panelNumber(panelId) {
  return allPanels().findIndex((entry) => entry.panel.id === panelId) + 1;
}

export function totalFrames() {
  return allPanels().reduce((sum, e) => sum + Math.max(1, e.panel.durationFrames), 0);
}

export function aspect() {
  return ASPECT_RATIOS.find((a) => a.key === project.aspect) || ASPECT_RATIOS[0];
}

/* Panel whose span contains a given frame, plus where that frame sits inside
   it. Drives both the playhead and the camera-move preview. */
export function panelAtFrame(frame) {
  const entries = allPanels();
  let acc = 0;
  for (const entry of entries) {
    const dur = Math.max(1, entry.panel.durationFrames);
    if (frame < acc + dur) {
      return { ...entry, startFrame: acc, localFrame: frame - acc, progress: (frame - acc) / dur };
    }
    acc += dur;
  }
  const last = entries[entries.length - 1];
  return last ? { ...last, startFrame: acc, localFrame: 0, progress: 1 } : null;
}

export function frameOfPanel(panelId) {
  let acc = 0;
  for (const entry of allPanels()) {
    if (entry.panel.id === panelId) return acc;
    acc += Math.max(1, entry.panel.durationFrames);
  }
  return 0;
}

/* Counts explicit panel selections. Playback uses it to tell "the playhead is
   still where you paused or scrubbed" from "you went elsewhere and came back
   to the same frame" — comparing frame numbers alone can't. */
let selectionEpoch = 0;
export function getSelectionEpoch() {
  return selectionEpoch;
}

export function selectPanel(panelId) {
  const found = findPanel(panelId);
  if (!found) return;
  selectionEpoch += 1;
  update((u) => {
    u.sequenceId = found.sequence.id;
    u.sceneId = found.scene.id;
    u.panelId = found.panel.id;
    u.layerId = drawableLayerId(found.panel);
    u.playheadFrame = frameOfPanel(panelId);
  });
}

/* New marks go on a hand-drawn layer when there is one, not into the
   generated sketch or a rendered image. */
export function drawableLayerId(panel) {
  const layer = panel.layers.find((l) => l.kind === 'art') || panel.layers[0];
  return layer ? layer.id : null;
}

/* Keeps the selection pointing at something real after an undo, a delete, or a
   restore from storage. */
function reconcileSelection() {
  const seq = project.sequences.find((s) => s.id === ui.sequenceId) || project.sequences[0];
  ui.sequenceId = seq ? seq.id : null;
  const scene = seq && (seq.scenes.find((s) => s.id === ui.sceneId) || seq.scenes[0]);
  ui.sceneId = scene ? scene.id : null;
  const panel = scene && (scene.panels.find((p) => p.id === ui.panelId) || scene.panels[0]);
  ui.panelId = panel ? panel.id : null;
  const layer = panel && panel.layers.find((l) => l.id === ui.layerId);
  ui.layerId = layer ? layer.id : panel ? drawableLayerId(panel) : null;
  const total = totalFrames();
  if (ui.playheadFrame >= total) ui.playheadFrame = Math.max(0, total - 1);
}

/* ---------------- Persistence ---------------- */

let saveTimer = null;
let pendingSince = 0;
let storageFull = false;
/* The document revision last written to this browser, so the top bar can say
   honestly whether the board on screen is saved. */
let savedRevision = 0;

export function getSaveInfo() {
  if (persistence) return { target: 'cloud', dirty: false, failed: false };
  return { target: 'local', dirty: revision !== savedRevision, failed: storageFull };
}

/* Debounced, but with a ceiling. A plain debounce is starved by continuous
   work — drawing stroke after stroke pushes the timer out every time, so the
   write never lands and closing the tab loses everything since the last quiet
   moment. Past MAX_SAVE_DELAY the write happens regardless. */
function scheduleSave() {
  const now = Date.now();
  if (!pendingSince) pendingSince = now;
  if (now - pendingSince >= MAX_SAVE_DELAY) {
    saveNow();
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  pendingSince = 0;
  if (persistence) {
    persistence.save(project);
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        project,
        ui: {
          sequenceId: ui.sequenceId,
          sceneId: ui.sceneId,
          panelId: ui.panelId,
          layerId: ui.layerId,
          onionSkin: ui.onionSkin,
          showCamera: ui.showCamera,
          showGuides: ui.showGuides,
          stageZoom: ui.stageZoom,
        },
      }),
    );
    storageFull = false;
    if (savedRevision !== revision) {
      savedRevision = revision;
      notify();
    }
  } catch {
    /* Quota, private browsing, storage disabled — autosave is best-effort and
       must never take the app down with it. But a silent failure loses work,
       so the UI is told once. */
    if (!storageFull) {
      storageFull = true;
      window.dispatchEvent(new CustomEvent('neverbored:storagefull'));
      notify();
    }
  }
}

/* Anything read back from storage is treated exactly like a fresh model
   response: another script on this origin can write to localStorage, so
   stored layer markup is re-sanitised before it is ever mounted. */
function reviveProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.sequences) || raw.sequences.length === 0) return null;

  const base = makeProject();
  const revived = {
    ...base,
    ...raw,
    sequences: raw.sequences.map((seq) => ({
      id: seq.id || newId('q'),
      name: String(seq.name || 'Sequence'),
      scenes: (Array.isArray(seq.scenes) ? seq.scenes : []).map((scene) => ({
        id: scene.id || newId('s'),
        name: String(scene.name || 'Scene'),
        slug: String(scene.slug || ''),
        scriptText: String(scene.scriptText || '').slice(0, 20000),
        panels: (Array.isArray(scene.panels) ? scene.panels : []).map(revivePanel),
      })),
    })),
  };
  if (!revived.sequences.some((s) => s.scenes.some((sc) => sc.panels.length))) return null;
  return revived;
}

function revivePanel(raw) {
  const base = makePanel();
  const layers = Array.isArray(raw.layers) && raw.layers.length ? raw.layers : base.layers;
  return {
    ...base,
    ...raw,
    id: raw.id || newId('p'),
    shotType: VALID_SHOT_TYPES.includes(raw.shotType) ? raw.shotType : base.shotType,
    durationFrames: Number.isFinite(raw.durationFrames)
      ? Math.max(1, Math.round(raw.durationFrames))
      : base.durationFrames,
    cast: (Array.isArray(raw.cast) ? raw.cast : []).map((c) => String(c).slice(0, 40)).slice(0, 6),
    layers: layers.map((l) => {
      const layer = {
        ...makeLayer(),
        ...l,
        id: l.id || newId('l'),
        svg: l.kind === 'raster' ? '' : sanitizeSvgMarkup(l.svg || ''),
      };
      // A raster layer only ever points at our own image store or inline image
      // data — never an arbitrary URL from storage.
      if (layer.kind === 'raster') layer.src = isSafeRasterSrc(l.src) ? l.src : '';
      else delete layer.src;
      return layer;
    }),
    camera: { ...base.camera, ...(raw.camera || {}) },
  };
}

/* Exported so a board arriving from the server goes through exactly the same
   checks as one read back from localStorage. */
export function reviveProjectData(raw) {
  return reviveProject(raw);
}

/* The previous version stored one flat board of shots with a PNG sketch per
   shot. Shot data carries over cleanly; the sketches cannot — they are raster,
   and this app is vector end to end. Rather than silently dropping them, the
   migration records a note the UI surfaces once. */
function migrateLegacy() {
  let legacy;
  try {
    const rawText = localStorage.getItem(LEGACY_KEY);
    if (!rawText) return null;
    legacy = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!legacy || !Array.isArray(legacy.board) || legacy.board.length === 0) return null;

  const panels = legacy.board.map((shot) =>
    makePanel({
      shotType: VALID_SHOT_TYPES.includes(shot.shotType) ? shot.shotType : 'MEDIUM',
      angle: shot.angle || 'EYE-LEVEL',
      lens: shot.lens || 'NORMAL',
      movement: shot.movement || 'STATIC',
      action: String(shot.description || '').slice(0, 400),
    }),
  );
  const droppedSketches = legacy.board.filter((s) => s.drawing).length;

  const migrated = makeProject({
    title: 'Imported from previous version',
    scene: String(legacy.scene || ''),
    sequences: [
      makeSequence({
        name: 'Sequence 1',
        scenes: [makeScene({ name: 'Scene 1', panels })],
      }),
    ],
  });
  return { project: migrated, droppedSketches };
}

export function loadInitial() {
  let restored = null;
  try {
    const rawText = localStorage.getItem(STORAGE_KEY);
    if (rawText) restored = JSON.parse(rawText);
  } catch {
    restored = null;
  }

  const revived = restored && reviveProject(restored.project);
  if (revived) {
    project = revived;
    savedRevision = revision;
    if (restored.ui && typeof restored.ui === 'object') Object.assign(ui, restored.ui);
    reconcileSelection();
    return { restored: true };
  }

  const legacy = migrateLegacy();
  if (legacy) {
    project = legacy.project;
    reconcileSelection();
    ui.migrationNote =
      legacy.droppedSketches > 0
        ? `Carried over ${legacy.project.sequences[0].scenes[0].panels.length} shots from the previous version. ${legacy.droppedSketches} pencil sketch${legacy.droppedSketches === 1 ? ' was' : 'es were'} left behind — the old sketches are bitmap and panels are vector now.`
        : `Carried over ${legacy.project.sequences[0].scenes[0].panels.length} shots from the previous version.`;
    saveNow();
    return { restored: true, migrated: true };
  }

  reconcileSelection();
  return { restored: false };
}

/* Last line of defence: flush whatever is still pending as the page goes away.
   pagehide fires on close, reload and bfcache navigation, where beforeunload
   is unreliable on mobile. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
}

export function replaceProject(next, { resetHistory = false } = {}) {
  if (resetHistory) undoStack = [];
  else undoStack.push(clone(project));
  redoStack = [];
  project = next;
  revision += 1;
  reconcileSelection();
  saveNow();
  notify();
}

/* A teammate's change arriving from the server: not an edit of ours, so no
   undo entry and nothing to save back. */
export function applyRemoteProject(next) {
  project = next;
  revision += 1;
  undoStack = [];
  redoStack = [];
  reconcileSelection();
  notify();
}

/* The board kept in this browser, for returning to it after a shared one. */
export function loadLocalProject() {
  try {
    const restored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return (restored && reviveProject(restored.project)) || null;
  } catch {
    return null;
  }
}

export function resetProject() {
  replaceProject(makeProject());
}

/* ---------------- API settings ----------------
   Key and endpoint live in this browser only. They are never written into the
   project, never sent to this page's own host, and never reach an export. */
export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* best-effort only */
  }
}
