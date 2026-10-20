/* Screenplay import: Final Draft (.fdx) and PDF, read entirely in the
 * browser. Nothing here calls a model — a screenplay is structured text, and
 * the structure (scene headings, action, character cues, dialogue) can be
 * recovered exactly from FDX and reliably enough from a PDF's text layout.
 *
 * FDX is XML with a typed paragraph per element, so it is read as it is.
 * PDF has no element types, only positioned text, but screenplay format is
 * strict about indentation: action at the left margin, dialogue about an
 * inch in, parentheticals a little further, character cues about two inches
 * in, transitions near the right. Lines are classified by their indent from
 * the detected action margin, with text patterns (INT./EXT., ALL CAPS, "TO:")
 * as tie-breakers.
 *
 * The parsed scenes feed two paths in app.js: a quick board built straight
 * from the beats (no AI, free), or AI coverage per selected scene.
 */

import { makePanel } from './store.js';
import { extractCast } from './sketch.js';

/* pdf.js loads on demand: most sessions never import a PDF, and it is large. */
const PDFJS_VERSION = '6.4.299';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export const SCREENPLAY_MAX_BYTES = 25 * 1024 * 1024;
const MAX_SCENES = 400;
const MAX_SCENE_TEXT = 20000;

const HEADING_RE = /^\s*(INT|EXT|EST|I\/E|INT\.?\/EXT|EXT\.?\/INT)[\s./]/i;
const TRANSITION_RE = /(TO:|FADE OUT\.?|FADE IN:?|FADE TO BLACK\.?|CUT TO BLACK\.?)\s*$/;
const NOISE_RE = /^\s*(\(MORE\)|\(CONT['’]D\)|CONTINUED:?|\(CONTINUED\)|\d+\.?|\d+[A-Z]?)\s*$/i;

/* ---------------- Shared: elements -> scenes ---------------- */

function normalizeText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cueName(cue) {
  return normalizeText(cue)
    .replace(/\(.*?\)/g, '')
    .replace(/\s+(CONT['’]?D|V\.O\.|O\.S\.|O\.C\.)\s*$/i, '')
    .trim()
    .slice(0, 40);
}

/* elements: [{ type: heading|action|character|dialogue|parenthetical|transition, text }] */
export function elementsToScenes(elements, title = 'Screenplay') {
  const scenes = [];
  let current = null;
  let speaker = '';

  const open = (heading) => {
    current = { heading, beats: [], lines: [heading] };
    scenes.push(current);
    speaker = '';
  };

  elements.forEach((element) => {
    const text = normalizeText(element.text);
    if (!text) return;
    if (element.type === 'heading') {
      open(text.toUpperCase());
      return;
    }
    // Anything before the first heading (a cold open written as action) still
    // belongs to the story; give it a scene of its own.
    if (!current) {
      if (element.type === 'transition') return;
      open('OPENING');
    }
    switch (element.type) {
      case 'character':
        speaker = cueName(text);
        current.lines.push('', speaker);
        break;
      case 'parenthetical':
        current.lines.push(text);
        break;
      case 'dialogue':
        current.lines.push(text);
        current.beats.push({ kind: 'dialogue', character: speaker, text });
        break;
      case 'transition':
        current.lines.push('', text);
        break;
      default:
        speaker = '';
        current.lines.push('', text);
        current.beats.push({ kind: 'action', text });
    }
  });

  return {
    title: normalizeText(title).slice(0, 90) || 'Screenplay',
    scenes: scenes.slice(0, MAX_SCENES).map((scene, i) => {
      const text = scene.lines.join('\n').trim().slice(0, MAX_SCENE_TEXT);
      const cast = [];
      scene.beats.forEach((b) => {
        if (b.character && !cast.includes(b.character)) cast.push(b.character);
      });
      extractCast(
        scene.beats
          .filter((b) => b.kind === 'action')
          .map((b) => b.text)
          .join(' '),
        6,
      ).forEach((name) => {
        if (!cast.includes(name) && cast.length < 8) cast.push(name);
      });
      return {
        index: i + 1,
        heading: scene.heading,
        text,
        beats: scene.beats,
        cast,
        // Roughly 55 lines to a screenplay page; good enough to rank length.
        pages: Math.max(0.1, Math.round((scene.lines.length / 55) * 10) / 10),
      };
    }),
  };
}

/* ---------------- Final Draft (.fdx) ---------------- */

const FDX_TYPES = {
  'Scene Heading': 'heading',
  Action: 'action',
  General: 'action',
  Shot: 'action',
  Character: 'character',
  Dialogue: 'dialogue',
  Parenthetical: 'parenthetical',
  Transition: 'transition',
};

export function parseFdx(xmlText, fallbackTitle = 'Screenplay') {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('This .fdx file could not be read — it is not valid Final Draft XML.');
  }
  const content = doc.getElementsByTagName('Content')[0];
  if (!content || doc.documentElement.nodeName !== 'FinalDraft') {
    throw new Error('This file is not a Final Draft screenplay.');
  }
  // Text runs are direct <Text> children of a paragraph; dual dialogue nests
  // paragraphs inside <DualDialogue>, which document order already handles.
  const textOf = (p) =>
    Array.from(p.children)
      .filter((c) => c.nodeName === 'Text')
      .map((t) => t.textContent)
      .join('');
  const elements = [];
  Array.from(content.getElementsByTagName('Paragraph')).forEach((p) => {
    const type = FDX_TYPES[p.getAttribute('Type')];
    if (!type) return;
    elements.push({ type, text: textOf(p) });
  });

  let title = fallbackTitle;
  const titlePage = doc.getElementsByTagName('TitlePage')[0];
  if (titlePage) {
    const first = Array.from(titlePage.getElementsByTagName('Paragraph'))
      .map((p) => normalizeText(textOf(p)))
      .find((t) => t && !/^(written by|by|draft|copyright)/i.test(t));
    if (first) title = first;
  }
  if (!elements.some((e) => e.type === 'heading')) {
    throw new Error('No scene headings (INT./EXT.) were found in this file.');
  }
  return elementsToScenes(elements, title);
}

/* ---------------- PDF ---------------- */

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    // Loaded from the CDN at runtime, never bundled — both bundlers are told
    // to leave this import alone.
    pdfjsPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PDFJS_URL)
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw new Error(`The PDF reader could not load — check your connection. (${err.message})`);
      });
  }
  return pdfjsPromise;
}

