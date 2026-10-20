/* Every call that leaves the browser.
 *
 * Five jobs:
 *   shots  — break a scene into camera coverage (text in, JSON out)
 *   sketch — block a panel as stick figures (text in, a small JSON spec out;
 *            sketch.js draws it)
 *   art    — draw a panel as detailed line art (text in, SVG out)
 *   import — read an existing board from a PDF or image (vision in, JSON out)
 *   raster — paint a finished image over a panel's sketch (image in, image
 *            out; server only — see renderPanelImage)
 *
 * Panel art is vector. A generated frame is the same kind of object as a
 * hand-drawn one: it lands on a layer, it can be drawn over, erased into,
 * scaled without mush, and written into a PDF as real geometry. It also means
 * the response is markup that gets mounted into the DOM, so every byte of it
 * goes through svgsafe before it is allowed anywhere near the page.
 *
 * Two routes out for the text tasks:
 *   - a key in this browser  -> straight to Anthropic, this origin opted in
 *   - no key                 -> our own /api/generate, which holds the key
 * The proxy may answer a slow task with 202 { job } and have the page poll
 * for the result (hosts whose functions have a short time limit).
 *
 * The `task` field tells the proxy which budget to apply; the proxy owns the
 * model and token ceiling so a page cannot talk itself into an expensive call.
 */

import {
  VALID_SHOT_TYPES,
  VALID_ANGLES,
  VALID_LENSES,
  VALID_MOVEMENTS,
  TRANSITIONS,
  ART_STYLES,
  RASTER_STYLES,
  INK,
  PAPER,
} from './vocab.js';
import { sanitizeSvgMarkup, isSafeRasterSrc } from './svgsafe.js';
import { loadSettings } from './store.js';
import { normalizeSketchSpec, renderSketchMarkup, SKETCH_SPEC_GUIDE } from './sketch.js';

const DEFAULT_ENDPOINT = '/api/generate';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_ID = 'claude-opus-5-5';

/* Budgets for the bring-your-own-key path. api/_generate-core.js keeps its own
   copy for the proxied path — change one, change the other. Opus 5.5 always
   thinks and that thinking comes out of max_tokens, so every budget sits well
   above the size of the answer itself. Art needs the most room: an SVG
   drawing is far more output than a shot list or a sketch spec. Effort is set
   explicitly — Opus 5.5 defaults to medium, and the quick tasks don't need it. */
const TASK_CONFIG = {
  scene: { maxTokens: 8000, effort: 'low' },
  shots: { maxTokens: 8000, effort: 'low' },
  sketch: { maxTokens: 8000, effort: 'low' },
  art: { maxTokens: 32000, effort: 'medium' },
  import: { maxTokens: 12000, effort: 'low' },
};

export const IMPORT_MAX_FILES = 6;
export const IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const IMPORT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
/* What a hosted function will accept in one request body, base64 included. */
const PROXY_MAX_BODY_CHARS = 4.4 * 1024 * 1024;
const JOB_POLL_MS = 2500;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

function getApiKey() {
  return (loadSettings().apiKey || '').trim();
}
export function getEndpoint() {
  return (loadSettings().endpoint || '').trim() || DEFAULT_ENDPOINT;
}
export function hasOwnKey() {
  return getApiKey().length > 0;
}
/* The free hosted model (see server/generate-core.js) is opt-in: chosen under
   Settings, never a silent fallback, because it is a third-party service. */
export function usingFreeModel() {
  return loadSettings().provider === 'free';
}

function readError(data, status) {
  const detail = (data && data.error && (data.error.message || data.error)) || '';
  return typeof detail === 'string' && detail ? detail : `Request failed (${status})`;
}

