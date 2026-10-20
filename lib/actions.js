/* What the studio's buttons and dialogs actually do. Ported from the
 * original app.js, minus every DOM read: the React components pass values in
 * and get results (or thrown errors) back, and progress goes out through
 * studioBus. Owns no document state — everything lands through commit().
 */

import {
  getProject,
  activePanel,
  update,
  loadSettings,
  saveSettings,
  commit,
  undo as storeUndo,
  redo as storeRedo,
  replaceProject,
  makeProject,
  makeSequence,
  makeScene,
  makePanel,
  makeLayer,
  aspect,
  allPanels,
  findPanel,
  selectPanel,
  isEditable,
  saveNow,
  panelNumber,
  reviveProjectData,
} from './store.js';
import { ASPECT_RATIOS, COVERAGE_STYLES } from './vocab.js';
import { sanitizeSvgMarkup } from './svgsafe.js';
import { invalidateMounted, pause, resetPlayback } from './stage.js';
import { hasVectorArt, deletePanel, deleteScene } from './panelOps.js';
import {
  generateCoverage,
  generatePanelArt,
  generatePanelSketch,
  renderPanelImage,
  importBoardFromFiles,
  validateImportFiles,
  generateSceneText,
} from './ai.js';
import { DEMO_PROJECT } from './demo.js';
import { exportPdf, exportSvg, exportProjectFile, vectorPanelPng } from './exporter.js';
import { autoSketchSpec, renderSketchMarkup } from './sketch.js';
import { readScreenplayFile, quickPanelsForScene } from './screenplay.js';
import { currentBoard, leaveSharedBoard } from './cloud.js';
import { toast, setStatus, setArtBusy, setProgress, setBuilding } from './studioBus.js';

export const MAX_SCENE_LENGTH = 6000;
/* A screenplay board past this many panels gets slow to scrub and too big to
   keep in browser storage, so the quick board is capped per scene and the
   whole import is held to a ceiling. */
export const QUICK_PANELS_PER_SCENE = 16;
export const MAX_IMPORT_PANELS = 900;
const SCREENPLAY_AI_CONCURRENCY = 2;

/* ---------------- History ---------------- */

export function undo() {
  if (storeUndo()) {
    invalidateMounted();
    return true;
  }
  return false;
}

export function redo() {
  if (storeRedo()) {
    invalidateMounted();
    return true;
  }
  return false;
}

const undoAction = { label: 'Undo', run: undo };

/* ---------------- Panel art ---------------- */

export function dimsFor(aspectKey) {
  return ASPECT_RATIOS.find((a) => a.key === aspectKey) || ASPECT_RATIOS[0];
}

/* The instant stick-figure sketch every new panel starts with — drawn from
   the panel's own fields, no model involved. */
function sketchMarkupFor(panel, slug, dims) {
  return sanitizeSvgMarkup(renderSketchMarkup(autoSketchSpec(panel, { slug }), dims.w, dims.h));
}

function withAutoSketch(panel, slug, dims) {
  panel.layers.unshift(
    makeLayer({ name: 'Sketch', kind: 'sketch', svg: sketchMarkupFor(panel, slug, dims) }),
  );
  return panel;
}

function sketchedPanels(shots, slug, dims) {
  return shots.map((shot) => withAutoSketch(makePanel(shot), slug, dims));
}

function sceneContextFor(panelId) {
  const found = findPanel(panelId);
  const scene = found ? found.scene : null;
  return {
    sceneText: scene ? scene.scriptText : '',
    slug: scene ? scene.slug : '',
    aspect: getProject().aspect,
  };
}

/* Generated vector art stacks above the sketch and below hand-drawn layers:
   it is a base to draw over, not something that covers your own marks. A
   rendered image goes on top, since it is the finished frame. */
function placeLayer(panel, kind, name, fields) {
  const existing = panel.layers.find((l) => l.kind === kind);
  if (existing) {
    Object.assign(existing, fields, { visible: true });
    return;
  }
  const layer = makeLayer({ name, kind, ...fields });
  if (kind === 'raster') {
    panel.layers.push(layer);
  } else if (kind === 'sketch') {
    panel.layers.unshift(layer);
  } else {
    const firstHand = panel.layers.findIndex((l) => l.kind === 'art');
    panel.layers.splice(firstHand === -1 ? panel.layers.length : firstHand, 0, layer);
  }
}

