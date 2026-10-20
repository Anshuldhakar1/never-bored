/* The stage: the panel you are actually looking at.
 *
 * Composites the active panel's layer stack, draws the onion skin of the
 * previous panel underneath, overlays the camera move, and hosts the drawing
 * tools. Also owns playback — scrubbing the playhead across panels and
 * interpolating each panel's camera move as it goes, which is the part that
 * turns a stack of drawings into an animatic.
 *
 * The camera move is expressed as a viewBox: the framing rect is what the
 * audience sees, so animating the viewBox from start to end IS the dolly.
 * Nothing has to move the artwork itself.
 */

import {
  getUI,
  getProject,
  activePanel,
  activeLayer,
  activeScene,
  allPanels,
  commit,
  update,
  aspect,
  panelAtFrame,
  frameOfPanel,
  totalFrames,
  selectPanel,
  drawableLayerId,
  getSelectionEpoch,
  isEditable,
} from './store.js';
import { sanitizeSvgFragment, isSafeRasterSrc } from './svgsafe.js';
import { shotIconLayerMarkup, PAPER } from './vocab.js';
import { createDrawing, TOOLS } from './draw.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let surface = null;
let paperRect = null;
let onionGroup = null;
let layersGroup = null;
let guidesGroup = null;
let cameraGroup = null;
let drawing = null;
let statusHook = () => {};

/* layer id -> the markup currently mounted for it. Lets a re-render skip
   layers that have not changed, which keeps an in-progress selection alive and
   avoids rebuilding a heavy generated drawing on every keystroke elsewhere. */
const mounted = new Map();

const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

export const EASING_KEYS = Object.keys(EASINGS);

export function framesToLabel(frames, fps) {
  const total = Math.max(0, Math.round(frames));
  const secs = Math.floor(total / fps);
  const rem = total % fps;
  return `${secs}s ${String(rem).padStart(2, '0')}f`;
}

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  return node;
}

export function mountStage(host, { onStatus } = {}) {
  statusHook = onStatus || (() => {});
  host.replaceChildren();

  surface = el('svg', { class: 'stageSvg', xmlns: SVG_NS });
  surface.setAttribute('tabindex', '0');
  surface.setAttribute('role', 'application');
  surface.setAttribute('aria-label', 'Panel drawing surface');

  paperRect = el('rect', { x: 0, y: 0, width: 10, height: 10, fill: PAPER });
  onionGroup = el('g', { class: 'onionGroup', 'pointer-events': 'none', opacity: 0.28 });
  layersGroup = el('g', { class: 'layersGroup' });
  guidesGroup = el('g', { class: 'guidesGroup', 'pointer-events': 'none' });
  cameraGroup = el('g', { class: 'cameraGroup' });

  surface.append(paperRect, onionGroup, layersGroup, guidesGroup, cameraGroup);
  host.appendChild(surface);

  drawing = createDrawing({
    surface,
    toPanel(evt) {
      const pt = surface.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const ctm = surface.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    },
    activeGroup() {
      if (!isEditable()) return null;
      const layer = activeLayer();
      if (!layer || layer.locked || !layer.visible || layer.kind === 'raster') return null;
      if (coveringImage(layer)) return null;
      return layersGroup.querySelector(`[data-layer="${CSS.escape(layer.id)}"]`);
    },
    style() {
      const ui = getUI();
      return { color: ui.brushColor, width: ui.brushWidth };
    },
    tool: () => getUI().tool,
    onBlocked() {
      const layer = activeLayer();
      if (!isEditable()) statusHook('This board is view-only for you right now.');
      else if (!layer) statusHook('This panel has no layers — add one first.');
      else if (layer.kind === 'raster')
        statusHook(`"${layer.name}" is a rendered image — pick a drawing layer.`);
      else if (layer.locked) statusHook(`"${layer.name}" is locked.`);
      else if (!layer.visible) statusHook(`"${layer.name}" is hidden — turn it back on to draw.`);
      else if (coveringImage(layer))
        statusHook(`The rendered image covers "${layer.name}" — hide it in Layers to draw.`);
    },
    onSelectionChange() {
      statusHook(null);
    },
    onChange(kind) {
      persistActiveLayer(kind);
    },
  });

  return { surface };
}

/* Writes the live DOM of the active layer back into the store. The nodes being
   serialised were either created by the drawing tools or already passed
   through svgsafe on mount, and they are re-sanitised again on load. */