/* A refusal comes back as a normal 200 with stop_reason "refusal". */
function textOf(data) {
  if (data && data.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined this request. Rephrase the scene or the panel action and try again.',
    );
  }
  return ((data && data.content) || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* POST to the proxy, following a 202 job to completion. Returns parsed JSON. */
async function callEndpoint(body) {
  const endpoint = getEndpoint();
  const headers = { 'Content-Type': 'application/json' };
  // A hosted beta can require a code before it will spend its key.
  const code = (loadSettings().accessCode || '').trim();
  if (code) headers['x-access-code'] = code;
  let resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const parse = async () => {
    try {
      return await resp.json();
    } catch {
      // A static host with no serverless function answers /api/generate with
      // its own 404 page, so the parse fails rather than the request.
      throw new Error(
        resp.status === 404 || resp.status === 405
          ? 'No API key set, and this host has no /api/generate function. Add your key under API settings.'
          : resp.status === 413
            ? 'That request is too large for this server. Use fewer or smaller files.'
            : `The server sent a response that could not be read (${resp.status}).`,
      );
    }
  };
  let data = await parse();

  if (resp.status === 202 && data && data.job) {
    const started = Date.now();
    const jobUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}job=${encodeURIComponent(data.job)}`;
    while (Date.now() - started < JOB_TIMEOUT_MS) {
      await sleep(JOB_POLL_MS);
      resp = await fetch(jobUrl, { cache: 'no-store' });
      data = await parse();
      if (resp.status !== 202) break;
    }
    if (resp.status === 202) throw new Error('This is taking too long. Try again in a moment.');
  }
  if (!resp.ok || (data && data.error)) throw new Error(readError(data, resp.status));
  return data;
}

async function callModel(content, task) {
  const cfg = TASK_CONFIG[task] || TASK_CONFIG.shots;
  if (usingFreeModel()) return textOf(await callEndpoint({ content, task, provider: 'free' }));
  const apiKey = getApiKey();
  if (!apiKey) return textOf(await callEndpoint({ content, task }));

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Opts this origin into Anthropic's CORS allowance. Only defensible
      // because the key is the viewer's own, typed by them, kept in their
      // browser — never a shared key baked into the page.
      'anthropic-dangerous-direct-browser-access': 'true',
      // If Opus 5.5 declines, the API re-runs the request on a fallback model
      // in the same call instead of returning nothing.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: cfg.maxTokens,
      output_config: { effort: cfg.effort },
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    }),
  });

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Anthropic sent a response that could not be read (${resp.status}).`);
  }
  if (!resp.ok) throw new Error(readError(data, resp.status));
  return textOf(data);
}

/* ---------------- Shot coverage ---------------- */

function parseShotsJson(rawText) {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Smaller models sometimes wrap the JSON in a sentence; take the object.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error('The response could not be read as JSON. Try again.');
    }
  }
  if (!parsed.shots || !Array.isArray(parsed.shots)) {
    throw new Error('Malformed response — try again.');
  }
  return parsed.shots;
}

function pick(list, value, fallback) {
  return list.includes(value) ? value : fallback;
}

function mapShots(rawShots, fps) {
  return rawShots.slice(0, 40).map((s) => {
    const seconds = Number(s.durationSeconds);
    return {
      shotType: pick(VALID_SHOT_TYPES, s.shotType, 'MEDIUM'),
      angle: pick(VALID_ANGLES, s.angle, 'EYE-LEVEL'),
      lens: pick(VALID_LENSES, s.lens, 'NORMAL'),
      movement: pick(VALID_MOVEMENTS, s.movement, 'STATIC'),
      transition: pick(TRANSITIONS, s.transition, 'CUT'),
      action: typeof s.action === 'string' ? s.action.slice(0, 400) : '',
      dialogue: typeof s.dialogue === 'string' ? s.dialogue.slice(0, 300) : '',
      durationFrames:
        Number.isFinite(seconds) && seconds > 0
          ? Math.round(Math.min(30, seconds) * fps)
          : Math.round(2 * fps),
    };
  });
}