/* Positioned lines: { page, x, y, size, text }, top-to-bottom per page. */
async function pdfLines(file) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const lines = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const rows = new Map();
    content.items.forEach((item) => {
      if (!item.str || !item.transform) return;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] * 2) / 2;
      const size = Math.abs(item.transform[3]) || 12;
      // Items within a point of each other vertically share a row.
      let key = y;
      for (const k of rows.keys()) {
        if (Math.abs(k - y) <= 1.5) {
          key = k;
          break;
        }
      }
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x, str: item.str, width: item.width || 0, size });
    });
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([y, items]) => {
        items.sort((a, b) => a.x - b.x);
        let text = '';
        let end = null;
        items.forEach((it) => {
          if (
            end !== null &&
            it.x - end > it.size * 0.2 &&
            !text.endsWith(' ') &&
            !it.str.startsWith(' ')
          ) {
            text += ' ';
          }
          text += it.str;
          end = it.x + it.width;
        });
        if (text.trim()) {
          lines.push({ page: pageNo, x: items[0].x, y, size: items[0].size, text: text.trim() });
        }
      });
    page.cleanup();
  }
  await task.destroy();
  return lines;
}

const isUpper = (t) => /[A-Z]/.test(t) && t === t.toUpperCase();

/* The action margin: the leftmost indent that a real share of lines use.
   Title-page and page-number stragglers sit elsewhere and are outvoted. */