function writeLayer(panelId, kind, name, fields) {
  return commit((proj) => {
    proj.sequences.forEach((seq) =>
      seq.scenes.forEach((scene) =>
        scene.panels.forEach((p) => {
          if (p.id === panelId) placeLayer(p, kind, name, fields);
        }),
      ),
    );
  });
}

function guardEditable() {
  if (isEditable()) return true;
  toast('This board is view-only for you right now.', { type: 'error' });
  return false;
}

export function quickSketch() {
  const panel = activePanel();
  if (!panel || !guardEditable()) return;
  const ctx = sceneContextFor(panel.id);
  writeLayer(panel.id, 'sketch', 'Sketch', {
    svg: sketchMarkupFor(panel, ctx.slug, aspect()),
  });
  invalidateMounted();
  setArtBusy(null, '');
  toast('Sketched from the shot fields — on the Sketch layer', { type: 'success', action: undoAction });
}

let artRunning = false;

/* Runs one generation for the active panel and lands the result on the panel
   it was started from, even if you have moved on to another one since. */
async function runArtJob(kind, statusText, work, landed) {
  if (artRunning) return;
  const panel = activePanel();
  if (!panel || !guardEditable()) return;
  artRunning = true;
  setArtBusy(kind, '');
  setStatus(statusText);
  const number = panelNumber(panel.id);
  try {
    const fields = await work(panel);
    if (!writeLayer(panel.id, fields.kind, fields.name, fields.data)) {
      throw new Error('Someone else took over editing, so the result was not added.');
    }
    invalidateMounted();
    setArtBusy(null, '');
    const elsewhere = activePanel() && activePanel().id !== panel.id;
    toast(elsewhere ? `${landed} (panel ${number})` : landed, {
      type: 'success',
      action: elsewhere ? { label: 'Show', run: () => selectPanel(panel.id) } : undoAction,
    });
  } catch (err) {
    setArtBusy(null, err.message);
  } finally {
    setStatus('');
    artRunning = false;
  }
}

export function aiSketch() {
  runArtJob(
    'sketch',
    'Blocking this panel…',
    async (panel) => {
      const { w, h } = aspect();
      const svg = await generatePanelSketch(panel, getProject(), w, h, sceneContextFor(panel.id));
      return { kind: 'sketch', name: 'Sketch', data: { svg } };
    },
    'Sketch staged on the Sketch layer',
  );
}

export function generateArt() {
  runArtJob(
    'art',
    'Drawing this panel…',
    async (panel) => {
      const { w, h } = aspect();
      const svg = await generatePanelArt(panel, getProject(), w, h, sceneContextFor(panel.id));
      return { kind: 'ai', name: 'Line art', data: { svg } };
    },
    'Line art drawn on its own layer',
  );
}

export function renderImage(styleKey) {
  const panel = activePanel();
  if (panel && !hasVectorArt(panel)) {
    setArtBusy(null, 'Sketch or draw the panel first — the render follows the vector art.');
    return;
  }
  runArtJob(
    'raster',
    'Rendering an image from the sketch…',
    async (p) => {
      const png = await vectorPanelPng(p, aspect(), 1024);
      if (!png) throw new Error('Could not read the vector art to render from.');
      const src = await renderPanelImage(png, p, getProject(), styleKey, sceneContextFor(p.id));
      return { kind: 'raster', name: 'Rendered image', data: { src, svg: '' } };
    },
    'Image rendered — hide its layer to get back to the vector',
  );
}

/* ---------------- Structure, with undo toasts ---------------- */

export function deletePanelWithUndo(panelId) {
  const n = panelNumber(panelId);
  if (!deletePanel(panelId)) {
    if (allPanels().length <= 1) toast('A board needs at least one panel.', { type: 'error' });
    return;
  }
  toast(`Panel ${n} deleted`, { action: undoAction });
}

