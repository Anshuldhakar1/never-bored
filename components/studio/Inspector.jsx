'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Sparkles,
  WandSparkles,
  PenTool,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Check,
  CircleAlert,
  MessageSquarePlus,
  Video,
} from 'lucide-react';
import {
  getProject,
  getUI,
  update,
  activePanel,
  findPanel,
  panelNumber,
  isEditable,
} from '@/lib/store';
import {
  VALID_SHOT_TYPES,
  VALID_ANGLES,
  VALID_LENSES,
  VALID_MOVEMENTS,
  TRANSITIONS,
  RASTER_STYLES,
  MOVING_SHOTS,
  shotIconMarkup,
} from '@/lib/vocab';
import { EASING_KEYS, framesToLabel } from '@/lib/stage';
import {
  hasVectorArt,
  mutateActivePanel,
  setMovement,
  setCameraEnabled,
  resetCamera,
  clampFrames,
  addLayer,
  toggleLayerVisible,
  toggleLayerLocked,
  renameLayer,
  setLayerOpacity,
  moveLayer,
  deleteLayer,
} from '@/lib/panelOps';
import {
  currentBoard,
  panelReview,
  getName,
  setName,
  addComment,
  setPanelStatus,
  resolveComment,
  deleteComment,
  canDeleteComment,
} from '@/lib/cloud';
import { quickSketch, aiSketch, generateArt, renderImage, enableFreeModel } from '@/lib/actions';
import { aiState } from '@/lib/aiState';
import { useBus, usePersistentState, useSyncedValue } from './hooks';
import { Spinner, Switch, TrustedSvg } from './ui';

/* ---------------- Building blocks ---------------- */

/* `locked` disables every control in the body through one <fieldset>, so
   read-only mode cannot miss a control — while the header toggle stays
   usable for browsing a board you can't edit. */
function Section({ id, title, open, onToggle, children, aside, locked }) {
  return (
    <section className={`insSection ${open ? 'isOpen' : ''}`}>
      <h3 className="insSectionHead">
        <button type="button" aria-expanded={open} onClick={() => onToggle(id)}>
          <ChevronDown size={14} aria-hidden="true" className="chev" />
          <span>{title}</span>
          {aside ? <span className="insAside">{aside}</span> : null}
        </button>
      </h3>
      {open ? (
        locked === undefined ? (
          <div className="insSectionBody">{children}</div>
        ) : (
          <fieldset className="insSectionBody insEdit" disabled={locked}>
            <legend className="visually-hidden">{title}</legend>
            {children}
          </fieldset>
        )
      ) : null}
    </section>
  );
}

