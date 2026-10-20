'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { COVERAGE_STYLES } from '@/lib/vocab';
import { buildFromScreenplay, estimatePanels, MAX_IMPORT_PANELS } from '@/lib/actions';
import { aiState } from '@/lib/aiState';
import Modal from '../Modal';

export default function ScenePickerDialog({ open, screenplay, base, onClose, onDone }) {
  const [picked, setPicked] = useState(() => new Set());
  const [mode, setMode] = useState('quick');
  const [styleKey, setStyleKey] = useState(COVERAGE_STYLES[0].key);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const ai = aiState();

  useEffect(() => {
    if (!open || !screenplay) return;
    setPicked(new Set(screenplay.scenes.map((_, i) => i)));
    setFilter('');
    setError('');
  }, [open, screenplay]);

  const visible = useMemo(() => {
    if (!screenplay) return [];
    const q = filter.trim().toLowerCase();
    return screenplay.scenes
      .map((scene, i) => ({ scene, i }))
      .filter(
        ({ scene }) =>
          !q ||
          scene.heading.toLowerCase().includes(q) ||
          scene.cast.some((c) => c.toLowerCase().includes(q)) ||
          String(scene.index) === q,
      );
  }, [screenplay, filter]);

  if (!screenplay) return null;

  const chosen = screenplay.scenes.filter((_, i) => picked.has(i));
  const estimate = estimatePanels(chosen, mode);
  const tooMany = estimate > MAX_IMPORT_PANELS;
  const from = screenplay.source === 'fdx' ? 'Final Draft file' : 'PDF';

  const setMany = (indices, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      indices.forEach((i) => (on ? next.add(i) : next.delete(i)));
      return next;
    });

  const submit = () => {
    const problem = buildFromScreenplay(screenplay, chosen, { mode, styleKey, base });
    if (problem) setError(problem);
    else onDone();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Board a screenplay"
      subtitle={`“${screenplay.title}” — ${screenplay.scenes.length} scene${screenplay.scenes.length === 1 ? '' : 's'}, read from the ${from}`}
      size="lg"
      initialFocus="#spBuild"
      footer={
        <>
          <span className={`estimate ${tooMany ? 'isOver' : ''}`}>
            {chosen.length
              ? mode === 'ai'
                ? `About ${estimate} panels · ${chosen.length} AI request${chosen.length === 1 ? '' : 's'}`
                : `About ${estimate} panels · instant`
              : 'No scenes chosen'}
          </span>
          <div className="footSpacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button id="spBuild" type="button" className="btn btn-amber" disabled={!chosen.length} onClick={submit}>
            Board {chosen.length} scene{chosen.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="sceneTools">
        <label className="searchField">
          <Search size={14} aria-hidden="true" />
          <span className="visually-hidden">Filter scenes</span>
          <input
            type="search"
            placeholder="Filter by heading, character or number"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <button type="button" className="chipBtn" onClick={() => setMany(visible.map((v) => v.i), true)}>
          Select {filter ? 'shown' : 'all'}
        </button>
        <button type="button" className="chipBtn" onClick={() => setMany(visible.map((v) => v.i), false)}>
          Select none
        </button>
      </div>

      <ul className="sceneList" aria-label="Scenes">
        {visible.map(({ scene, i }) => {
          const beats = `${scene.beats.length} beat${scene.beats.length === 1 ? '' : 's'}`;
          return (
            <li key={i}>
              <label className={`sceneRow ${picked.has(i) ? 'isOn' : ''}`}>
                <input type="checkbox" checked={picked.has(i)} onChange={(e) => setMany([i], e.target.checked)} />
                <span className="sceneNum">{scene.index}</span>
                <span className="sceneHeading">{scene.heading}</span>
                <span className="sceneMeta">
                  {scene.cast.length ? `${beats} · ${scene.cast.slice(0, 4).join(', ')}` : beats}
                </span>
              </label>
            </li>
          );
        })}
        {!visible.length ? <li className="commentEmpty">No scenes match “{filter}”.</li> : null}
      </ul>

      <div className="setupSubhead">How to board them</div>
      <div className="styleChips two">
        <label className={`styleChip ${mode === 'quick' ? 'isOn' : ''}`}>
          <input type="radio" name="spMode" value="quick" checked={mode === 'quick'} onChange={() => setMode('quick')} />
          <span className="chipTitle">Quick board</span>
          <span className="chipDesc">
            A stick-figure panel for each beat: establish the space, cover the action, cut in on whoever speaks. Instant,
            no AI.
          </span>
        </label>
        <label className={`styleChip ${mode === 'ai' ? 'isOn' : ''}`}>
          <input type="radio" name="spMode" value="ai" checked={mode === 'ai'} onChange={() => setMode('ai')} />
          <span className="chipTitle">AI coverage</span>
          <span className="chipDesc">
            AI breaks each scene into shots in the style below. Starts from the quick board and replaces it scene by
            scene — a failed scene keeps its quick board.
          </span>
        </label>
      </div>
      {mode === 'ai' ? (
        <div className="setupField">
          <label htmlFor="spStyle">Coverage style</label>
          <select id="spStyle" value={styleKey} onChange={(e) => setStyleKey(e.target.value)}>
            {COVERAGE_STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name} — {s.desc}
              </option>
            ))}
          </select>
          {ai.text.ok === false ? (
            <p className="insCallout">AI is off on this server and no key is set in this browser — every scene would keep its quick board.</p>
          ) : null}
        </div>
      ) : null}
      {tooMany ? (
        <div className="errorMsg" role="alert">
          That is about {estimate} panels — more than one board handles well. Board a sequence at a time (up to{' '}
          {MAX_IMPORT_PANELS} panels).
        </div>
      ) : null}
      {error ? (
        <div className="errorMsg" role="alert">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