export function deleteSceneWithUndo(sceneId, name) {
  if (!deleteScene(sceneId)) {
    toast('A board needs at least one scene.', { type: 'error' });
    return;
  }
  toast(`"${name}" deleted`, { action: undoAction });
}

/* ---------------- New boards ---------------- */

/* A new board always lands in this browser. If a shared board is open, step
   out of it first so the new one is not uploaded over it. */
function startFresh(project) {
  if (currentBoard()) leaveSharedBoard();
  replaceProject(project);
  // A different board: Play starts from its beginning, not the old playhead.
  resetPlayback();
}

function replaceScenePanels(sceneId, mutate) {
  commit((proj) => {
    proj.sequences.forEach((seq) =>
      seq.scenes.forEach((scene) => {
        if (scene.id === sceneId) mutate(scene);
      }),
    );
  });
}

/* base = { title, aspect, fps, artStyle, scene }. Returns an error message
   when the input is not usable; otherwise starts building and returns null. */
export function buildBoard(base, styles) {
  if (!base.scene) return 'Paste a scene first, or start a blank board.';
  if (base.scene.length > MAX_SCENE_LENGTH) {
    return `The scene is too long — keep it under ${MAX_SCENE_LENGTH} characters.`;
  }
  if (!styles.length) return 'Pick at least one coverage style.';

  // One scene per style, so the approaches sit side by side and the ones you
  // do not want can simply be deleted.
  const scenes = styles.map((style) =>
    makeScene({ name: style.name, slug: '', panels: [makePanel()] }),
  );
  startFresh(
    makeProject({
      ...base,
      sequences: [makeSequence({ name: 'Sequence 1', scenes })],
    }),
  );
  selectPanel(scenes[0].panels[0].id);

  const slug = base.scene.split('\n')[0].trim();
  const dims = dimsFor(base.aspect);
  let done = 0;
  let failed = 0;
  setBuilding(true);
  setProgress({ label: 'Generating coverage', done: 0, total: styles.length });
  setStatus(`Generating ${styles.length} coverage style${styles.length === 1 ? '' : 's'}…`);

  Promise.all(
    styles.map(async (style, i) => {
      const sceneId = scenes[i].id;
      try {
        const shots = await generateCoverage(base.scene, style, base.fps);
        replaceScenePanels(sceneId, (scene) => {
          scene.panels = sketchedPanels(shots, slug, dims);
        });
      } catch (e) {
        failed += 1;
        replaceScenePanels(sceneId, (scene) => {
          scene.name = `${style.name} — failed`;
          scene.slug = e.message.slice(0, 110);
        });
      }
      done += 1;
      setProgress({ label: 'Generating coverage', done, total: styles.length });
    }),
  ).then(() => {
    setBuilding(false);
    setProgress(null);
    setStatus('');
    const first = allPanels()[0];
    if (first) selectPanel(first.panel.id);
    if (failed === styles.length) {
      toast('Coverage could not be generated — see the scene names for why. Check API settings.', {
        type: 'error',
        ms: 7000,
      });
    } else {
      toast(
        failed
          ? `Board built — ${failed} of ${styles.length} styles failed`
          : 'Board built and sketched — refine a panel with AI, or draw over it',
        { type: failed ? 'info' : 'success', ms: 4500 },
      );
    }
  });
  return null;
}

export function startEmpty(base) {
  startFresh(makeProject(base));
  toast('Blank board ready — start drawing', { type: 'success', action: undoAction });
}

export async function runImport(files, base) {
  const problem = validateImportFiles(files);
  if (problem) throw new Error(problem);
  const shots = await importBoardFromFiles(files, base.fps);
  if (!shots.length) throw new Error('No panels were found in those files.');
  const panels = sketchedPanels(shots, '', dimsFor(base.aspect));
  startFresh(
    makeProject({
      ...base,
      title: base.title === 'Untitled Board' ? 'Imported Board' : base.title,
      sequences: [
        makeSequence({
          name: 'Sequence 1',
          scenes: [makeScene({ name: 'Imported', panels })],
        }),
      ],
    }),
  );
  toast(`Imported ${shots.length} panel${shots.length === 1 ? '' : 's'}`, { type: 'success' });
}

