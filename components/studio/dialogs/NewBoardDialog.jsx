'use client';

import { useEffect, useState } from 'react';
import { Clapperboard, ScrollText, Images, Square, Sparkles, ChevronDown, FolderOpen, PenLine, Film } from 'lucide-react';
import { getProject } from '@/lib/store';
import { ASPECT_RATIOS, ART_STYLES, COVERAGE_STYLES } from '@/lib/vocab';
import {
  buildBoard,
  startEmpty,
  runImport,
  readScreenplay,
  writeScene,
  enableFreeModel,
  loadDemoBoard,
  MAX_SCENE_LENGTH,
} from '@/lib/actions';
import { IMPORT_MAX_FILES } from '@/lib/ai';
import { aiState } from '@/lib/aiState';
import Modal from '../Modal';
import { Dropzone, Spinner } from '../ui';

const SAMPLE_SCENE = `INT. ROOFTOP GREENHOUSE — NIGHT

Rain hammers the glass. MAYA (30s) waters a dying lemon tree by torchlight. The door bangs open — JOEL (40s), soaked, holding an envelope.

JOEL
They sold the building.

Maya doesn't turn around. She keeps watering.

MAYA
I know. I signed it.

Joel crosses to her and grabs the watering can. Water spills across the floor between them.

JOEL
You said you'd tell them yourself.

MAYA
I'm telling you now — I changed my mind.

She takes the envelope, tears it in half, and walks out into the rain.`;

const TABS = [
  { key: 'scene', label: 'From a scene', icon: Clapperboard, blurb: 'Paste or write a scene — AI breaks it into shots' },
  { key: 'screenplay', label: 'Screenplay', icon: ScrollText, blurb: 'A whole script, PDF or Final Draft' },
  { key: 'import', label: 'Existing board', icon: Images, blurb: 'Read a PDF or photos into panels' },
  { key: 'blank', label: 'Blank', icon: Square, blurb: 'Start from one empty panel' },
];

function AiNotice({ ai, onOpenSettings, need = 'text' }) {
  const ok = need === 'vision' ? ai.vision : ai.text.ok !== false;
  if (ok) return null;
  return (
    <div className="callout isWarn">
      <Sparkles size={15} aria-hidden="true" />
      <p>
        {need === 'vision'
          ? ai.text.free
            ? 'Reading an existing board needs Claude vision — the free model cannot see images.'
            : 'Reading an existing board needs an Anthropic key — the server has none and none is set in this browser.'
          : 'AI is off: no API key is set on the server or in this browser.'}{' '}
        {need !== 'vision' && ai.canUseFree ? (
          <>
            <button type="button" className="linkBtn" onClick={enableFreeModel}>
              Use the free model
            </button>{' '}
            (no key, slower) or{' '}
          </>
        ) : null}
        <button type="button" className="linkBtn" onClick={onOpenSettings}>
          {need === 'vision' && ai.text.free ? 'Switch provider in Settings' : 'add your key in Settings'}
        </button>
      </p>
    </div>
  );
}

/* "Write the scene for me": a one-line idea in, a screenplay scene out,
   dropped into the scene box for you to read and edit before boarding. */