function persistActiveLayer(kind) {
  const layer = activeLayer();
  const panel = activePanel();
  if (!layer || !panel || layer.kind === 'raster') return;
  const group = layersGroup.querySelector(`[data-layer="${CSS.escape(layer.id)}"]`);
  if (!group) return;

  drawing.stripOverlays(group);
  const markup = group.innerHTML;
  mounted.set(layer.id, markup);

  commit(
    (proj) => {
      const target = findLayer(proj, panel.id, layer.id);
      if (target) target.svg = markup;
    },
    // One undo step per stroke rather than per pointer sample, but an erase
    // sweep and a draw stroke stay separate entries.
    { coalesceKey: `${kind}:${layer.id}` },
  );
}

function findLayer(proj, panelId, layerId) {
  for (const seq of proj.sequences) {
    for (const scene of seq.scenes) {
      for (const panel of scene.panels) {
        if (panel.id !== panelId) continue;
        return panel.layers.find((l) => l.id === layerId) || null;
      }
    }
  }
  return null;
}

/* ---------------- Camera ---------------- */

export function cameraRect(frame, panelW, panelH) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const zoom = Math.min(1, Math.max(0.15, frame.zoom));
  return {
    x: clamp01(frame.x) * panelW,
    y: clamp01(frame.y) * panelH,
    w: zoom * panelW,
    h: zoom * panelH,
  };
}

function lerpFrame(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    zoom: a.zoom + (b.zoom - a.zoom) * t,
  };
}

export function interpolatedCamera(panel, progress) {
  if (!panel.camera || !panel.camera.enabled) return null;
  const ease = EASINGS[panel.camera.easing] || EASINGS['ease-in-out'];
  return lerpFrame(panel.camera.start, panel.camera.end, ease(Math.min(1, Math.max(0, progress))));
}

/* ---------------- Rendering ---------------- */

function mountLayerMarkup(group, markup) {
  group.replaceChildren(sanitizeSvgFragment(markup));
}

/* A rendered image layer. Built here from a source that has already passed
   isSafeRasterSrc — never from markup. */
/* A visible rendered image stacked above the given layer hides anything drawn
   on it, so drawing there would look like nothing happened. */
function coveringImage(layer) {
  const panel = activePanel();
  if (!panel) return false;
  const index = panel.layers.indexOf(layer);
  return panel.layers.some(
    (l, i) => i > index && l.kind === 'raster' && l.visible && isSafeRasterSrc(l.src),
  );
}

export function rasterImageNode(src, panelW, panelH) {
  if (!isSafeRasterSrc(src)) return null;
  const img = el('image', {
    x: 0,
    y: 0,
    width: panelW,
    height: panelH,
    preserveAspectRatio: 'xMidYMid slice',
  });
  img.setAttribute('href', src);
  return img;
}

function layerKey(layer) {
  return layer.kind === 'raster' ? `raster:${layer.src || ''}` : layer.svg;
}

function renderLayers(panel, panelW, panelH) {
  const wanted = new Set(panel.layers.map((l) => l.id));
  Array.from(layersGroup.children).forEach((child) => {
    if (!wanted.has(child.dataset.layer)) {
      mounted.delete(child.dataset.layer);
      child.remove();
    }
  });

  panel.layers.forEach((layer, index) => {
    let group = layersGroup.querySelector(`[data-layer="${CSS.escape(layer.id)}"]`);
    if (!group) {
      group = el('g');
      group.dataset.layer = layer.id;
      layersGroup.appendChild(group);
    }
    // Keep DOM order matching stack order so painting order is correct.
    if (layersGroup.children[index] !== group) {
      layersGroup.insertBefore(group, layersGroup.children[index] || null);
    }
    group.setAttribute('opacity', String(layer.visible ? layer.opacity : 0));
    group.setAttribute('pointer-events', layer.visible && !layer.locked ? 'auto' : 'none');

    const key = layerKey(layer);
    if (mounted.get(layer.id) !== key) {
      if (layer.kind === 'raster') {
        const img = rasterImageNode(layer.src, panelW, panelH);
        group.replaceChildren(...(img ? [img] : []));
      } else {
        mountLayerMarkup(group, layer.svg);
      }
      mounted.set(layer.id, key);
    }
  });

  // A panel with nothing drawn on it shows its framing icon, so the board is
  // readable before anyone has drawn or generated anything.
  const empty = panel.layers.every((l) => !l.svg.trim() && !(l.kind === 'raster' && l.src));
  let placeholder = layersGroup.querySelector('[data-placeholder]');
  if (empty) {
    if (!placeholder) {
      placeholder = el('g', { 'pointer-events': 'none' });
      placeholder.dataset.placeholder = '1';
      layersGroup.appendChild(placeholder);
    }
    layersGroup.appendChild(placeholder);
    const markup = shotIconLayerMarkup(panel.shotType, panelW, panelH);
    if (placeholder.dataset.key !== markup) {
      mountLayerMarkup(placeholder, markup);
      placeholder.dataset.key = markup;
    }
  } else if (placeholder) {
    placeholder.remove();
  }
}