function SelectField({ id, label, value, options, onChange }) {
  return (
    <div className="insField">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({ id, label, value, panelId, field, placeholder, maxLength, rows = 2 }) {
  const [local, setLocal, ref] = useSyncedValue(value, panelId);
  return (
    <div className="insField">
      <label htmlFor={id}>
        {label}
        <span className={`counter ${local.length > maxLength * 0.9 ? 'isNear' : ''}`}>
          {local.length ? `${local.length}/${maxLength}` : ''}
        </span>
      </label>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={local}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => {
          setLocal(e.target.value);
          const next = e.target.value;
          mutateActivePanel((p) => (p[field] = next), `text:${field}`);
        }}
      />
    </div>
  );
}

const SHOT_SHORT = {
  ESTABLISHING: 'Establish',
  'EXTREME WIDE': 'X-Wide',
  WIDE: 'Wide',
  COWBOY: 'Cowboy',
  MEDIUM: 'Medium',
  'MEDIUM CLOSE-UP': 'MCU',
  'CLOSE-UP': 'Close-up',
  'EXTREME CLOSE-UP': 'ECU',
  INSERT: 'Insert',
  'RACK FOCUS': 'Rack',
  OTS: 'OTS',
  'TWO-SHOT': 'Two-shot',
  'GROUP SHOT': 'Group',
  POV: 'POV',
  'REACTION SHOT': 'Reaction',
};

function ShotPicker({ value, onChange }) {
  return (
    <div className="shotGrid" role="radiogroup" aria-label="Shot type">
      {VALID_SHOT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          className={`shotOption ${value === type ? 'isActive' : ''}`}
          title={type}
          onClick={() => onChange(type)}
        >
          <TrustedSvg
            className="shotOptionIcon"
            markup={`<rect x="2" y="2" width="96" height="56" fill="none" stroke="currentColor" stroke-width="3"/>${shotIconMarkup(type)}`}
          />
          <span>{SHOT_SHORT[type] || type}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Review ---------------- */

function timeAgo(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

function ReviewSection({ panel }) {
  const review = panelReview(panel.id) || { status: null, comments: [], open: 0 };
  const status = review.status ? review.status.status : null;
  const [name, setNameLocal, nameRef] = useSyncedValue(getName(), 'name');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleStatus = (next) => run(() => setPanelStatus(panel.id, status === next ? 'none' : next));

  const submit = async () => {
    const note = text.trim();
    if (!note || busy) return;
    if (name.trim() !== getName()) setName(name);
    setBusy(true);
    await run(async () => {
      await addComment(panel.id, note);
      setText('');
    });
    setBusy(false);
  };

  return (
    <div className="insReview">
      <div className="statusRow" role="group" aria-label="Panel review status">
        <button
          type="button"
          className={`statusBtn isApprove ${status === 'approved' ? 'isOn' : ''}`}
          aria-pressed={status === 'approved'}
          onClick={() => toggleStatus('approved')}
        >
          <Check size={14} aria-hidden="true" /> Approve
        </button>
        <button
          type="button"
          className={`statusBtn isChanges ${status === 'changes' ? 'isOn' : ''}`}
          aria-pressed={status === 'changes'}
          onClick={() => toggleStatus('changes')}
        >
          <CircleAlert size={14} aria-hidden="true" /> Needs changes
        </button>
      </div>
      <p className="insHint">
        {review.status
          ? `${status === 'approved' ? 'Approved' : 'Changes requested'} by ${review.status.by} · ${timeAgo(review.status.at)}`
          : 'No decision on this panel yet.'}
      </p>

      <ul className="commentList" aria-label="Notes on this panel">
        {review.comments.length ? (
          review.comments.map((c) => (
            <li key={c.id} className={`commentItem ${c.resolved ? 'isResolved' : ''}`}>
              <div className="commentHead">
                <strong>{c.author}</strong>
                <span>{timeAgo(c.at)}</span>
              </div>
              <p className="commentText">{c.text}</p>
              <div className="commentActions">
                <button type="button" className="linkBtn" onClick={() => run(() => resolveComment(c.id, !c.resolved))}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {canDeleteComment(c) ? (
                  <button
                    type="button"
                    className="linkBtn"
                    aria-label={`Delete note from ${c.author}`}
                    onClick={() => run(() => deleteComment(c.id))}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          ))
        ) : (
          <li className="commentEmpty">No notes on this panel yet.</li>
        )}
      </ul>

      <div className="insField">
        <label htmlFor="insReviewName">Your name</label>
        <input
          id="insReviewName"
          ref={nameRef}
          maxLength={40}
          value={name}
          placeholder="Shown on your notes"
          onChange={(e) => setNameLocal(e.target.value)}
          onBlur={() => setName(name)}
        />
      </div>
      <div className="insField">
        <label htmlFor="insComment">
          Note <span className="optional">Ctrl+Enter to send</span>
        </label>
        <textarea
          id="insComment"
          rows={2}
          maxLength={1000}
          value={text}
          placeholder="A note for the team on this panel…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <button type="button" className="btn btn-outline wide" disabled={busy || !text.trim()} onClick={submit}>
        {busy ? <Spinner /> : <MessageSquarePlus size={14} aria-hidden="true" />} Add note
      </button>
      {error ? (
        <p className="insError" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- Panel art ---------------- */

function ArtButton({ kind, icon: Icon, title, desc, busyLabel, onClick, disabled, busy, variant }) {
  const running = busy === kind;
  return (
    <button
      type="button"
      className={`artBtn ${variant || ''} ${running ? 'isRunning' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-busy={running}
    >
      <span className="artIcon">{running ? <Spinner size={16} /> : <Icon size={16} aria-hidden="true" />}</span>
      <span className="artText">
        <strong>{running ? busyLabel : title}</strong>
        <small>{desc}</small>
      </span>
    </button>
  );
}

function ArtSection({ panel, onOpenSettings }) {
  const bus = useBus();
  const [rasterStyle, setRasterStyle] = usePersistentState('neverBored.rasterStyle.v1', RASTER_STYLES[0].key);
  const ai = aiState();
  const busy = bus.artBusy;
  const vector = hasVectorArt(panel);
  const noAi = ai.text.ok === false;

  return (
    <div className="artSection">
      <ArtButton
        kind="quick"
        icon={Sparkles}
        title="Quick sketch"
        desc="Stick figures from the shot fields · instant, no AI"
        busy={busy}
        disabled={Boolean(busy)}
        onClick={quickSketch}
      />
      <ArtButton
        kind="sketch"
        icon={WandSparkles}
        title="Sketch with AI"
        desc="Claude stages the blocking from the action"
        busyLabel="Sketching…"
        busy={busy}
        disabled={Boolean(busy)}
        onClick={aiSketch}
        variant="isAmber"
      />
      <ArtButton
        kind="art"
        icon={PenTool}
        title="Detailed line art"
        desc="A full vector frame you can draw over · slower"
        busyLabel="Drawing… this can take a minute"
        busy={busy}
        disabled={Boolean(busy)}
        onClick={generateArt}
      />
      {noAi ? (
        <p className="insCallout">
          AI is off: no API key on the server or in this browser.{' '}
          {ai.canUseFree ? (
            <>
              <button type="button" className="linkBtn" onClick={enableFreeModel}>
                Use the free model
              </button>{' '}
              or{' '}
            </>
          ) : null}
          <button type="button" className="linkBtn" onClick={onOpenSettings}>
            add your key
          </button>
        </p>
      ) : null}
      {ai.text.free && (busy === 'sketch' || busy === 'art') ? (
        <p className="insHint">
          Free model: requests take turns about {ai.freeGap || 30} s apart, so this can take a minute. Keep working —
          the result lands on this panel.
        </p>
      ) : null}

      <div className="insSubhead">Rendered image</div>
      <div className="rasterRow">
        <select
          aria-label="Render style"
          value={rasterStyle}
          disabled={Boolean(busy)}
          onChange={(e) => setRasterStyle(e.target.value)}
        >
          {RASTER_STYLES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-teal"
          disabled={Boolean(busy) || !vector || !ai.raster}
          onClick={() => renderImage(rasterStyle)}
        >
          {busy === 'raster' ? <Spinner /> : <ImageIcon size={14} aria-hidden="true" />}
          {busy === 'raster' ? 'Rendering…' : 'Render'}
        </button>
      </div>
      <p className="insHint">
        {!ai.raster
          ? 'This server has no image model set up, so rendering is off. Vector art and exports still work.'
          : !vector
            ? 'Sketch or draw the panel first — a render follows the vector art’s layout.'
            : 'Paints a finished frame from the vector art onto its own layer. Hide that layer to get back to the vector.'}
      </p>
      {bus.artError ? (
        <p className="insError" role="alert">
          {bus.artError}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- Layers ---------------- */

const KIND_LABEL = { art: 'Drawing', sketch: 'Sketch', ai: 'Line art', raster: 'Image' };

function LayerRow({ panel, layer, index, active }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setNameValue] = useState(layer.name);
  const top = index === panel.layers.length - 1;
  const bottom = index === 0;

  return (
    <li className={`layerRow kind-${layer.kind} ${active ? 'isActive' : ''}`}>
      <button
        type="button"
        className="layerToggle"
        aria-label={`${layer.visible ? 'Hide' : 'Show'} layer ${layer.name}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={() => toggleLayerVisible(panel.id, layer.id)}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      {layer.kind !== 'raster' ? (
        <button
          type="button"
          className="layerToggle"
          aria-label={`${layer.locked ? 'Unlock' : 'Lock'} layer ${layer.name}`}
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={() => toggleLayerLocked(panel.id, layer.id)}
        >
          {layer.locked ? <Lock size={14} /> : <LockOpen size={14} className="dim" />}
        </button>
      ) : (
        <span className="layerToggle placeholder" aria-hidden="true" />
      )}
      {renaming ? (
        <input
          className="layerRename"
          autoFocus
          value={name}
          maxLength={40}
          aria-label="Layer name"
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={() => {
            setRenaming(false);
            if (name.trim() && name !== layer.name) renameLayer(panel.id, layer.id, name.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setNameValue(layer.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="layerName"
          aria-pressed={active}
          title="Click to draw on this layer · double-click to rename"
          onClick={() => update((u) => (u.layerId = layer.id))}
          onDoubleClick={() => {
            setNameValue(layer.name);
            setRenaming(true);
          }}
        >
          <span className={`kindDot kind-${layer.kind}`} aria-hidden="true" />
          <span className="layerLabel">{layer.name}</span>
          <small>{KIND_LABEL[layer.kind] || layer.kind}</small>
        </button>
      )}
      <span className="layerActions">
        <button
          type="button"
          className="layerToggle"
          aria-label={`Move ${layer.name} up`}
          title="Move up"
          disabled={top}
          onClick={() => moveLayer(panel.id, layer.id, 1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className="layerToggle"
          aria-label={`Move ${layer.name} down`}
          title="Move down"
          disabled={bottom}
          onClick={() => moveLayer(panel.id, layer.id, -1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className="layerToggle danger"
          aria-label={`Delete layer ${layer.name}`}
          title="Delete layer"
          disabled={panel.layers.length <= 1}
          onClick={() => deleteLayer(panel.id, layer.id)}
        >
          <Trash2 size={13} />
        </button>
      </span>
    </li>
  );
}

function LayersSection({ panel }) {
  const ui = getUI();
  const activeLayer = panel.layers.find((l) => l.id === ui.layerId);
  return (
    <>
      {/* Top of the list is the top of the stack — the reverse of paint order. */}
      <ul className="layerList">
        {[...panel.layers].reverse().map((layer) => (
          <LayerRow
            key={layer.id}
            panel={panel}
            layer={layer}
            index={panel.layers.indexOf(layer)}
            active={layer.id === ui.layerId}
          />
        ))}
      </ul>
      {activeLayer ? (
        <label className="opacityRow">
          <span>Opacity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={activeLayer.opacity}
            onChange={(e) => setLayerOpacity(panel.id, activeLayer.id, e.target.value)}
          />
          <output>{Math.round(activeLayer.opacity * 100)}%</output>
        </label>
      ) : null}
      <button type="button" className="addRow" onClick={addLayer}>
        <Plus size={13} aria-hidden="true" /> Add drawing layer
      </button>
    </>
  );
}

/* ---------------- Inspector ---------------- */

const DEFAULT_OPEN = {
  review: true,
  art: true,
  shot: true,
  content: true,
  timing: true,
  camera: false,
  layers: true,
};

export default function Inspector({ onOpenSettings }) {
  const panel = activePanel();
  const project = getProject();
  const editable = isEditable();
  const board = currentBoard();
  const [openMap, setOpenMap] = usePersistentState('neverBored.inspector.v1', DEFAULT_OPEN);
  const isOpen = (id) => (id in openMap ? openMap[id] : DEFAULT_OPEN[id]);
  const toggle = (id) => setOpenMap((m) => ({ ...m, [id]: !isOpen(id) }));

  if (!panel) {
    return (
      <aside className="inspector isEmpty" aria-label="Panel inspector">
        <div className="paneHead">
          <h2>Panel</h2>
        </div>
      </aside>
    );
  }

  const found = findPanel(panel.id);
  const fps = project.fps;
  const seconds = panel.durationFrames / fps;
  const review = board ? panelReview(panel.id) : null;
  const moving = MOVING_SHOTS.has(panel.movement);

  return (
    <aside className="inspector" aria-label="Panel inspector">
      <div className="paneHead insHead">
        <TrustedSvg
          className="insHeadIcon"
          markup={`<rect x="2" y="2" width="96" height="56" fill="none" stroke="currentColor" stroke-width="3"/>${shotIconMarkup(panel.shotType)}`}
        />
        <div>
          <h2>Panel {panelNumber(panel.id)}</h2>
          <p className="insHeadSub">
            {found ? found.scene.name : ''} · {panel.shotType}
          </p>
        </div>
      </div>

      <div className="insBody">
        {board ? (
          <Section
            id="review"
            title="Review"
            open={isOpen('review')}
            onToggle={toggle}
            aside={review && (review.open || review.status) ? `${review.open || 0} open` : null}
          >
            <ReviewSection panel={panel} />
          </Section>
        ) : null}

          <Section id="art" locked={!editable} title="Panel art" open={isOpen('art')} onToggle={toggle}>
            <ArtSection panel={panel} onOpenSettings={onOpenSettings} />
          </Section>

          <Section id="shot" locked={!editable} title="Shot" open={isOpen('shot')} onToggle={toggle} aside={panel.shotType}>
            <ShotPicker value={panel.shotType} onChange={(v) => mutateActivePanel((p) => (p.shotType = v))} />
            <div className="insGrid">
              <SelectField
                id="insAngle"
                label="Angle"
                value={panel.angle}
                options={VALID_ANGLES}
                onChange={(v) => mutateActivePanel((p) => (p.angle = v))}
              />
              <SelectField
                id="insLens"
                label="Lens"
                value={panel.lens}
                options={VALID_LENSES}
                onChange={(v) => mutateActivePanel((p) => (p.lens = v))}
              />
              <SelectField id="insMovement" label="Movement" value={panel.movement} options={VALID_MOVEMENTS} onChange={setMovement} />
              <SelectField
                id="insTransition"
                label="Transition out"
                value={panel.transition}
                options={TRANSITIONS}
                onChange={(v) => mutateActivePanel((p) => (p.transition = v))}
              />
            </div>
          </Section>

          <Section id="content" locked={!editable} title="Content" open={isOpen('content')} onToggle={toggle}>
            <TextField
              id="insAction"
              label="Action"
              field="action"
              panelId={panel.id}
              value={panel.action}
              placeholder="What happens in frame…"
              maxLength={400}
              rows={3}
            />
            <TextField
              id="insDialogue"
              label="Dialogue"
              field="dialogue"
              panelId={panel.id}
              value={panel.dialogue}
              placeholder="Line spoken over this panel…"
              maxLength={300}
            />
            <TextField
              id="insNotes"
              label="Notes"
              field="notes"
              panelId={panel.id}
              value={panel.notes}
              placeholder="Production notes, FX, continuity…"
              maxLength={400}
            />
          </Section>

          <Section
            id="timing"
            locked={!editable}
            title="Timing"
            open={isOpen('timing')}
            onToggle={toggle}
            aside={framesToLabel(panel.durationFrames, fps)}
          >
            <DurationField panel={panel} fps={fps} />
            <div className="presetRow" role="group" aria-label="Duration presets">
              {[1, 2, 3, 5, 8].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chipBtn ${Math.abs(seconds - s) < 0.001 ? 'isActive' : ''}`}
                  onClick={() => mutateActivePanel((p) => (p.durationFrames = clampFrames(s * fps)))}
                >
                  {s}s
                </button>
              ))}
            </div>
            <p className="insHint">
              {framesToLabel(panel.durationFrames, fps)} at {fps} fps · drag a panel’s right edge on the timeline to
              trim it.
            </p>
          </Section>

          <Section
            id="camera"
            locked={!editable}
            title="Camera move"
            open={isOpen('camera')}
            onToggle={toggle}
            aside={panel.camera.enabled ? 'On' : moving ? 'Suggested' : null}
          >
            <Switch checked={panel.camera.enabled} onChange={setCameraEnabled} label="Animate the frame" />
            {panel.camera.enabled ? (
              <>
                <SelectField
                  id="insEasing"
                  label="Easing"
                  value={panel.camera.easing}
                  options={EASING_KEYS}
                  onChange={(v) => mutateActivePanel((p) => (p.camera.easing = v))}
                />
                <button type="button" className="btn btn-outline wide" onClick={resetCamera}>
                  <RotateCcw size={14} aria-hidden="true" /> Reset both frames
                </button>
                <p className="insHint">
                  <Video size={12} aria-hidden="true" /> Drag the teal <strong className="tealText">START</strong> and amber{' '}
                  <strong className="amberText">END</strong> frames on the stage; the corner handle zooms. Press Space to play
                  the move.
                </p>
              </>
            ) : (
              <p className="insHint">
                {moving
                  ? `${panel.movement} usually travels — turn this on to plan the move.`
                  : 'Push in, pull out or pan across the panel during playback.'}
              </p>
            )}
          </Section>

          <Section id="layers" locked={!editable} title="Layers" open={isOpen('layers')} onToggle={toggle} aside={`${panel.layers.length}`}>
            <LayersSection panel={panel} />
          </Section>
      </div>
    </aside>
  );
}

function DurationField({ panel, fps }) {
  const [local, setLocal, ref] = useSyncedValue(String(panel.durationFrames), panel.id);
  const secondsText = String(Number((panel.durationFrames / fps).toFixed(2)));
  const [secs, setSecs, secsRef] = useSyncedValue(secondsText, panel.id);
  return (
    <div className="durationRow">
      <div className="insField">
        <label htmlFor="insDuration">Frames</label>
        <input
          ref={ref}
          id="insDuration"
          type="number"
          min="1"
          max="900"
          step="1"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            if (e.target.value === '') return;
            mutateActivePanel((p) => (p.durationFrames = clampFrames(e.target.value)), 'duration');
          }}
          onBlur={() => setLocal(String(panel.durationFrames))}
        />
      </div>
      <div className="insField">
        <label htmlFor="insSeconds">Seconds</label>
        <input
          ref={secsRef}
          id="insSeconds"
          type="number"
          min="0.05"
          max={900 / fps}
          step="0.25"
          value={secs}
          onChange={(e) => {
            setSecs(e.target.value);
            if (e.target.value === '' || !(Number(e.target.value) > 0)) return;
            mutateActivePanel((p) => (p.durationFrames = clampFrames(Number(e.target.value) * fps)), 'duration');
          }}
          onBlur={() => setSecs(secondsText)}
        />
      </div>
    </div>
  );
}