/* ---------------- Screenplay import ---------------- */

export async function readScreenplay(file) {
  if (!file) throw new Error('Choose a screenplay file first.');
  const screenplay = await readScreenplayFile(file);
  if (!screenplay.scenes.length) {
    throw new Error(
      'No scenes found. Scene headings need to start with INT. or EXT. — a scanned PDF has no text to read.',
    );
  }
  return screenplay;
}

export function estimatePanels(scenes, mode) {
  if (mode === 'ai') return scenes.length * 7;
  return scenes.reduce((n, s) => n + Math.min(QUICK_PANELS_PER_SCENE, s.beats.length + 1), 0);
}

export function buildFromScreenplay(screenplay, picked, { mode, styleKey, base }) {
  if (!picked.length) return 'Choose at least one scene.';
  const ai = mode === 'ai';
  const estimate = estimatePanels(picked, mode);
  if (estimate > MAX_IMPORT_PANELS) {
    return `That is about ${estimate} panels — more than one board handles well. Board a sequence at a time (up to ${MAX_IMPORT_PANELS} panels).`;
  }

  const dims = dimsFor(base.aspect);
  const fps = base.fps;
  const style = COVERAGE_STYLES.find((s) => s.key === styleKey) || COVERAGE_STYLES[0];
  const scenes = picked.map((sc) =>
    makeScene({
      name: `Scene ${sc.index}`,
      slug: sc.heading.slice(0, 120),
      scriptText: sc.text.slice(0, 20000),
      // The quick board is the starting point either way; AI coverage
      // replaces it scene by scene as the answers come back.
      panels: quickPanelsForScene(sc, fps, QUICK_PANELS_PER_SCENE).map((p) =>
        withAutoSketch(p, sc.heading, dims),
      ),
    }),
  );
  const title = base.title === 'Untitled Board' ? screenplay.title.slice(0, 90) : base.title;
  startFresh(
    makeProject({
      ...base,
      title,
      scene: '',
      sequences: [makeSequence({ name: title.slice(0, 80) || 'Screenplay', scenes })],
    }),
  );
  selectPanel(scenes[0].panels[0].id);

  if (!ai) {
    toast(`Boarded ${scenes.length} scene${scenes.length === 1 ? '' : 's'} as stick-figure sketches`, {
      type: 'success',
    });
    return null;
  }

  let done = 0;
  let failed = 0;
  const total = picked.length;
  const queue = picked.map((sc, i) => ({ sc, sceneId: scenes[i].id }));
  setBuilding(true);
  setProgress({ label: 'AI coverage', done: 0, total });
  setStatus(`Covering scene 1 of ${total}…`);
  const worker = async () => {
    while (queue.length) {
      const { sc, sceneId } = queue.shift();
      try {
        const shots = await generateCoverage(sc.text.slice(0, MAX_SCENE_LENGTH), style, fps);
        replaceScenePanels(sceneId, (scene) => {
          scene.panels = sketchedPanels(shots, sc.heading, dims);
        });
      } catch {
        failed += 1;
        replaceScenePanels(sceneId, (scene) => {
          scene.name = `Scene ${sc.index} — quick board (AI failed)`;
        });
      }
      done += 1;
      setProgress({ label: 'AI coverage', done, total });
      setStatus(done < total ? `Covering scene ${done + 1} of ${total}…` : '');
    }
  };
  Promise.all(Array.from({ length: SCREENPLAY_AI_CONCURRENCY }, worker)).then(() => {
    setBuilding(false);
    setProgress(null);
    setStatus('');
    const first = allPanels()[0];
    if (first) selectPanel(first.panel.id);
    toast(
      failed
        ? `Covered ${done - failed} of ${done} scenes — ${failed} kept their quick board`
        : `Covered ${done} scene${done === 1 ? '' : 's'} with AI coverage`,
      { type: failed ? 'info' : 'success', ms: 4500 },
    );
  });
  return null;
}

/* ---------------- Demo board ---------------- */

