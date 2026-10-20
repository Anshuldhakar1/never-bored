/* Getting work back out: SVG, PDF, and the project file itself.
 *
 * SVG export is the lossless one — panels are vector all the way through, so
 * the exported file is the real geometry, editable in Illustrator, Inkscape or
 * Affinity. The PDF board renders each panel at 3x and places it as an image,
 * because jsPDF cannot parse SVG: its drawing API is line / circle / rect /
 * triangle / ellipse and nothing else. The framing icons still go in as true
 * vector via the shared op list, since those ARE expressible in that API.
 *
 * Files are handed over as real downloads (downloadBlob). The original
 * static build opened blob URLs in a new tab to survive sandboxed preview
 * iframes; the Next.js app is a normal top-level page, so a download works
 * and is one click less.
 *
 * Rendered image layers are referenced by URL inside the app. An SVG drawn
 * through <img> cannot fetch anything, so exports inline every image as data
 * first (inlineRasterSources).
 */

import { getProject, allPanels, aspect } from './store.js';
import { sanitizeSvgMarkup, isSafeRasterSrc } from './svgsafe.js';
import { drawShotIconPdf, PAPER, escapeHtml } from './vocab.js';
import { cameraRect, framesToLabel } from './stage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/* Pixel width each panel is rendered at for the PDF. A panel occupies roughly
   260pt on an A4 page, so this lands around 5x — comfortably past 300dpi in
   print without making the file enormous. */
const RASTER_WIDTH = 1400;

/* A complete, standalone SVG document for one panel. Every layer's markup goes
   back through the sanitiser on the way out — an export is a file other people
   open, so it must not be the one path that skips the check. */
export function panelToSvg(
  panel,
  { w, h },
  { withCamera = true, vectorOnly = false, rasterSrc = (src) => src } = {},
) {
  const body = panel.layers
    .filter((layer) => layer.visible)
    .map((layer) => {
      const open = `<g opacity="${Number(layer.opacity) || 0}" data-name="${escapeHtml(layer.name)}">`;
      if (layer.kind === 'raster') {
        const src = rasterSrc(layer.src);
        if (vectorOnly || !isSafeRasterSrc(layer.src) || !src) return '';
        return `${open}<image href="${escapeHtml(src)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g>`;
      }
      return layer.svg.trim() ? `${open}${sanitizeSvgMarkup(layer.svg)}</g>` : '';
    })
    .join('');

  let camera = '';
  if (withCamera && panel.camera.enabled) {
    const a = cameraRect(panel.camera.start, w, h);
    const b = cameraRect(panel.camera.end, w, h);
    const sw = w / 320;
    camera =
      `<g data-name="camera" fill="none" stroke-width="${sw}">` +
      `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" stroke="#4E9B9B"/>` +
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="#E8A33D" stroke-dasharray="${sw * 4},${sw * 3}"/>` +
      `<line x1="${a.x + a.w / 2}" y1="${a.y + a.h / 2}" x2="${b.x + b.w / 2}" y2="${b.y + b.h / 2}" stroke="#E8A33D" stroke-dasharray="${sw * 2},${sw * 2}"/>` +
      `</g>`;
  }

  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${PAPER}"/>${body}${camera}</svg>`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read an image for export.'));
    reader.readAsDataURL(blob);
  });
}

/* src -> data URL for every rendered image on the given panels. Images that
   cannot be fetched are left out of the export rather than failing it. */
export async function inlineRasterSources(panels) {
  const map = new Map();
  const wanted = new Set();
  panels.forEach((p) =>
    p.layers.forEach((l) => {
      if (l.kind === 'raster' && l.visible && isSafeRasterSrc(l.src)) wanted.add(l.src);
    }),
  );
  await Promise.all(
    [...wanted].map(async (src) => {
      if (src.startsWith('data:')) {
        map.set(src, src);
        return;
      }
      try {
        const resp = await fetch(src);
        if (resp.ok) map.set(src, await blobToDataUrl(await resp.blob()));
      } catch {
        /* left out */
      }
    }),
  );
  return (src) => map.get(src) || '';
}

