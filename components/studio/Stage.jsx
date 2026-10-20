'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  MousePointer2,
  Brush,
  Slash,
  Square,
  Circle,
  Eraser,
  Eye,
  Hand,
  Sparkles,
  Users,
  CloudOff,
} from 'lucide-react';
import {
  getUI,
  getProject,
  update,
  activePanel,
  activeLayer,
  aspect,
  allPanels,
  panelNumber,
  totalFrames,
  isEditable,
} from '@/lib/store';
import { mountStage, renderStage, framesToLabel } from '@/lib/stage';
import { TOOLS } from '@/lib/draw';
import { currentBoard, reviewTotals, takeOverEditing } from '@/lib/cloud';
import { quickSketch } from '@/lib/actions';
import { toast } from '@/lib/studioBus';
import { useBus } from './hooks';
import { Kbd } from './ui';

const TOOL_ICONS = {
  select: MousePointer2,
  brush: Brush,
  line: Slash,
  rect: Square,
  ellipse: Circle,
  eraser: Eraser,
};

const SWATCHES = [
  { value: '#1B1400', name: 'Ink' },
  { value: '#5A5244', name: 'Graphite' },
  { value: '#B23A2B', name: 'Red pencil' },
  { value: '#2F5D8A', name: 'Blue pencil' },
  { value: '#DCD6C4', name: 'Paper (white-out)' },
];