/* Builds "The Last Roof" from lib/demo.js: every panel gets its instant
   stick-figure sketch, plus whatever hand-drawn layers the demo lists. */
export function loadDemoBoard() {
  const demo = DEMO_PROJECT;
  const dims = dimsFor(demo.aspect);
  const sequences = demo.sequences.map((seq) =>
    makeSequence({
      name: seq.name,
      scenes: seq.scenes.map((sc) =>
        makeScene({
          name: sc.name,
          slug: sc.slug,
          scriptText: sc.scriptText,
          panels: sc.panels.map(({ seconds, extraLayers = [], camera, ...fields }) => {
            const panel = makePanel({
              ...fields,
              durationFrames: Math.round(seconds * demo.fps),
              ...(camera ? { camera } : {}),
            });
            withAutoSketch(panel, sc.slug, dims);
            extraLayers.forEach((l) =>
              panel.layers.push(
                makeLayer({
                  name: l.name,
                  kind: l.kind,
                  svg: sanitizeSvgMarkup(l.svg),
                  visible: l.visible !== false,
                  locked: Boolean(l.locked),
                }),
              ),
            );
            return panel;
          }),
        }),
      ),
    }),
  );
  startFresh(
    makeProject({
      title: demo.title,
      aspect: demo.aspect,
      fps: demo.fps,
      artStyle: demo.artStyle,
      scene: demo.scene,
      sequences,
    }),
  );
  invalidateMounted();
  const first = allPanels()[0];
  if (first) selectPanel(first.panel.id);
  toast(`Demo board loaded — ${allPanels().length} panels. Press Space to play the animatic.`, {
    type: 'success',
    ms: 6000,
    action: undoAction,
  });
}

/* ---------------- Free AI model ---------------- */

/* One click from any "AI is off" notice. The free model is a third-party
   service, so it is only ever switched on by the user, never as a fallback. */
export function enableFreeModel() {
  saveSettings({ ...loadSettings(), provider: 'free' });
  update(() => {}); // repaint everything that reads aiState()
  toast('Free AI model on — requests go to Pollinations.ai, about 30 s apart. Change it in Settings.', {
    type: 'success',
    ms: 6000,
  });
}

/* A short screenplay scene from a one-line idea, for the setup dialog. */
export async function writeScene(idea) {
  const text = String(idea || '').trim();
  if (text.length < 4) throw new Error('Describe the scene in a few words first.');
  setStatus('Writing a scene…');
  try {
    return await generateSceneText(text, { maxChars: MAX_SCENE_LENGTH });
  } finally {
    setStatus('');
  }
}

/* ---------------- Project files ---------------- */

/* Opens a project JSON saved earlier. It goes through reviveProjectData, the
   same checks as a board from storage or the server — a file from disk is
   untrusted, so its artwork is re-sanitised before anything is mounted. */
export async function openProjectFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a board.');
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a Never Bored project (it is not JSON).');
  }
  const project = reviveProjectData(raw);
  if (!project) throw new Error('That file is not a Never Bored project.');
  startFresh(project);
  invalidateMounted();
  toast(`Opened "${project.title}"`, { type: 'success', action: undoAction });
}

/* ---------------- Export ---------------- */

const EXPORTS = {
  pdf: { busy: 'Building PDF…', run: exportPdf, done: 'PDF contact sheet downloaded' },
  svg: { busy: 'Building SVG…', run: exportSvg, done: 'SVG downloaded — true vector, editable anywhere' },
  json: {
    busy: 'Saving project…',
    run: async () => {
      saveNow();
      return exportProjectFile();
    },
    done: 'Project file downloaded — open it again from the menu',
  },
};

export async function runExport(kind) {
  const job = EXPORTS[kind];
  if (!job) return;
  pause();
  setStatus(job.busy);
  try {
    const { filename } = await job.run();
    toast(`${job.done}${filename ? ` · ${filename}` : ''}`, { type: 'success', ms: 4000 });
  } catch (e) {
    toast(`Export failed — ${e.message}`, { type: 'error' });
  } finally {
    setStatus('');
  }
}