const SHOT_SCHEMA = `Use these exact values:
- shotType: ${VALID_SHOT_TYPES.join(', ')}
- angle: ${VALID_ANGLES.join(', ')}
- lens: ${VALID_LENSES.join(', ')}
- movement: ${VALID_MOVEMENTS.join(', ')}
- transition: ${TRANSITIONS.join(', ')}
- action: what physically happens in frame, under 20 words; name characters in CAPS
- dialogue: the spoken line this panel covers, or "" if none
- durationSeconds: how long the shot holds on screen, a number between 0.5 and 12

Respond with ONLY valid JSON and nothing else — no markdown fences, no preamble:
{"shots":[{"shotType":"...","angle":"...","lens":"...","movement":"...","transition":"...","action":"...","dialogue":"...","durationSeconds":2.5}]}`;

export async function generateCoverage(sceneText, style, fps) {
  const prompt = `You are a senior cinematographer breaking a scene into camera coverage for a storyboard.

SCENE:
"""
${sceneText}
"""

Coverage style to apply: ${style.name} — ${style.desc}

Break this scene into 5 to 10 panels in the style above. Vary your choices across ALL fields — avoid repeating the same shotType, angle, lens or movement unless the story demands it. Think like a DP: each panel serves a specific dramatic purpose and reads as visually distinct from its neighbours. Pace the durations like a real cut — quick panels on reactions and impacts, longer holds on establishing shots and dialogue.

${SHOT_SCHEMA}`;

  return mapShots(parseShotsJson(await callModel(prompt, 'shots')), fps);
}

/* ---------------- Scene from a prompt ---------------- */

/* Turns a one-line idea into a short screenplay scene, in the plain format
   the coverage prompt and the setup textarea expect. The text it returns is
   only ever used as text (a textarea value, then a prompt) — never markup. */
