'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Copy, ChevronLeft, ChevronRight, Trash2, ZoomIn, ZoomOut, Video } from 'lucide-react';
import { getProject, getUI, activePanel, allPanels, totalFrames, isEditable, selectPanel } from '@/lib/store';
import { scrubTo, framesToLabel } from '@/lib/stage';
import { addPanelAfter, duplicatePanel, movePanel, movePanelTo, setDuration } from '@/lib/panelOps';
import { deletePanelWithUndo } from '@/lib/actions';
import PanelThumb, { ReviewBadge } from './PanelThumb';
import { IconButton } from './ui';
import { usePersistentState } from './hooks';

const PAD = 14;
const CELL_GAP = 4;
const SCENE_GAP = 16;
const MIN_W = 84;

/* Absolute layout for every cell, computed up front so the playhead and the
   ruler can map between frames and pixels exactly. */
function layoutTrack(entries, pxPerFrame) {
  let x = PAD;
  let frame = 0;
  const cells = [];
  const scenes = [];
  entries.forEach(({ panel, scene }, index) => {
    const prev = entries[index - 1];
    if (!prev || prev.scene.id !== scene.id) {
      if (prev) x += SCENE_GAP - CELL_GAP;
      scenes.push({ id: scene.id, name: scene.name, x, w: 0 });
    }
    const w = Math.max(MIN_W, panel.durationFrames * pxPerFrame);
    const frames = Math.max(1, panel.durationFrames);
    cells.push({ panel, scene, index, x, w, startFrame: frame, frames });
    const group = scenes[scenes.length - 1];
    group.w = x + w - group.x;
    x += w + CELL_GAP;
    frame += frames;
  });
  return { cells, scenes, width: x - CELL_GAP + PAD };
}

function frameToX(cells, frame) {
  for (const c of cells) {
    if (frame < c.startFrame + c.frames) return c.x + ((frame - c.startFrame) / c.frames) * c.w;
  }
  const last = cells[cells.length - 1];
  return last ? last.x + last.w : PAD;
}

function xToFrame(cells, x) {
  for (const c of cells) {
    if (x < c.x) return c.startFrame; // in a gap: snap to the next panel's start
    if (x <= c.x + c.w) return c.startFrame + Math.min(c.frames - 1, Math.floor(((x - c.x) / c.w) * c.frames));
  }
  const last = cells[cells.length - 1];
  return last ? last.startFrame + last.frames - 1 : 0;
}