export function ToolRail() {
  const ui = getUI();
  const locked = !isEditable();
  return (
    <div
      className={`toolRail ${locked ? 'isLocked' : ''}`}
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="vertical"
      title={locked ? 'This board is view-only for you right now' : undefined}
    >
      {TOOLS.map((tool) => {
        const Icon = TOOL_ICONS[tool.key];
        const active = ui.tool === tool.key;
        return (
          <button
            key={tool.key}
            type="button"
            className={`toolBtn ${active ? 'isActive' : ''}`}
            aria-pressed={active}
            aria-label={`${tool.label} tool`}
            title={`${tool.label} (${tool.hint})`}
            onClick={() => update((u) => (u.tool = tool.key))}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="toolKey" aria-hidden="true">
              {tool.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* Hosts the imperative SVG stage from lib/stage.js. React mounts it once and
   asks it to re-render on every store tick; the stage itself diffs layers so
   unchanged artwork is not rebuilt. */
export function StageCanvas({ tick }) {
  const hostRef = useRef(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  useEffect(() => {
    mountStage(hostRef.current, {
      onStatus(message) {
        clearTimeout(noticeTimer.current);
        setNotice(message || null);
        if (message) noticeTimer.current = setTimeout(() => setNotice(null), 3800);
      },
    });
    renderStage();
    return () => clearTimeout(noticeTimer.current);
  }, []);

  useLayoutEffect(() => {
    renderStage();
  }, [tick]);

  const dims = aspect();
  const panel = activePanel();
  const editable = isEditable();
  const ui = getUI();
  const empty =
    panel && panel.layers.every((l) => !l.svg.trim() && !(l.kind === 'raster' && l.src));

  return (
    <div className="stageWrap">
      <div
        className="stageFrame"
        style={{ '--ratio': dims.w / dims.h }}
        data-tool={ui.tool}
      >
        <div ref={hostRef} className="stageHost" />
        {!editable ? (
          <div className="stageFlag">
            <Eye size={13} aria-hidden="true" /> View only
          </div>
        ) : null}
        {notice ? (
          <div className="stageNotice" role="status">
            <Hand size={14} aria-hidden="true" /> {notice}
          </div>
        ) : null}
        {empty && editable && !ui.playing ? (
          <div className="stageEmpty">
            <p>
              An empty panel. Draw with <Kbd>B</Kbd>, or block it instantly:
            </p>
            <button type="button" className="btn btn-amber small" onClick={quickSketch}>
              <Sparkles size={14} aria-hidden="true" /> Quick sketch from the shot fields
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StageBar() {
  const ui = getUI();
  const project = getProject();
  const panel = activePanel();
  const layer = activeLayer();
  const bus = useBus();
  const count = allPanels().length;
  const drawingTool = !['select', 'eraser'].includes(ui.tool);

  return (
    <div className="stageBar">
      <div className={`brushControls ${drawingTool ? '' : 'isMuted'}`}>
        <div className="swatches" role="group" aria-label="Ink colour">
          {SWATCHES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`swatch ${ui.brushColor.toLowerCase() === s.value.toLowerCase() ? 'isActive' : ''}`}
              style={{ background: s.value }}
              aria-label={s.name}
              aria-pressed={ui.brushColor.toLowerCase() === s.value.toLowerCase()}
              title={s.name}
              onClick={() => update((u) => (u.brushColor = s.value))}
            />
          ))}
          <label className="swatch custom" title="Custom colour">
            <span className="visually-hidden">Custom ink colour</span>
            <input
              type="color"
              value={ui.brushColor}
              onChange={(e) => update((u) => (u.brushColor = e.target.value))}
            />
          </label>
        </div>
        <label className="widthControl">
          <span className="visually-hidden">Stroke width</span>
          <span
            className="widthPreview"
            aria-hidden="true"
            style={{ width: Math.max(3, ui.brushWidth), height: Math.max(3, ui.brushWidth), background: ui.brushColor }}
          />
          <input
            type="range"
            min="1"
            max="28"
            step="1"
            value={ui.brushWidth}
            onChange={(e) => update((u) => (u.brushWidth = Number(e.target.value)))}
            title="Stroke width ([ and ])"
          />
          <output>{ui.brushWidth}px</output>
        </label>
        {layer ? (
          <span className="drawTarget" title="New marks go on this layer — pick another in Layers">
            on <strong>{layer.name}</strong>
          </span>
        ) : null}
      </div>

      <div className="stageStatus" role="status" aria-live="polite">
        {bus.progress ? (
          <span className="progressPill">
            <span className="progressTrack">
              <span
                className="progressFill"
                style={{ width: `${Math.round((bus.progress.done / Math.max(1, bus.progress.total)) * 100)}%` }}
              />
            </span>
            {bus.progress.label} · {bus.progress.done}/{bus.progress.total}
          </span>
        ) : bus.status ? (
          <span className="statusText">{bus.status}</span>
        ) : ui.tool === 'select' ? (
          <span className="hintText">Click a mark to select · drag to move · Delete removes it</span>
        ) : ui.tool === 'eraser' ? (
          <span className="hintText">Click or sweep across marks to erase them</span>
        ) : (
          <span className="hintText">Hold Shift for straight lines, squares and circles</span>
        )}
      </div>

      <div className="panelBadge">
        {panel
          ? `Panel ${panelNumber(panel.id)} / ${count} · ${aspect().key} · ${framesToLabel(totalFrames(), project.fps)} total`
          : ''}
      </div>
    </div>
  );
}

export function ShareBar({ onOpenShare }) {
  const board = currentBoard();
  if (!board) return null;
  const totals = reviewTotals();
  const review = totals
    ? [
        totals.approved && `${totals.approved} approved`,
        totals.changes && `${totals.changes} need${totals.changes === 1 ? 's' : ''} changes`,
        totals.open && `${totals.open} open note${totals.open === 1 ? '' : 's'}`,
      ].filter(Boolean)
    : [];
  const saving = { pending: 'unsaved changes', saving: 'saving…', error: 'not saved — retrying' };

  let text;
  let state;
  if (board.gone) {
    text = 'This shared board was deleted or the link is no longer valid.';
    state = 'isGone';
  } else if (board.editing) {
    text = `You are editing · ${saving[board.saveState] || 'saved'}`;
    state = 'isEditing';
  } else if (board.role === 'edit') {
    text = board.lease
      ? `${board.lease.name} is editing — you are watching live`
      : 'Waiting for the editor seat…';
    state = 'isWatching';
  } else {
    text = 'Review link — watch live, leave notes, approve panels';
    state = 'isReviewing';
  }

  return (
    <div className={`shareBar ${state}`}>
      {board.gone ? <CloudOff size={15} aria-hidden="true" /> : <span className="shareDot" aria-hidden="true" />}
      <span className="shareBarText" role="status" aria-live="polite">
        <strong>{board.title}</strong> · {text}
        {review.length ? <span className="shareReview"> · {review.join(' · ')}</span> : null}
      </span>
      {board.role === 'edit' && !board.editing && !board.gone ? (
        <button
          type="button"
          className="btn btn-amber small"
          onClick={async () => {
            try {
              if (await takeOverEditing()) toast('You are editing now', { type: 'success' });
            } catch (e) {
              toast(`Could not take over — ${e.message}`, { type: 'error' });
            }
          }}
        >
          Take over editing
        </button>
      ) : null}
      <button type="button" className="btn btn-ghost small" onClick={onOpenShare}>
        <Users size={14} aria-hidden="true" /> Links &amp; team
      </button>
    </div>
  );
}