export async function generateSceneText(idea, { maxChars = 6000 } = {}) {
  const prompt = `You are a screenwriter. Write ONE short, filmable screenplay scene from this idea:
"""
${String(idea).slice(0, 600)}
"""

Format, exactly:
- First line: a scene heading such as INT. KITCHEN — NIGHT or EXT. ROOFTOP — DAY
- Then short action paragraphs in present tense. Write CHARACTER NAMES IN CAPS the first time they appear.
- Dialogue as a line with the character's name in caps, then their line on the next line.
- 150 to 300 words, two or three characters, clear visual beats a storyboard artist can draw, and a turn or button at the end.

Respond with ONLY the scene text. No title, no markdown, no commentary.`;

  const text = (await callModel(prompt, 'scene'))
    .replace(/```[a-z]*\n?|```/gi, '')
    .replace(/^\s*(here(?:'s| is)[^\n]*:)\s*/i, '')
    .trim();
  if (!text) throw new Error('The scene came back empty. Try again.');
  return text.slice(0, maxChars);
}

/* ---------------- Shared panel context ---------------- */

/* What the model should know about the panel's scene: the imported script
   text when there is one, otherwise the scene the board was built from. */
function sceneContext(project, context = {}) {
  const text = (context.sceneText || project.scene || '').slice(0, 3000);
  const slug = context.slug ? `Scene heading: ${context.slug}\n` : '';
  if (!text && !slug) return '';
  return `\n\nThe wider scene this panel belongs to, for context only — show only this panel's moment:\n"""\n${slug}${text}\n"""`;
}

function panelBrief(panel) {
  return `- Shot type: ${panel.shotType}
- Camera angle: ${panel.angle}
- Lens: ${panel.lens}
- Camera movement: ${panel.movement}
- Action in frame: ${panel.action || '(not specified — infer something that reads clearly for this shot type)'}
${panel.dialogue ? `- Line being spoken: "${panel.dialogue}"` : ''}`;
}

/* ---------------- Stick-figure sketch ---------------- */

function parseJsonObject(rawText) {
  const text = String(rawText || '').replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The sketch came back unreadable. Try again.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The sketch came back unreadable. Try again.');
  }
}

export async function generatePanelSketch(panel, project, panelW, panelH, context = {}) {
  const prompt = `You are a storyboard artist blocking a single panel as a quick stick-figure sketch. You do not draw — you describe the blocking as JSON and a renderer draws clean stick figures from it.

PANEL
${panelBrief(panel)}${sceneContext(project, context)}

The frame is ${panelW}x${panelH} (aspect ${(panelW / panelH).toFixed(2)}:1).

${SKETCH_SPEC_GUIDE}`;

  const spec = normalizeSketchSpec(parseJsonObject(await callModel(prompt, 'sketch')));
  if (!spec.figures.length && !spec.set.length) {
    throw new Error('The sketch came back empty. Try again.');
  }
  return sanitizeSvgMarkup(renderSketchMarkup(spec, panelW, panelH));
}

/* ---------------- Panel art, as vector ---------------- */

/* The model is told the exact element and attribute vocabulary svgsafe will
   accept. This is prompt-level cooperation, not a security control — svgsafe
   still strips anything outside the list — but it keeps a well-behaved
   response from arriving full of filters and <image> tags that would be
   stripped back to an empty frame. */
const SVG_CONTRACT = `Hard output rules:
- Output ONE <svg> element and nothing else. No markdown fence, no explanation, no XML declaration.
- The root must be exactly: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">
- Allowed elements ONLY: g, path, line, polyline, polygon, rect, circle, ellipse, text, tspan, defs, linearGradient, radialGradient, stop, clipPath.
- Allowed attributes ONLY: d, points, x, y, x1, y1, x2, y2, cx, cy, r, rx, ry, width, height, transform, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, stroke-dasharray, opacity, fill-opacity, stroke-opacity, fill-rule, font-family, font-size, font-weight, text-anchor, offset, stop-color, stop-opacity, id, clip-path.
- NEVER use: script, image, foreignObject, use, a, animate, filter, style attributes, or any url() that is not a local #id reference.
- Colours must be hex (#1B1400), a named colour, or none.
- Use path "d" data with only M, L, H, V, C, S, Q, T, A, Z commands.`;

export async function generatePanelArt(panel, project, panelW, panelH, context = {}) {
  const art = ART_STYLES.find((s) => s.key === project.artStyle) || ART_STYLES[0];

  const prompt = `You are a storyboard artist drawing a single panel as clean vector line art.

PANEL TO DRAW
${panelBrief(panel)}${sceneContext(project, context)}

ART DIRECTION: ${art.name} — ${art.desc}

DRAWING BRIEF
Compose for a ${panelW}x${panelH} frame. Let the shot type drive the framing: a CLOSE-UP fills the frame with a face, an EXTREME WIDE leaves the figure small against the environment, an OTS puts a soft dark shoulder mass in the near foreground. Let the angle drive the horizon and the perspective — a LOW angle puts the horizon near the bottom and makes the subject tower, a BIRD'S-EYE looks down and compresses everything to the ground plane. A ${panel.lens} lens changes how strongly lines converge.

Draw on a ${PAPER} paper ground with ${INK} ink. Build the frame from readable shapes: ground plane or horizon, background masses, then the subject. Suggest figures with confident contour — head, shoulders, torso, limbs in a real pose that matches the action. Do not draw faces in detail on anything wider than a MEDIUM CLOSE-UP. Do not write any labels, captions, or shot names into the drawing.

Aim for 25-70 elements. Enough that it reads as a drawn frame rather than a diagram; not so many that it becomes noise.

${SVG_CONTRACT.replace('{W}', String(panelW)).replace('{H}', String(panelH))}`;

  const raw = await callModel(prompt, 'art');
  const safe = sanitizeSvgMarkup(raw);
  if (!safe.trim()) {
    throw new Error(
      'The generated art came back empty or in a form that could not be used safely. Try again.',
    );
  }
  return safe;
}

/* ---------------- Raster render (server only) ---------------- */

/* Paints a finished frame from the panel's vector sketch. Anthropic models
   don't produce images, so this always goes through the server's image model
   — even when a key is set in this browser — and fails clearly where the
   host has none. Returns a src that has passed isSafeRasterSrc. */
export async function renderPanelImage(sketchPng, panel, project, styleKey, context = {}) {
  const style = RASTER_STYLES.find((s) => s.key === styleKey) || RASTER_STYLES[0];
  const comma = sketchPng.indexOf(',');
  const prompt = `The attached image is a rough storyboard sketch of one film shot. Render it as ${style.desc}.

Keep the sketch's layout exactly: the camera framing, the horizon line, where each figure stands, their poses and which way they face, and the placement of the set pieces. Turn the stick figures into believable people and the outlines into a real location, consistent with this shot:
${panelBrief(panel)}${sceneContext(project, context)}

Do not include any text, captions, speech bubbles, labels, arrows or panel borders in the image.`;

  const data = await callEndpoint({
    task: 'raster',
    content: {
      prompt,
      image: sketchPng.slice(comma + 1),
      mediaType: 'image/png',
      aspect: context.aspect || '16:9',
    },
  });
  const src = data.imageUrl || data.image;
  if (!isSafeRasterSrc(src)) throw new Error('The image service sent back something unusable.');
  return src;
}

/* ---------------- Board import (vision) ---------------- */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

/* Claude reads images at about 1.15 megapixels, so anything bigger is
   bytes nobody looks at. Shrinking first keeps an import inside the request
   size a hosted function will accept. */
function downscaleImage(file, maxSide = 1568) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function buildImportContentBlocks(files) {
  const blocks = [];
  for (const file of files) {
    const mediaType = file.type;
    if (mediaType === 'application/pdf') {
      const dataUrl = await readFileAsDataUrl(file);
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        },
      });
    } else if (mediaType.startsWith('image/')) {
      const dataUrl = (await downscaleImage(file)) || (await readFileAsDataUrl(file));
      const media = dataUrl.slice(5, dataUrl.indexOf(';'));
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: media,
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        },
      });
    } else {
      throw new Error(`"${file.name}" isn't a PDF or image file.`);
    }
  }
  return blocks;
}

