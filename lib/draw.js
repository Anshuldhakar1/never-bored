/* Drawing tools that produce SVG geometry.
 *
 * The old version drew into a 2D canvas and stored a PNG. Everything here
 * writes real vector nodes into the active layer's group instead, which is
 * what lets generated art and hand-drawn art share one medium: you can erase a
 * stroke the model drew, draw over it, scale the panel up without mush, and
 * write the result into a PDF as actual geometry.
 *
 * Edits happen on the live DOM inside the layer's <g>. The stage serialises
 * that group back into the store afterwards — see onChange. Nothing in this
 * module writes markup as a string, so there is no path where a text value
 * becomes an element.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const TOOLS = [
  { key: 'select', label: 'Select', hint: 'V', glyph: '⬚' },
  { key: 'brush', label: 'Brush', hint: 'B', glyph: '✎' },
  { key: 'line', label: 'Line', hint: 'L', glyph: '╱' },
  { key: 'rect', label: 'Rectangle', hint: 'R', glyph: '▭' },
  { key: 'ellipse', label: 'Ellipse', hint: 'E', glyph: '◯' },
  { key: 'eraser', label: 'Eraser', hint: 'X', glyph: '⌫' },
];

const round = (n) => Math.round(n * 100) / 100;

/* Freehand points into a path. Each sample becomes a quadratic control point
   with the segment midpoints as anchors, which turns the raw jitter of a
   pointer trail into a continuous curve without dropping detail. */
function pointsToPath(points) {
  if (points.length < 2) {
    // A tap still leaves a mark, otherwise a dot-stroke silently does nothing.
    const p = points[0];
    return `M${round(p.x)},${round(p.y)} l0.01,0`;
  }
  let d = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    d += ` Q${round(points[i].x)},${round(points[i].y)} ${round(mid.x)},${round(mid.y)}`;
  }
  const last = points[points.length - 1];
  d += ` L${round(last.x)},${round(last.y)}`;
  return d;
}

/* Drops samples closer than `min` to the previous kept point. Pointer events
   fire far faster than the drawing needs, and every extra sample is path data
   that gets stored, serialised and re-parsed on every load. */
