/* Structural edits to the board: add, duplicate, delete and move panels,
 * scenes and sequences, plus per-panel and per-layer mutation helpers.
 *
 * Everything goes through commit(), so each edit is one undo step and is
 * autosaved — and a read-only shared board refuses it at the same choke point.
 * Ported from the original panels.js; movePanelTo and deleteScene are new for
 * the drag-to-reorder timeline and the navigator's scene menu.
 */

import {
  activePanel,
  allPanels,
  commit,
  update,
  makePanel,
  makeScene,
  makeSequence,
  makeLayer,
  newId,
  selectPanel,
} from './store.js';
import { MOVING_SHOTS } from './vocab.js';

export function eachPanel(proj, fn) {
  proj.sequences.forEach((seq) =>
    seq.scenes.forEach((scene) => scene.panels.forEach((panel) => fn(panel, scene, seq))),
  );
}

function eachSceneIn(proj, fn) {
  proj.sequences.forEach((seq) => seq.scenes.forEach((scene) => fn(scene, seq)));
}

/* True when the panel has vector art a render can start from. */
export function hasVectorArt(panel) {
  return panel.layers.some((l) => l.kind !== 'raster' && l.visible && l.svg.trim());
}

export function addPanelAfter(panelId) {
  let created = null;
  commit((proj) => {
    eachSceneIn(proj, (scene) => {
      const idx = scene.panels.findIndex((p) => p.id === panelId);
      if (idx === -1) return;
      // Inherits framing from the panel it follows — boarding usually varies
      // one thing at a time, so starting from a copy beats starting blank.
      const source = scene.panels[idx];
      created = makePanel({
        shotType: source.shotType,
        angle: source.angle,
        lens: source.lens,
        durationFrames: source.durationFrames,
      });
      scene.panels.splice(idx + 1, 0, created);
    });
  });
  if (created) selectPanel(created.id);
  return created;
}

export function duplicatePanel(panelId) {
  let created = null;
  commit((proj) => {
    eachSceneIn(proj, (scene) => {
      const idx = scene.panels.findIndex((p) => p.id === panelId);
      if (idx === -1) return;
      const source = scene.panels[idx];
      created = {
        ...structuredClone(source),
        id: newId('p'),
        layers: source.layers.map((l) => ({ ...structuredClone(l), id: newId('l') })),
      };
      scene.panels.splice(idx + 1, 0, created);
    });
  });
  if (created) selectPanel(created.id);
  return created;
}

function pruneEmpty(proj) {
  // A scene with no panels left has nothing to show, so it goes too.
  proj.sequences.forEach((seq) => {
    seq.scenes = seq.scenes.filter((s) => s.panels.length > 0);
  });
  proj.sequences = proj.sequences.filter((s) => s.scenes.length > 0);
}

export function deletePanel(panelId) {
  const entries = allPanels();
  if (entries.length <= 1) return false;
  const idx = entries.findIndex((e) => e.panel.id === panelId);
  const ok = commit((proj) => {
    eachSceneIn(proj, (scene) => {
      const i = scene.panels.findIndex((p) => p.id === panelId);
      if (i !== -1) scene.panels.splice(i, 1);
    });
    pruneEmpty(proj);
  });
  if (!ok) return false;
  const remaining = allPanels();
  const next = remaining[Math.min(idx, remaining.length - 1)];
  if (next) selectPanel(next.panel.id);
  return true;
}

export function deleteScene(sceneId) {
  const entries = allPanels();
  if (entries.every((e) => e.scene.id === sceneId)) return false;
  const firstIdx = entries.findIndex((e) => e.scene.id === sceneId);
  const ok = commit((proj) => {
    proj.sequences.forEach((seq) => {
      seq.scenes = seq.scenes.filter((s) => s.id !== sceneId);
    });
    pruneEmpty(proj);
  });
  if (!ok) return false;
  const remaining = allPanels();
  const next = remaining[Math.min(Math.max(0, firstIdx), remaining.length - 1)];
  if (next) selectPanel(next.panel.id);
  return true;
}

export function movePanel(panelId, direction) {
  commit((proj) => {
    eachSceneIn(proj, (scene) => {
      const i = scene.panels.findIndex((p) => p.id === panelId);
      if (i === -1) return;
      const j = i + direction;
      if (j < 0 || j >= scene.panels.length) return;
      const [moved] = scene.panels.splice(i, 1);
      scene.panels.splice(j, 0, moved);
    });
  });
}

/* Drag and drop: lands `panelId` just before (or after) `targetId`, which may
   be in another scene. The emptied scene, if any, is pruned. */
export function movePanelTo(panelId, targetId, after = false) {
  if (panelId === targetId) return;
  commit((proj) => {
    let moved = null;
    eachSceneIn(proj, (scene) => {
      const i = scene.panels.findIndex((p) => p.id === panelId);
      if (i !== -1) [moved] = scene.panels.splice(i, 1);
    });
    if (!moved) return;
    let placed = false;
    eachSceneIn(proj, (scene) => {
      if (placed) return;
      const j = scene.panels.findIndex((p) => p.id === targetId);
      if (j === -1) return;
      scene.panels.splice(after ? j + 1 : j, 0, moved);
      placed = true;
    });
    if (!placed) {
      // Target vanished mid-drag; put it back at the end rather than lose it.
      const lastSeq = proj.sequences[proj.sequences.length - 1];
      lastSeq.scenes[lastSeq.scenes.length - 1].panels.push(moved);
    }
    pruneEmpty(proj);
  });
  selectPanel(panelId);
}