/* One SVG holding the whole board as a contact sheet. */
export function projectToSvg(rasterSrc) {
  const project = getProject();
  const dims = aspect();
  const entries = allPanels();
  const cols = 3;
  const gap = dims.w * 0.06;
  const labelH = dims.h * 0.22;
  const cellW = dims.w;
  const cellH = dims.h + labelH;
  const rows = Math.ceil(entries.length / cols);
  const totalW = cols * cellW + (cols + 1) * gap;
  const totalH = rows * cellH + (rows + 1) * gap + dims.h * 0.3;

  const header = `<text x="${gap}" y="${dims.h * 0.2}" font-family="Helvetica,Arial,sans-serif" font-size="${dims.h * 0.11}" font-weight="bold" fill="#14171C">${escapeHtml(project.title)}</text>`;

  const cells = entries
    .map(({ panel, scene }, i) => {
      const cx = gap + (i % cols) * (cellW + gap);
      const cy = dims.h * 0.3 + gap + Math.floor(i / cols) * (cellH + gap);
      const inner = panelToSvg(panel, dims, { rasterSrc })
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      const fs = dims.h * 0.055;
      const meta = `${i + 1}. ${panel.shotType} · ${panel.angle} · ${panel.lens}${panel.movement !== 'STATIC' ? ' · ' + panel.movement : ''}`;
      return (
        `<g transform="translate(${cx} ${cy})">` +
        `<rect width="${dims.w}" height="${dims.h}" fill="${PAPER}" stroke="#383E48" stroke-width="${dims.w / 400}"/>` +
        inner +
        `<text x="0" y="${dims.h + fs * 1.5}" font-family="Helvetica,Arial,sans-serif" font-size="${fs}" font-weight="bold" fill="#14171C">${escapeHtml(meta)}</text>` +
        `<text x="0" y="${dims.h + fs * 2.9}" font-family="Helvetica,Arial,sans-serif" font-size="${fs * 0.92}" fill="#4a4a4a">${escapeHtml((panel.action || '').slice(0, 90))}</text>` +
        `<text x="0" y="${dims.h + fs * 4.1}" font-family="Helvetica,Arial,sans-serif" font-size="${fs * 0.92}" fill="#4a4a4a">${escapeHtml(scene.name)} · ${escapeHtml(framesToLabel(panel.durationFrames, project.fps))}</text>` +
        `</g>`
      );
    })
    .join('');

  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}"><rect width="${totalW}" height="${totalH}" fill="#ffffff"/>${header}${cells}</svg>`;
}

/* The Next.js app runs as a normal top-level page, so a real download works
   and beats a new tab: the file lands with a sensible name in one click. */
function fileStem() {
  const stem = String(getProject().title || 'storyboard')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem || 'storyboard';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { filename };
}

export async function exportSvg() {
  const rasterSrc = await inlineRasterSources(allPanels().map((e) => e.panel));
  const blob = new Blob([projectToSvg(rasterSrc)], { type: 'image/svg+xml' });
  return downloadBlob(blob, `${fileStem()}.svg`);
}

export function exportProjectFile() {
  const blob = new Blob([JSON.stringify(getProject(), null, 2)], { type: 'application/json' });
  return downloadBlob(blob, `${fileStem()}.neverbored.json`);
}

/* Renders one panel's SVG to a PNG data URL. The SVG is self-contained by
   construction — the sanitiser forbids external references — so drawing it to
   a canvas never taints it and toDataURL keeps working. */
function rasterizePanel(panel, dims, options = {}, width = RASTER_WIDTH, type = 'image/png') {
  return new Promise((resolve, reject) => {
    const svg = panelToSvg(panel, dims, options);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((width * dims.h) / dims.w);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      try {
        resolve(canvas.toDataURL(type, 0.9));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Not fatal: the PDF falls back to the vector framing icon for this panel.
      resolve(null);
    };
    img.src = url;
  });
}