function ScenePrompt({ ai, onWritten, currentScene }) {
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previous, setPrevious] = useState(null);

  const write = async () => {
    setError('');
    setBusy(true);
    try {
      const text = await writeScene(idea);
      setPrevious(currentScene);
      onWritten(text);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scenePrompt">
      <label htmlFor="nbIdea" className="scenePromptLabel">
        <PenLine size={13} aria-hidden="true" /> Write it for me
        <span className="optional">— describe an idea, get a screenplay scene</span>
      </label>
      <div className="promptRow">
        <input
          id="nbIdea"
          maxLength={600}
          value={idea}
          disabled={busy}
          placeholder="e.g. Two thieves argue in a getaway van while the police scanner crackles"
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy && idea.trim()) write();
          }}
        />
        <button
          type="button"
          className="btn btn-amber"
          disabled={busy || !idea.trim() || ai.text.ok === false}
          onClick={write}
        >
          {busy ? <Spinner /> : <Sparkles size={14} aria-hidden="true" />}
          {busy ? 'Writing…' : currentScene.trim() ? 'Rewrite scene' : 'Write scene'}
        </button>
      </div>
      {busy && ai.text.free ? (
        <p className="dialogNote">
          The free model answers about once every {ai.freeGap || 30} seconds — this can take up to a minute.
        </p>
      ) : null}
      {previous !== null && !busy ? (
        <p className="dialogNote">
          Scene written — edit it below, then build the board.{' '}
          {previous.trim() ? (
            <button
              type="button"
              className="linkBtn"
              onClick={() => {
                onWritten(previous);
                setPrevious(null);
              }}
            >
              Restore my previous text
            </button>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <div className="errorMsg" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default function NewBoardDialog({ open, initialTab = 'scene', onClose, onScreenplay, onOpenSettings, onOpenProjectFile }) {
  const [tab, setTab] = useState(initialTab);
  const [title, setTitle] = useState('');
  const [aspectKey, setAspectKey] = useState('16:9');
  const [fps, setFps] = useState(24);
  const [artStyle, setArtStyle] = useState('storyboard');
  const [showSettings, setShowSettings] = useState(false);
  const [scene, setScene] = useState('');
  const [styles, setStyles] = useState(['classic', 'minimal', 'dynamic']);
  const [custom, setCustom] = useState('');
  const [scriptFiles, setScriptFiles] = useState([]);
  const [importFiles, setImportFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ai = aiState();

  // Each time it opens, start from the current board's settings.
  useEffect(() => {
    if (!open) return;
    const p = getProject();
    setTab(initialTab);
    // A new board gets its own name; only the format settings carry over.
    setTitle('');
    setAspectKey(p.aspect);
    setFps(p.fps);
    setArtStyle(p.artStyle);
    setScene(p.scene || '');
    setError('');
    setBusy(false);
  }, [open, initialTab]);

  const base = () => ({
    title: title.trim() || 'Untitled Board',
    aspect: aspectKey,
    fps: Number(fps) || 24,
    artStyle,
    scene: scene.trim(),
  });

  const toggleStyle = (key) =>
    setStyles((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const styleDefs = () => {
    const defs = COVERAGE_STYLES.filter((s) => styles.includes(s.key));
    if (styles.includes('custom') && custom.trim()) defs.push({ key: 'custom', name: 'Custom', desc: custom.trim() });
    return defs;
  };

  const submit = async () => {
    setError('');
    if (tab === 'scene') {
      if (styles.includes('custom') && !custom.trim() && styleDefs().length === 0) {
        setError('Describe your custom coverage style, or pick one of the presets.');
        return;
      }
      const problem = buildBoard(base(), styleDefs());
      if (problem) setError(problem);
      else onClose();
    } else if (tab === 'blank') {
      startEmpty(base());
      onClose();
    } else if (tab === 'screenplay') {
      setBusy(true);
      try {
        const screenplay = await readScreenplay(scriptFiles[0]);
        onScreenplay(screenplay, base());
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    } else if (tab === 'import') {
      setBusy(true);
      try {
        await runImport(importFiles, base());
        onClose();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    }
  };

  const action = {
    scene: { label: `Build board${styleDefs().length > 1 ? ` · ${styleDefs().length} styles` : ''}`, disabled: !scene.trim() },
    screenplay: { label: busy ? 'Reading…' : 'Read screenplay', disabled: !scriptFiles.length || busy },
    import: { label: busy ? 'Reading the board…' : 'Import board', disabled: !importFiles.length || busy },
    blank: { label: 'Create blank board', disabled: false },
  }[tab];

  const aspectLabel = (ASPECT_RATIOS.find((a) => a.key === aspectKey) || ASPECT_RATIOS[0]).label;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a board"
      subtitle="Your current board stays recoverable with Undo."
      size="lg"
      initialFocus={tab === 'scene' ? '#nbScene' : undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onOpenProjectFile}>
            <FolderOpen size={15} aria-hidden="true" /> Open a project file
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            title="A finished three-scene board that shows off every feature"
            onClick={() => {
              loadDemoBoard();
              onClose();
            }}
          >
            <Film size={15} aria-hidden="true" /> Load demo board
          </button>
          <div className="footSpacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-amber" disabled={action.disabled} onClick={submit}>
            {busy ? <Spinner /> : null}
            {action.label}
          </button>
        </>
      }
    >
      <div className="tabList" role="tablist" aria-label="How to start">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`nbTab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`nbPanel-${t.key}`}
            className={`tabCard ${tab === t.key ? 'isActive' : ''}`}
            onClick={() => {
              setTab(t.key);
              setError('');
            }}
          >
            <t.icon size={18} aria-hidden="true" />
            <span className="tabTitle">{t.label}</span>
            <span className="tabBlurb">{t.blurb}</span>
          </button>
        ))}
      </div>

      <div className="boardSettings">
        <div className="setupField grow">
          <label htmlFor="nbTitle">Board title</label>
          <input
            id="nbTitle"
            maxLength={90}
            placeholder="Untitled Board"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="settingsToggle"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        >
          <span>
            {aspectKey} · {fps} fps · {(ART_STYLES.find((a) => a.key === artStyle) || ART_STYLES[0]).name}
          </span>
          <ChevronDown size={14} aria-hidden="true" className={showSettings ? 'flip' : ''} />
        </button>
      </div>
      {showSettings ? (
        <div className="setupGrid">
          <div className="setupField">
            <label htmlFor="nbAspect">Aspect ratio</label>
            <select id="nbAspect" value={aspectKey} onChange={(e) => setAspectKey(e.target.value)}>
              {ASPECT_RATIOS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="setupField">
            <label htmlFor="nbFps">Frame rate</label>
            <select id="nbFps" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={24}>24 fps — film</option>
              <option value={25}>25 fps — PAL</option>
              <option value={30}>30 fps — video</option>
            </select>
          </div>
          <div className="setupField">
            <label htmlFor="nbArt">Art direction (for line art)</label>
            <select id="nbArt" value={artStyle} onChange={(e) => setArtStyle(e.target.value)}>
              {ART_STYLES.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <p className="dialogNote span3">
            {aspectLabel}. {(ART_STYLES.find((a) => a.key === artStyle) || ART_STYLES[0]).desc}
          </p>
        </div>
      ) : null}

      <div role="tabpanel" id={`nbPanel-${tab}`} aria-labelledby={`nbTab-${tab}`} className="tabPanel">
        {tab === 'scene' ? (
          <>
            <AiNotice ai={ai} onOpenSettings={onOpenSettings} />
            <ScenePrompt ai={ai} currentScene={scene} onWritten={setScene} />
            <div className="setupField">
              <label htmlFor="nbScene">
                Scene
                <button type="button" className="linkBtn labelAction" onClick={() => setScene(SAMPLE_SCENE)}>
                  Try a sample scene
                </button>
              </label>
              <textarea
                id="nbScene"
                rows={8}
                maxLength={MAX_SCENE_LENGTH}
                value={scene}
                onChange={(e) => setScene(e.target.value)}
                placeholder={'INT. KITCHEN — DAY\n\nMAYA pours coffee. JOEL leans on the counter, arms crossed.\n\nJOEL: You said you\'d tell them yourself.\nMAYA slams the pot down.'}
              />
              <div className={`charCounter ${scene.length >= MAX_SCENE_LENGTH ? 'limit' : ''}`}>
                {scene.length} / {MAX_SCENE_LENGTH}
              </div>
            </div>
            <div className="setupSubhead">Coverage styles · each becomes its own scene to compare</div>
            <div className="styleChips">
              {[...COVERAGE_STYLES, { key: 'custom', name: 'Custom', desc: 'Describe your own approach and generate to that.' }].map((s) => (
                <label key={s.key} className={`styleChip ${styles.includes(s.key) ? 'isOn' : ''}`}>
                  <input type="checkbox" checked={styles.includes(s.key)} onChange={() => toggleStyle(s.key)} />
                  <span className="chipTitle">{s.name}</span>
                  <span className="chipDesc">{s.desc}</span>
                </label>
              ))}
            </div>
            {ai.text.free && styleDefs().length > 1 ? (
              <p className="dialogNote">
                On the free model each style is one request, about {ai.freeGap || 30} s apart — {styleDefs().length} styles
                take roughly {Math.ceil((styleDefs().length * ((ai.freeGap || 30) + 15)) / 60)} min. The board opens
                straight away and fills in as each style lands.
              </p>
            ) : null}
            {styles.includes('custom') ? (
              <div className="setupField">
                <label htmlFor="nbCustom">Custom coverage description</label>
                <textarea
                  id="nbCustom"
                  rows={2}
                  maxLength={300}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="e.g. Entirely handheld, no wides — favour extreme close-ups on hands and eyes, cut on movement."
                />
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'screenplay' ? (
          <>
            <Dropzone
              accept=".fdx,.pdf,application/pdf,application/xml,text/xml"
              files={scriptFiles}
              onFiles={setScriptFiles}
              title="Drop a screenplay here, or click to choose"
              hint="PDF from any screenwriting app, or Final Draft .fdx · up to 25 MB"
            />
            <p className="dialogNote">
              It is read here in your browser — scene headings, action, characters and dialogue — and then you pick which
              scenes to board. Every panel starts as an instant stick-figure sketch; AI coverage is optional.
            </p>
          </>
        ) : null}

        {tab === 'import' ? (
          <>
            <AiNotice ai={ai} onOpenSettings={onOpenSettings} need="vision" />
            <Dropzone
              accept="application/pdf,image/*"
              multiple
              files={importFiles}
              onFiles={(list) => setImportFiles(list.slice(0, IMPORT_MAX_FILES))}
              title="Drop storyboard pages here, or click to choose"
              hint={`A PDF or photos of an existing board · up to ${IMPORT_MAX_FILES} files, 15 MB each`}
            />
            <p className="dialogNote">
              Claude reads each frame into a panel with its shot type, angle, action and dialogue. Vision is never routed
              to a local model, so without an Anthropic key this is unavailable rather than silently sent elsewhere.
            </p>
          </>
        ) : null}

        {tab === 'blank' ? (
          <div className="blankHint">
            <Square size={36} aria-hidden="true" />
            <p>
              One empty {aspectKey} panel at {fps} fps. Draw with the tools on the left, add panels with <kbd className="kbd">N</kbd>,
              and use <strong>Quick sketch</strong> to block any panel instantly.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="errorMsg" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