export function addScene(sequenceId) {
  let created = null;
  commit((proj) => {
    const seq = proj.sequences.find((s) => s.id === sequenceId);
    if (!seq) return;
    created = makeScene({ name: `Scene ${seq.scenes.length + 1}` });
    seq.scenes.push(created);
  });
  if (created) selectPanel(created.panels[0].id);
}

export function addSequence() {
  let created = null;
  commit((proj) => {
    created = makeSequence({ name: `Sequence ${proj.sequences.length + 1}` });
    proj.sequences.push(created);
  });
  if (created) selectPanel(created.scenes[0].panels[0].id);
}

export function renameSequence(sequenceId, name) {
  commit((proj) => {
    const t = proj.sequences.find((s) => s.id === sequenceId);
    if (t) t.name = String(name).slice(0, 80);
  });
}

export function updateScene(sceneId, fields) {
  commit((proj) => {
    eachSceneIn(proj, (s) => {
      if (s.id !== sceneId) return;
      if ('name' in fields) s.name = String(fields.name).slice(0, 80);
      if ('slug' in fields) s.slug = String(fields.slug).slice(0, 120);
    });
  });
}

/* ---------------- Per-panel edits ---------------- */

export function mutatePanelById(panelId, mutate, coalesceKey) {
  return commit(
    (proj) => {
      eachPanel(proj, (p) => {
        if (p.id === panelId) mutate(p);
      });
    },
    coalesceKey ? { coalesceKey } : {},
  );
}

export function mutateActivePanel(mutate, coalesceKey) {
  const panel = activePanel();
  if (!panel) return false;
  return mutatePanelById(panel.id, mutate, coalesceKey);
}

export function setMovement(value) {
  mutateActivePanel((p) => {
    p.movement = value;
    // A moving shot with no move set up is a dead control; seed a sensible
    // push-in so the START/END frames appear somewhere useful.
    if (MOVING_SHOTS.has(p.movement) && !p.camera.enabled) {
      p.camera.enabled = true;
      p.camera.start = { x: 0, y: 0, zoom: 1 };
      p.camera.end = { x: 0.12, y: 0.1, zoom: 0.72 };
    }
  });
}

export function setCameraEnabled(enabled) {
  mutateActivePanel((p) => {
    p.camera.enabled = enabled;
    if (
      p.camera.enabled &&
      p.camera.start.zoom === p.camera.end.zoom &&
      p.camera.start.x === p.camera.end.x
    ) {
      p.camera.end = { x: 0.12, y: 0.1, zoom: 0.72 };
    }
  });
}

export function resetCamera() {
  mutateActivePanel((p) => {
    p.camera.start = { x: 0, y: 0, zoom: 1 };
    p.camera.end = { x: 0, y: 0, zoom: 1 };
  });
}

export const clampFrames = (n) => Math.max(1, Math.min(900, Math.round(Number(n) || 1)));

export function setDuration(panelId, frames) {
  mutatePanelById(panelId, (p) => (p.durationFrames = clampFrames(frames)), `duration:${panelId}`);
}

/* ---------------- Layers ---------------- */

export function addLayer() {
  const panel = activePanel();
  if (!panel) return;
  const layer = makeLayer({ name: `Layer ${panel.layers.length + 1}` });
  if (mutatePanelById(panel.id, (p) => p.layers.push(layer))) {
    update((u) => (u.layerId = layer.id));
  }
}

function mutateLayer(panelId, layerId, mutate, coalesceKey) {
  return mutatePanelById(
    panelId,
    (p) => {
      const t = p.layers.find((l) => l.id === layerId);
      if (t) mutate(t, p);
    },
    coalesceKey,
  );
}

export const toggleLayerVisible = (panelId, layerId) =>
  mutateLayer(panelId, layerId, (l) => (l.visible = !l.visible));
export const toggleLayerLocked = (panelId, layerId) =>
  mutateLayer(panelId, layerId, (l) => (l.locked = !l.locked));
export const renameLayer = (panelId, layerId, name) =>
  mutateLayer(panelId, layerId, (l) => (l.name = String(name).slice(0, 40) || 'Layer'));
export const setLayerOpacity = (panelId, layerId, opacity) =>
  mutateLayer(
    panelId,
    layerId,
    (l) => (l.opacity = Math.min(1, Math.max(0, Number(opacity)))),
    `opacity:${layerId}`,
  );

/* Moves a layer up (towards the top of the stack) or down. */
export function moveLayer(panelId, layerId, direction) {
  mutatePanelById(panelId, (p) => {
    const i = p.layers.findIndex((l) => l.id === layerId);
    const j = i + direction;
    if (i === -1 || j < 0 || j >= p.layers.length) return;
    const [moved] = p.layers.splice(i, 1);
    p.layers.splice(j, 0, moved);
  });
}

export function deleteLayer(panelId, layerId) {
  const ok = mutatePanelById(panelId, (p) => {
    if (p.layers.length <= 1) return;
    p.layers = p.layers.filter((l) => l.id !== layerId);
  });
  if (!ok) return;
  update((u) => {
    const still = activePanel();
    if (still && !still.layers.some((l) => l.id === u.layerId)) {
      u.layerId = still.layers[0] ? still.layers[0].id : null;
    }
  });
}