/* The panel's vector art only (sketch, line art, drawing) as a PNG data URL,
   without the camera overlay — the reference image a raster render starts
   from. */
export function vectorPanelPng(panel, dims, width = 1024) {
  return rasterizePanel(panel, dims, { vectorOnly: true, withCamera: false }, width);
}

export async function exportPdf() {
  const project = getProject();
  const dims = aspect();
  const entries = allPanels();
  if (!entries.length) throw new Error('Nothing to export yet.');

  // Loaded on first export so the studio does not pay for it up front.
  let jsPDF;
  try {
    ({ jsPDF } = await import('jspdf'));
  } catch {
    throw new Error('The PDF library failed to load — check your connection and reload.');
  }
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const cols = 2;
  const gutter = 18;
  const frameW = (pageW - margin * 2 - gutter) / cols;
  const frameH = (frameW * dims.h) / dims.w;
  const textH = 58;
  const cellH = frameH + textH;

  const rasterSrc = await inlineRasterSources(entries.map((e) => e.panel));
  const images = await Promise.all(
    entries.map((e) => rasterizePanel(e.panel, dims, { rasterSrc })),
  );

  let page = 0;
  let col = 0;
  let y = margin + 34;

  const header = () => {
    page += 1;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(20, 23, 28);
    pdf.text(project.title || 'Storyboard', margin, margin + 8);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(
      `${entries.length} panels · ${framesToLabel(
        entries.reduce((s, e) => s + e.panel.durationFrames, 0),
        project.fps,
      )} · page ${page}`,
      pageW - margin,
      margin + 8,
      { align: 'right' },
    );
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, margin + 16, pageW - margin, margin + 16);
  };

  header();

  entries.forEach(({ panel, scene }, i) => {
    if (y + cellH > pageH - margin) {
      pdf.addPage();
      y = margin + 34;
      col = 0;
      header();
    }
    const x = margin + col * (frameW + gutter);

    pdf.setFillColor(220, 214, 196);
    pdf.setDrawColor(56, 62, 72);
    pdf.rect(x, y, frameW, frameH, 'FD');

    if (images[i]) {
      try {
        pdf.addImage(images[i], 'PNG', x, y, frameW, frameH);
      } catch {
        drawShotIconPdf(pdf, panel.shotType, x, y, frameW, frameH);
      }
    } else {
      drawShotIconPdf(pdf, panel.shotType, x, y, frameW, frameH);
    }
    pdf.setDrawColor(56, 62, 72);
    pdf.rect(x, y, frameW, frameH, 'S');

    let ty = y + frameH + 12;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(20, 23, 28);
    pdf.text(`${i + 1}. ${panel.shotType} · ${panel.angle}`, x, ty);

    ty += 10;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 100, 100);
    const sub = [
      panel.lens,
      panel.movement !== 'STATIC' ? panel.movement : null,
      panel.camera.enabled ? 'CAM MOVE' : null,
      framesToLabel(panel.durationFrames, project.fps),
      scene.name,
    ]
      .filter(Boolean)
      .join(' · ');
    pdf.text(sub, x, ty);

    ty += 11;
    pdf.setTextColor(40, 40, 40);
    pdf.setFontSize(8);
    const action = pdf.splitTextToSize(panel.action || '—', frameW);
    pdf.text(action.slice(0, 2), x, ty);

    if (panel.dialogue) {
      ty += action.slice(0, 2).length * 9 + 2;
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(90, 90, 90);
      pdf.text(pdf.splitTextToSize(`"${panel.dialogue}"`, frameW).slice(0, 1), x, ty);
    }

    col += 1;
    if (col >= cols) {
      col = 0;
      y += cellH;
    }
  });

  return downloadBlob(pdf.output('blob'), `${fileStem()}.pdf`);
}