export function validateImportFiles(files) {
  if (files.length === 0) return 'Choose a PDF or image file first.';
  if (files.length > IMPORT_MAX_FILES)
    return `Too many files — up to ${IMPORT_MAX_FILES} at a time.`;
  const oversize = files.find((f) => f.size > IMPORT_MAX_FILE_BYTES);
  if (oversize) {
    return `"${oversize.name}" is too large — keep each file under ${IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB.`;
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > IMPORT_MAX_TOTAL_BYTES) {
    return `Files are too large together — keep the total under ${IMPORT_MAX_TOTAL_BYTES / 1024 / 1024}MB.`;
  }
  return null;
}

/* Vision always goes to Anthropic — never a local model. The proxy enforces
   the same rule server-side and rejects rather than degrading. See CLAUDE.md:
   this is the one deliberate exception to the local-model guarantee, and it
   stays explicit. */
export async function importBoardFromFiles(files, fps) {
  if (usingFreeModel()) {
    throw new Error(
      'Reading an existing board needs Claude vision — the free model cannot see images. Switch the AI provider in Settings.',
    );
  }
  const blocks = await buildImportContentBlocks(files);
  if (!hasOwnKey()) {
    const size = blocks.reduce((n, b) => n + (b.source ? b.source.data.length : 0), 0);
    if (size > PROXY_MAX_BODY_CHARS) {
      throw new Error(
        'These files are too large to send through this site. Import fewer pages at once, or add your own key under API settings.',
      );
    }
  }
  const instruction = `You are a film shot-list assistant. The attached file(s) show an existing storyboard or shot list — photographed, scanned, or exported from another tool. It may be a grid of sketched frames, a table of shot descriptions, or both.

Identify every distinct panel across all attached pages, in reading order (left to right, top to bottom, page by page). For each one, extract or infer its shot type, angle, lens, movement, transition, action and any dialogue from whatever is drawn or written. If a field is not visible or legible, make the closest reasonable guess from the drawing rather than defaulting blindly.

${SHOT_SCHEMA}`;

  const text = await callModel([...blocks, { type: 'text', text: instruction }], 'import');
  return mapShots(parseShotsJson(text), fps);
}