export default function Timeline() {
  const ui = getUI();
  const project = getProject();
  const editable = isEditable();
  const entries = allPanels();
  const [zoom, setZoom] = usePersistentState('neverBored.timelineZoom.v1', 3);
  const { cells, scenes, width } = layoutTrack(entries, zoom);
  const total = totalFrames();
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id } while dragging a panel
  const [dropAt, setDropAt] = useState(null); // { id, after }
  const [trim, setTrim] = useState(null); // { id, frames } while trimming
  const panel = activePanel();
  const count = entries.length;

  const playX = frameToX(cells, Math.min(Math.max(0, ui.playheadFrame), Math.max(0, total - 1)));

  // Follow the playhead / selection so the active panel is always on screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = cells.find((c) => c.panel.id === ui.panelId);
    const target = ui.playing ? playX : active ? active.x : playX;
    const right = ui.playing ? playX : active ? active.x + active.w : playX;
    if (target < el.scrollLeft + 20 || right > el.scrollLeft + el.clientWidth - 20) {
      el.scrollTo({ left: Math.max(0, target - el.clientWidth / 3), behavior: ui.playing ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.panelId, ui.playing ? Math.round(playX / 200) : 0]);

  /* ---- Ruler scrubbing ---- */
  const scrubFromEvent = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    scrubTo(xToFrame(cells, e.clientX - rect.left));
  };
  const onRulerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromEvent(e);
  };
  const onRulerMove = (e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubFromEvent(e);
  };
  const onRulerKey = (e) => {
    const fps = project.fps;
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -fps, PageUp: fps }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      scrubTo(ui.playheadFrame + (e.shiftKey ? step * fps : step));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      scrubTo(e.key === 'Home' ? 0 : total - 1);
    }
  };

  /* ---- Duration trim on a cell's right edge ---- */
  const trimming = useRef(false);
  const onTrimDown = (e, cell) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    trimming.current = true;
    const startX = e.clientX;
    const base = cell.panel.durationFrames;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const frames = Math.max(1, Math.min(900, Math.round(base + (ev.clientX - startX) / zoom)));
      setTrim({ id: cell.panel.id, frames });
      setDuration(cell.panel.id, frames);
    };
    const up = () => {
      trimming.current = false;
      setTrim(null);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tlHead">
        <h2>Timeline</h2>
        <span className="tlTotal">
          {count} panel{count === 1 ? '' : 's'} · {framesToLabel(total, project.fps)}
        </span>
        <div className="tlZoom" role="group" aria-label="Timeline zoom">
          <IconButton icon={ZoomOut} label="Zoom out" className="ghost small" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.5).toFixed(2)))} />
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.25"
            value={zoom}
            aria-label="Timeline zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <IconButton icon={ZoomIn} label="Zoom in" className="ghost small" onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(2)))} />
        </div>
        <div className="tlSpacer" />
        <div className="tlActions" role="group" aria-label="Panel actions">
          <IconButton
            icon={Plus}
            label="Add panel"
            kbd="N"
            showLabel
            disabled={!editable || !panel}
            onClick={() => panel && addPanelAfter(panel.id)}
          />
          <IconButton
            icon={Copy}
            label="Duplicate"
            kbd="Ctrl D"
            showLabel
            disabled={!editable || !panel}
            onClick={() => panel && duplicatePanel(panel.id)}
          />
          <IconButton
            icon={ChevronLeft}
            label="Move earlier"
            kbd="Alt ←"
            disabled={!editable || !panel}
            onClick={() => panel && movePanel(panel.id, -1)}
          />
          <IconButton
            icon={ChevronRight}
            label="Move later"
            kbd="Alt →"
            disabled={!editable || !panel}
            onClick={() => panel && movePanel(panel.id, 1)}
          />
          <IconButton
            icon={Trash2}
            label="Delete panel"
            className="danger"
            disabled={!editable || count <= 1 || !panel}
            onClick={() => panel && deletePanelWithUndo(panel.id)}
          />
        </div>
      </div>

      <div className="tlScroll" ref={scrollRef}>
        <div className="tlTrack" ref={trackRef} style={{ width }}>
          <div
            className="tlRuler"
            role="slider"
            tabIndex={0}
            aria-label="Playhead — drag or use arrow keys to scrub"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, total - 1)}
            aria-valuenow={ui.playheadFrame}
            aria-valuetext={framesToLabel(ui.playheadFrame, project.fps)}
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onKeyDown={onRulerKey}
          >
            {cells.map((c) => (
              <span key={c.panel.id} className="tlTick" style={{ left: c.x }} aria-hidden="true">
                {framesToLabel(c.startFrame, project.fps).replace(/ 00f$/, '')}
              </span>
            ))}
          </div>

          {scenes.map((s) => (
            <div
              key={s.id}
              className={`tlSceneLabel ${s.id === ui.sceneId ? 'isActive' : ''}`}
              style={{ left: s.x, width: s.w }}
              title={s.name}
            >
              {s.name}
            </div>
          ))}

          {cells.map((c) => {
            const p = c.panel;
            const active = p.id === ui.panelId;
            const dropping = dropAt && dropAt.id === p.id && drag && drag.id !== p.id;
            return (
              <div
                key={p.id}
                className={`tlCellWrap ${drag && drag.id === p.id ? 'isDragging' : ''} ${
                  dropping ? (dropAt.after ? 'dropAfter' : 'dropBefore') : ''
                }`}
                style={{ left: c.x, width: c.w }}
                draggable={editable && !trim}
                onDragStart={(e) => {
                  if (trimming.current) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', p.id);
                  setDrag({ id: p.id });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > rect.left + rect.width / 2;
                  if (!dropAt || dropAt.id !== p.id || dropAt.after !== after) setDropAt({ id: p.id, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && drag.id !== p.id && dropAt) movePanelTo(drag.id, p.id, dropAt.after);
                  setDrag(null);
                  setDropAt(null);
                }}
              >
                <button
                  type="button"
                  className={`tlCell ${active ? 'isActive' : ''}`}
                  aria-label={`Panel ${c.index + 1}, ${p.shotType}, ${framesToLabel(p.durationFrames, project.fps)}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectPanel(p.id)}
                >
                  <div className="tlThumb">
                    <PanelThumb panel={p} />
                    <ReviewBadge panelId={p.id} />
                    {p.camera.enabled ? (
                      <span className="tlCam" title="Camera move">
                        <Video size={11} aria-hidden="true" />
                      </span>
                    ) : null}
                  </div>
                  <div className="tlBar">
                    <span className="tlNum">{c.index + 1}</span>
                    {c.w >= 120 ? <span className="tlShot">{p.shotType}</span> : <span className="tlShot" />}
                    <em>{framesToLabel(trim && trim.id === p.id ? trim.frames : p.durationFrames, project.fps)}</em>
                  </div>
                </button>
                {p.transition !== 'CUT' ? (
                  <span className="tlTransition" title={`Transition: ${p.transition}`}>
                    {p.transition}
                  </span>
                ) : null}
                {editable ? (
                  <span
                    className="tlTrim"
                    role="presentation"
                    title="Drag to change the duration"
                    onPointerDown={(e) => onTrimDown(e, c)}
                  />
                ) : null}
              </div>
            );
          })}

          <div className="tlPlayhead" style={{ transform: `translateX(${playX}px)` }} aria-hidden="true">
            <span className="tlPlayheadKnob" />
          </div>
        </div>
      </div>
    </section>
  );
}