function thin(points, min = 1.6) {
  const out = [points[0]];
  for (const p of points.slice(1)) {
    const prev = out[out.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= min) out.push(p);
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

export function createDrawing(ctx) {
  const { surface } = ctx;

  let active = null; // in-progress gesture
  let selected = null; // element chosen with the select tool
  let selectionBox = null;

  function styleStroke(el) {
    const { color, width } = ctx.style();
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(width));
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
  }

  function clearSelection() {
    if (selectionBox) {
      selectionBox.remove();
      selectionBox = null;
    }
    selected = null;
  }

  function drawSelectionBox() {
    if (selectionBox) selectionBox.remove();
    if (!selected) return;
    let box;
    try {
      box = selected.getBBox();
    } catch {
      return;
    }
    selectionBox = document.createElementNS(SVG_NS, 'rect');
    selectionBox.setAttribute('x', String(box.x - 2));
    selectionBox.setAttribute('y', String(box.y - 2));
    selectionBox.setAttribute('width', String(box.width + 4));
    selectionBox.setAttribute('height', String(box.height + 4));
    selectionBox.setAttribute('fill', 'none');
    selectionBox.setAttribute('stroke', '#E8A33D');
    selectionBox.setAttribute('stroke-width', '2');
    selectionBox.setAttribute('stroke-dasharray', '6,4');
    selectionBox.setAttribute('pointer-events', 'none');
    selectionBox.dataset.overlay = 'selection';
    // Rides along in the layer's own coordinate space so an existing transform
    // on the selected element does not throw the outline off.
    const parent = selected.parentNode;
    if (parent) parent.appendChild(selectionBox);
  }

  /* The top-level child of the active layer sitting under the pointer.
     elementsFromPoint respects fill and stroke hit areas, so an unfilled
     outline is only caught on its actual line — which is what you want when
     erasing line art. */
  function topElementAt(evt, group) {
    const hits = document.elementsFromPoint(evt.clientX, evt.clientY);
    for (const hit of hits) {
      if (hit === surface || hit === group) continue;
      if (!group.contains(hit)) continue;
      if (hit.dataset && hit.dataset.overlay) continue;
      let node = hit;
      while (node.parentNode && node.parentNode !== group) node = node.parentNode;
      if (node.parentNode === group) return node;
    }
    return null;
  }

  function beginShape(tool, start, group) {
    let el;
    if (tool === 'brush') {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', pointsToPath([start]));
    } else if (tool === 'line') {
      el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(round(start.x)));
      el.setAttribute('y1', String(round(start.y)));
      el.setAttribute('x2', String(round(start.x)));
      el.setAttribute('y2', String(round(start.y)));
    } else if (tool === 'rect') {
      el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', String(round(start.x)));
      el.setAttribute('y', String(round(start.y)));
      el.setAttribute('width', '0');
      el.setAttribute('height', '0');
    } else {
      el = document.createElementNS(SVG_NS, 'ellipse');
      el.setAttribute('cx', String(round(start.x)));
      el.setAttribute('cy', String(round(start.y)));
      el.setAttribute('rx', '0');
      el.setAttribute('ry', '0');
    }
    styleStroke(el);
    group.appendChild(el);
    return el;
  }

  function updateShape(gesture, point, shiftKey) {
    const { tool, el, start } = gesture;
    if (tool === 'brush') {
      gesture.points.push(point);
      el.setAttribute('d', pointsToPath(thin(gesture.points)));
      return;
    }
    let { x, y } = point;
    if (shiftKey) {
      // Constrain: square/circle for the box tools, 45° steps for a line.
      const dx = x - start.x;
      const dy = y - start.y;
      if (tool === 'line') {
        if (Math.abs(dx) > Math.abs(dy) * 2) y = start.y;
        else if (Math.abs(dy) > Math.abs(dx) * 2) x = start.x;
        else {
          const m = Math.min(Math.abs(dx), Math.abs(dy));
          x = start.x + Math.sign(dx) * m;
          y = start.y + Math.sign(dy) * m;
        }
      } else {
        const m = Math.min(Math.abs(dx), Math.abs(dy));
        x = start.x + Math.sign(dx) * m;
        y = start.y + Math.sign(dy) * m;
      }
    }
    if (tool === 'line') {
      el.setAttribute('x2', String(round(x)));
      el.setAttribute('y2', String(round(y)));
    } else if (tool === 'rect') {
      el.setAttribute('x', String(round(Math.min(start.x, x))));
      el.setAttribute('y', String(round(Math.min(start.y, y))));
      el.setAttribute('width', String(round(Math.abs(x - start.x))));
      el.setAttribute('height', String(round(Math.abs(y - start.y))));
    } else {
      el.setAttribute('cx', String(round((start.x + x) / 2)));
      el.setAttribute('cy', String(round((start.y + y) / 2)));
      el.setAttribute('rx', String(round(Math.abs(x - start.x) / 2)));
      el.setAttribute('ry', String(round(Math.abs(y - start.y) / 2)));
    }
  }

  /* A shape dragged out to nothing is a stray click, not a drawing. Dropping
     it keeps the layer from filling with zero-size nodes. */
  function isDegenerate(gesture) {
    const { tool, el } = gesture;
    if (tool === 'brush') return gesture.points.length === 0;
    if (tool === 'line') {
      return (
        Math.hypot(
          Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')),
          Number(el.getAttribute('y2')) - Number(el.getAttribute('y1')),
        ) < 1
      );
    }
    if (tool === 'rect') {
      return Number(el.getAttribute('width')) < 1 || Number(el.getAttribute('height')) < 1;
    }
    return Number(el.getAttribute('rx')) < 1 || Number(el.getAttribute('ry')) < 1;
  }

  function onPointerDown(evt) {
    if (evt.button !== 0) return;
    const tool = ctx.tool();
    const group = ctx.activeGroup();
    if (!group) {
      ctx.onBlocked();
      return;
    }
    const start = ctx.toPanel(evt);

    if (tool === 'select') {
      clearSelection();
      selected = topElementAt(evt, group);
      if (selected) {
        drawSelectionBox();
        active = { tool: 'move', el: selected, start, moved: false, group };
        surface.setPointerCapture(evt.pointerId);
      }
      ctx.onSelectionChange(Boolean(selected));
      return;
    }

    if (tool === 'eraser') {
      clearSelection();
      active = { tool: 'eraser', group, erased: false };
      surface.setPointerCapture(evt.pointerId);
      const hit = topElementAt(evt, group);
      if (hit) {
        hit.remove();
        active.erased = true;
      }
      return;
    }

    clearSelection();
    ctx.onSelectionChange(false);
    active = { tool, start, group, points: [start], el: beginShape(tool, start, group) };
    surface.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  }

  function onPointerMove(evt) {
    if (!active) return;
    if (active.tool === 'eraser') {
      const hit = topElementAt(evt, active.group);
      if (hit) {
        hit.remove();
        active.erased = true;
      }
      return;
    }
    if (active.tool === 'move') {
      const now = ctx.toPanel(evt);
      const dx = now.x - active.start.x;
      const dy = now.y - active.start.y;
      if (!active.moved && Math.hypot(dx, dy) < 1) return;
      active.moved = true;
      const base =
        active.baseTransform ?? (active.baseTransform = active.el.getAttribute('transform') || '');
      active.el.setAttribute('transform', `translate(${round(dx)} ${round(dy)}) ${base}`.trim());
      drawSelectionBox();
      return;
    }
    updateShape(active, ctx.toPanel(evt), evt.shiftKey);
  }

  function onPointerUp(evt) {
    if (!active) return;
    if (surface.hasPointerCapture(evt.pointerId)) surface.releasePointerCapture(evt.pointerId);
    const finished = active;
    active = null;

    if (finished.tool === 'eraser') {
      if (finished.erased) ctx.onChange('erase');
      return;
    }
    if (finished.tool === 'move') {
      if (finished.moved) ctx.onChange('move');
      return;
    }
    if (isDegenerate(finished)) {
      finished.el.remove();
      return;
    }
    ctx.onChange('draw');
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerUp);

  return {
    hasSelection: () => Boolean(selected),
    deleteSelection() {
      if (!selected) return false;
      selected.remove();
      clearSelection();
      ctx.onSelectionChange(false);
      ctx.onChange('delete');
      return true;
    },
    clearSelection() {
      clearSelection();
      ctx.onSelectionChange(false);
    },
    /* Called before the stage serialises a layer, so the dashed outline never
       gets written into the saved artwork. */
    stripOverlays(root) {
      root.querySelectorAll('[data-overlay]').forEach((el) => el.remove());
      selectionBox = null;
    },
    destroy() {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
