/* Panel miniatures for the navigator and timeline.
 *
 * Built from the same sanitised markup the stage uses — layer SVG goes through
 * sanitizeSvgFragment, rendered images through rasterImageNode — and cached
 * by a content signature, because a board can carry hundreds of these and
 * they would otherwise be rebuilt on every keystroke in the inspector.
 */

import { aspect } from './store.js';
import { sanitizeSvgFragment } from './svgsafe.js';
import { PAPER, shotIconLayerMarkup } from './vocab.js';
import { cameraRect, rasterImageNode } from './stage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const thumbCache = new Map();

function layerHasContent(layer) {
  return layer.kind === 'raster' ? Boolean(layer.src) : Boolean(layer.svg.trim());
}

export function panelSignature(panel) {
  const cam = panel.camera.enabled
    ? `${panel.camera.end.x},${panel.camera.end.y},${panel.camera.end.zoom}`
    : '-';
  return `${aspect().key}|${panel.shotType}|${cam}|${panel.layers
    .map(
      (l) =>
        `${l.visible ? 1 : 0}:${l.opacity}:${l.kind === 'raster' ? l.src : `${l.svg.length}:${l.svg.slice(0, 32)}:${l.svg.slice(-32)}`}`,
    )
    .join('~')}`;
}

export function panelThumb(panel) {
  const sig = panelSignature(panel);
  const cached = thumbCache.get(panel.id);
  if (cached && cached.sig === sig) return cached.node.cloneNode(true);

  const { w, h } = aspect();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'thumbSvg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', PAPER);
  svg.appendChild(bg);

  const drawn = panel.layers.filter((l) => l.visible && layerHasContent(l));
  if (drawn.length) {
    drawn.forEach((layer) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('opacity', String(layer.opacity));
      if (layer.kind === 'raster') {
        const img = rasterImageNode(layer.src, w, h);
        if (img) g.appendChild(img);
      } else {
        g.appendChild(sanitizeSvgFragment(layer.svg));
      }
      svg.appendChild(g);
    });
  } else {
    svg.appendChild(sanitizeSvgFragment(shotIconLayerMarkup(panel.shotType, w, h)));
  }

  if (panel.camera.enabled) {
    const r = cameraRect(panel.camera.end, w, h);
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', String(r.x));
    box.setAttribute('y', String(r.y));
    box.setAttribute('width', String(r.w));
    box.setAttribute('height', String(r.h));
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#E8A33D');
    box.setAttribute('stroke-width', String(w / 250));
    box.setAttribute('stroke-dasharray', `${w / 80},${w / 110}`);
    svg.appendChild(box);
  }

  thumbCache.set(panel.id, { sig, node: svg });
  return svg.cloneNode(true);
}