function actionMargin(lines) {
  const counts = new Map();
  lines.forEach((l) => {
    const k = Math.round(l.x / 4) * 4;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const threshold = Math.max(3, lines.length * 0.08);
  const candidates = [...counts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k);
  return candidates.length ? Math.min(...candidates) : Math.min(...lines.map((l) => l.x));
}

/* Exported for tests: classify positioned lines into screenplay elements. */
export function classifyLines(lines) {
  const body = lines.filter((l) => !NOISE_RE.test(l.text));
  if (!body.length) return [];
  // Indents are measured in points; a screenplay inch is 72pt at 12pt Courier.
  const margin = actionMargin(body);
  const unit = (body.find((l) => l.size) || { size: 12 }).size / 12;
  const elements = [];
  let prev = null;

  body.forEach((line) => {
    const d = (line.x - margin) / unit;
    const text = line.text;
    let type;
    if (d < 20) {
      if (HEADING_RE.test(text)) type = 'heading';
      else if (isUpper(text) && TRANSITION_RE.test(text)) type = 'transition';
      else type = 'action';
    } else if (d >= 230) {
      type = 'transition';
    } else if (d >= 115 && isUpper(text.replace(/\(.*?\)/g, '')) && text.length <= 40) {
      type = 'character';
    } else if (text.startsWith('(') && d >= 70) {
      type = 'parenthetical';
    } else if (d >= 30) {
      type = 'dialogue';
    } else {
      type = 'action';
    }

    // Join wrapped lines of the same element. A vertical gap bigger than a
    // line and a half (or a page turn) starts a new action paragraph.
    const gap = prev && prev.page === line.page ? prev.y - line.y : Infinity;
    const continues =
      prev &&
      prev.type === type &&
      (type === 'dialogue' || (type === 'action' && gap <= line.size * 1.6)) &&
      line.page === prev.page;
    if (continues) {
      elements[elements.length - 1].text += ` ${text}`;
    } else if (
      prev &&
      prev.type === 'parenthetical' &&
      type === 'parenthetical' &&
      !prev.text.endsWith(')')
    ) {
      elements[elements.length - 1].text += ` ${text}`;
    } else {
      elements.push({ type, text });
    }
    prev = { ...line, type, text: elements[elements.length - 1].text };
  });
  return elements;
}

export async function parsePdf(file, fallbackTitle = 'Screenplay') {
  const lines = await pdfLines(file);
  if (!lines.length) {
    throw new Error(
      'No text was found in this PDF. If it is a scan, export the screenplay from your writing app instead.',
    );
  }
  // A title page has no scene headings; its first line is the title.
  let title = fallbackTitle;
  const firstPage = lines.filter((l) => l.page === 1);
  let body = lines;
  if (lines.some((l) => l.page > 1) && !firstPage.some((l) => HEADING_RE.test(l.text))) {
    const named = firstPage.find((l) => l.text.length < 70 && !/^(written by|by)\b/i.test(l.text));
    if (named) title = named.text;
    body = lines.filter((l) => l.page > 1);
  }
  const elements = classifyLines(body);
  if (!elements.some((e) => e.type === 'heading')) {
    throw new Error(
      'No scene headings (INT./EXT.) were found. Is this a screenplay in standard format?',
    );
  }
  return elementsToScenes(elements, title);
}

/* ---------------- Entry point ---------------- */

export async function readScreenplayFile(file) {
  if (!file) throw new Error('Choose a screenplay file first.');
  if (file.size > SCREENPLAY_MAX_BYTES) {
    throw new Error(
      `That file is too large — keep it under ${SCREENPLAY_MAX_BYTES / 1024 / 1024}MB.`,
    );
  }
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.fdx') || file.type === 'application/xml' || file.type === 'text/xml') {
    return { source: 'fdx', ...parseFdx(await file.text(), base) };
  }
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return { source: 'pdf', ...(await parsePdf(file, base)) };
  }
  throw new Error('Choose a PDF or a Final Draft (.fdx) screenplay.');
}

/* ---------------- Quick board: beats -> panels, no AI ---------------- */

const secondsFor = (text) => {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return Math.min(8, Math.max(1.5, words / 2.6));
};

/* One panel per beat, with shot choices a board artist would start from:
   establish the space, cover action wide, cut in on whoever is speaking. */
export function quickPanelsForScene(scene, fps, maxPanels = 24) {
  const exterior = /^\s*EXT/i.test(scene.heading);
  const panels = [];
  const firstAction = scene.beats.find((b) => b.kind === 'action');
  panels.push(
    makePanel({
      shotType: exterior ? 'ESTABLISHING' : 'WIDE',
      angle: exterior ? 'HIGH' : 'EYE-LEVEL',
      lens: 'WIDE',
      action: (firstAction ? firstAction.text : scene.heading).slice(0, 400),
      durationFrames: Math.round(3 * fps),
      cast: scene.cast.slice(0, 3),
    }),
  );

  let lastSpeaker = '';
  let cutIn = 0;
  const beats = scene.beats.filter((b) => b !== firstAction).slice(0, maxPanels - 1);
  beats.forEach((beat) => {
    if (beat.kind === 'action') {
      const cast = extractCast(beat.text, 3);
      panels.push(
        makePanel({
          shotType: cast.length > 1 ? 'TWO-SHOT' : cast.length === 1 ? 'MEDIUM' : 'WIDE',
          action: beat.text.slice(0, 400),
          durationFrames: Math.round(secondsFor(beat.text) * fps),
          cast,
        }),
      );
      return;
    }
    // Alternate coverage on a dialogue exchange: clean single, OTS, closer.
    const other = scene.cast.find((c) => c !== beat.character) || '';
    const shotType =
      beat.character === lastSpeaker
        ? 'CLOSE-UP'
        : ['MEDIUM CLOSE-UP', 'OTS', 'CLOSE-UP'][cutIn++ % 3];
    lastSpeaker = beat.character;
    panels.push(
      makePanel({
        shotType,
        action: `${beat.character || 'Someone'} speaks.`,
        dialogue: beat.text.slice(0, 300),
        durationFrames: Math.round(secondsFor(beat.text) * fps),
        cast:
          shotType === 'OTS'
            ? [other, beat.character].filter(Boolean)
            : [beat.character].filter(Boolean),
      }),
    );
  });
  return panels;
}