function renderOnion(panelW, panelH) {
  const ui = getUI();
  onionGroup.replaceChildren();
  if (!ui.onionSkin) return;
  const entries = allPanels();
  const idx = entries.findIndex((e) => e.panel.id === ui.panelId);
  if (idx <= 0) return;
  const prev = entries[idx - 1].panel;
  const markup = prev.layers
    .filter((l) => l.visible && l.svg.trim())
    .map((l) => l.svg)
    .join('');
  if (markup.trim()) {
    onionGroup.appendChild(sanitizeSvgFragment(markup));
  } else {
    onionGroup.appendChild(sanitizeSvgFragment(shotIconLayerMarkup(prev.shotType, panelW, panelH)));
  }
}

function renderGuides(panelW, panelH) {
  guidesGroup.replaceChildren();
  if (!getUI().showGuides) return;
  const line = (x1, y1, x2, y2) =>
    el('line', { x1, y1, x2, y2, stroke: '#1B1400', 'stroke-width': panelW / 600, opacity: 0.25 });
  for (let i = 1; i < 3; i++) {
    guidesGroup.appendChild(line((panelW / 3) * i, 0, (panelW / 3) * i, panelH));
    guidesGroup.appendChild(line(0, (panelH / 3) * i, panelW, (panelH / 3) * i));
  }
  // Action-safe at 90%, title-safe at 80% — the standard broadcast pair.
  [0.9, 0.8].forEach((pct, i) => {
    const w = panelW * pct;
    const h = panelH * pct;
    guidesGroup.appendChild(
      el('rect', {
        x: (panelW - w) / 2,
        y: (panelH - h) / 2,
        width: w,
        height: h,
        fill: 'none',
        stroke: '#1B1400',
        'stroke-width': panelW / 600,
        'stroke-dasharray': i === 0 ? 'none' : `${panelW / 100},${panelW / 100}`,
        opacity: 0.35,
      }),
    );
  });
}

function renderCamera(panel, panelW, panelH) {
  cameraGroup.replaceChildren();
  const ui = getUI();
  if (!ui.showCamera || !panel.camera.enabled || ui.playing) return;

  const stroke = panelW / 320;
  const mk = (frame, cls, label) => {
    const r = cameraRect(frame, panelW, panelH);
    const g = el('g', { class: cls });
    g.appendChild(
      el('rect', {
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        fill: 'none',
        stroke: cls === 'camStart' ? '#4E9B9B' : '#E8A33D',
        'stroke-width': stroke,
        'stroke-dasharray': cls === 'camStart' ? 'none' : `${stroke * 4},${stroke * 3}`,
      }),
    );
    const tag = el('text', {
      x: r.x + stroke * 3,
      y: r.y + panelH / 26,
      fill: cls === 'camStart' ? '#4E9B9B' : '#E8A33D',
      'font-size': panelH / 26,
      'font-family': 'monospace',
      'font-weight': 'bold',
    });
    tag.textContent = label;
    g.appendChild(tag);

    // Body drags the frame, corner handle resizes it (changes the zoom).
    const body = el('rect', {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      fill: 'transparent',
      cursor: 'move',
    });
    body.dataset.camDrag = cls === 'camStart' ? 'start' : 'end';
    g.appendChild(body);

    const handle = el('rect', {
      x: r.x + r.w - stroke * 6,
      y: r.y + r.h - stroke * 6,
      width: stroke * 12,
      height: stroke * 12,
      fill: cls === 'camStart' ? '#4E9B9B' : '#E8A33D',
      cursor: 'nwse-resize',
    });
    handle.dataset.camResize = cls === 'camStart' ? 'start' : 'end';
    g.appendChild(handle);
    return { g, r };
  };

  const start = mk(panel.camera.start, 'camStart', 'START');
  const end = mk(panel.camera.end, 'camEnd', 'END');

  // A line between the two frame centres, so the direction of travel is
  // legible at a glance without playing it back.
  cameraGroup.appendChild(
    el('line', {
      x1: start.r.x + start.r.w / 2,
      y1: start.r.y + start.r.h / 2,
      x2: end.r.x + end.r.w / 2,
      y2: end.r.y + end.r.h / 2,
      stroke: '#E8A33D',
      'stroke-width': stroke,
      'stroke-dasharray': `${stroke * 2},${stroke * 2}`,
      'pointer-events': 'none',
    }),
  );
  cameraGroup.append(start.g, end.g);
  attachCameraDrag();
}

function attachCameraDrag() {
  cameraGroup.querySelectorAll('[data-cam-drag],[data-cam-resize]').forEach((node) => {
    node.addEventListener('pointerdown', (evt) => {
      // Keep the drawing tools out of it — this gesture belongs to the camera.
      evt.stopPropagation();
      evt.preventDefault();
      const panel = activePanel();
      if (!panel) return;
      const which = node.dataset.camDrag || node.dataset.camResize;
      const resizing = Boolean(node.dataset.camResize);
      const origin = panel.camera[which];
      const startPt = { x: evt.clientX, y: evt.clientY };
      const base = { ...origin };
      node.setPointerCapture(evt.pointerId);

      const move = (moveEvt) => {
        const rect = surface.getBoundingClientRect();
        const dx = (moveEvt.clientX - startPt.x) / rect.width;
        const dy = (moveEvt.clientY - startPt.y) / rect.height;
        commit(
          (proj) => {
            const target = findPanelIn(proj, panel.id);
            if (!target) return;
            const frame = target.camera[which];
            if (resizing) {
              frame.zoom = Math.min(1, Math.max(0.15, base.zoom + dx));
              frame.x = Math.min(1 - frame.zoom, Math.max(0, frame.x));
              frame.y = Math.min(1 - frame.zoom, Math.max(0, frame.y));
            } else {
              frame.x = Math.min(1 - frame.zoom, Math.max(0, base.x + dx));
              frame.y = Math.min(1 - frame.zoom, Math.max(0, base.y + dy));
            }
          },
          { coalesceKey: `camera:${panel.id}:${which}` },
        );
      };
      const up = (upEvt) => {
        node.releasePointerCapture(upEvt.pointerId);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  });
}

function findPanelIn(proj, panelId) {
  for (const seq of proj.sequences) {
    for (const scene of seq.scenes) {
      const found = scene.panels.find((p) => p.id === panelId);
      if (found) return found;
    }
  }
  return null;
}

export function renderStage() {
  if (!surface) return;
  const panel = activePanel();
  const { w: panelW, h: panelH } = aspect();
  const ui = getUI();

  surface.setAttribute('width', String(panelW));
  surface.setAttribute('height', String(panelH));
  paperRect.setAttribute('width', String(panelW));
  paperRect.setAttribute('height', String(panelH));

  if (!panel) {
    surface.setAttribute('viewBox', `0 0 ${panelW} ${panelH}`);
    layersGroup.replaceChildren();
    return;
  }

  // During playback the viewBox IS the camera, so the move plays for real.
  let view = { x: 0, y: 0, w: panelW, h: panelH };
  if (ui.playing) {
    const at = panelAtFrame(ui.playheadFrame);
    const live = at && interpolatedCamera(at.panel, at.progress);
    if (live) view = cameraRect(live, panelW, panelH);
  }
  surface.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

  const cursorTool = TOOLS.find((t) => t.key === ui.tool);
  surface.dataset.tool = cursorTool ? cursorTool.key : 'brush';

  renderOnion(panelW, panelH);
  renderLayers(panel, panelW, panelH);
  renderGuides(panelW, panelH);
  renderCamera(panel, panelW, panelH);
}

export function getDrawing() {
  return drawing;
}

/* Forces the next render to rebuild every layer — used after an undo, where
   the store's markup changed without the stage touching the DOM. */
export function invalidateMounted() {
  mounted.clear();
}

/* ---------------- Playback ---------------- */

/* Playback is clock-driven: the frame on screen is always
   startFrame + elapsed real time × fps, so the animatic runs at true speed
   and covers every frame of every panel, start to finish. (Stepping a frame
   counter per animation tick dropped the fractional frame each time and ran
   about 15% slow.)

   Where Play starts:
     - by default, the very beginning — Play means "play the whole board";
     - after a pause, exactly where it paused (resume);
     - after a scrub on the ruler, the scrubbed frame (an explicit choice);
     - with { fromPanel: true } (Shift+Space), the selected panel's start.
   Selecting a panel moves the playhead to that panel, which on its own must
   not shorten the next play — that was the old behaviour. */

let rafId = null;
let clock = null; // { startTime, startFrame }
let lastWritten = null; // the frame tick() last put on the playhead
/* A paused or scrubbed position Play should honour: { frame, epoch }. It only
   counts while no panel has been selected since (same selection epoch) and
   the playhead is still on that frame. */
let armed = null;

function arm(frame) {
  armed = { frame, epoch: getSelectionEpoch() };
}

function armedStart(ui, total) {
  if (!armed) return null;
  const ok =
    armed.epoch === getSelectionEpoch() && armed.frame === ui.playheadFrame && armed.frame < total - 1;
  return ok ? armed.frame : null;
}

export function isPlaying() {
  return getUI().playing;
}

/* Puts the selection on whichever panel contains `frame`. */
function selectionAt(u, frame) {
  const at = panelAtFrame(frame);
  if (!at) return;
  if (u.panelId !== at.panel.id || !at.panel.layers.some((l) => l.id === u.layerId)) {
    u.layerId = drawableLayerId(at.panel);
  }
  u.sequenceId = at.sequence.id;
  u.sceneId = at.scene.id;
  u.panelId = at.panel.id;
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  clock = null;
  lastWritten = null;
}

export function play({ fromPanel = false } = {}) {
  const ui = getUI();
  if (ui.playing) return;
  const total = totalFrames();
  if (total <= 0) return;

  let start = 0;
  if (fromPanel) start = Math.min(frameOfPanel(ui.panelId), total - 1);
  else start = armedStart(ui, total) ?? 0;
  armed = null;

  update((u) => {
    u.playing = true;
    u.playheadFrame = start;
    selectionAt(u, start);
  });
  clock = { startTime: performance.now(), startFrame: start };
  lastWritten = start;
  rafId = requestAnimationFrame(tick);
}

/* Stops where it is: the playhead stays on the exact frame (not the start of
   the panel), so the next Play resumes from here. */
export function pause() {
  const wasPlaying = getUI().playing;
  stopLoop();
  if (!wasPlaying) return;
  const frame = getUI().playheadFrame;
  arm(frame);
  update((u) => {
    u.playing = false;
    selectionAt(u, frame);
  });
}

/* Reached the end: the playhead rests on the board's last frame, and the
   next Play starts again from the top. */
function finish(total) {
  stopLoop();
  armed = null;
  const last = Math.max(0, total - 1);
  update((u) => {
    u.playing = false;
    u.playheadFrame = last;
    selectionAt(u, last);
  });
}

export function togglePlay(options) {
  if (getUI().playing) pause();
  else play(options);
}

function tick(now) {
  const ui = getUI();
  if (!ui.playing || !clock) return;

  // Something else moved the playhead mid-play (a click on a panel, an arrow
  // key, the ruler): carry on from there instead of snapping back.
  if (lastWritten !== null && ui.playheadFrame !== lastWritten) {
    clock = { startTime: now, startFrame: ui.playheadFrame };
  }

  const fps = getProject().fps || 24;
  const total = totalFrames();
  // A rAF timestamp can predate the performance.now() read in play() (it is
  // the frame's start time), so clamp — never step behind the start frame.
  const elapsed = Math.max(0, now - clock.startTime);
  const frame = clock.startFrame + Math.floor((elapsed / 1000) * fps);
  if (frame >= total) {
    finish(total);
    return;
  }
  if (frame !== ui.playheadFrame) {
    update((u) => {
      u.playheadFrame = frame;
      selectionAt(u, frame);
    });
  }
  lastWritten = frame;
  rafId = requestAnimationFrame(tick);
}

/* A hidden tab gets no animation frames; pause rather than leap ahead. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && getUI().playing) pause();
  });
}

export function scrubTo(frame) {
  const total = totalFrames();
  const clamped = Math.min(Math.max(0, Math.round(frame)), Math.max(0, total - 1));
  update((u) => {
    u.playheadFrame = clamped;
    selectionAt(u, clamped);
  });
  // A deliberate position: the next Play starts here.
  arm(clamped);
}

/* A different board replaced the one on screen (new board, opened file,
   demo, a shared board opened or left): stop, forget any resume point, and
   put the playhead at the top so Play covers the whole new board. */
export function resetPlayback() {
  stopLoop();
  armed = null;
  update((u) => {
    u.playing = false;
    u.playheadFrame = 0;
  });
}

export function stepPanel(direction) {
  const entries = allPanels();
  const idx = entries.findIndex((e) => e.panel.id === getUI().panelId);
  const next = entries[Math.min(entries.length - 1, Math.max(0, idx + direction))];
  if (next) selectPanel(next.panel.id);
}

export function currentSceneLabel() {
  const scene = activeScene();
  return scene ? scene.name : '';
}
