'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2, Clapperboard } from 'lucide-react';
import { getProject, getUI, isEditable, panelNumber, selectPanel } from '@/lib/store';
import { framesToLabel } from '@/lib/stage';
import { addPanelAfter, addScene, addSequence, renameSequence, updateScene } from '@/lib/panelOps';
import { deleteSceneWithUndo } from '@/lib/actions';
import PanelThumb, { ReviewBadge } from './PanelThumb';
import { useSyncedValue } from './hooks';

/* An input that looks like text until you focus it. Commits on change (blur
   or Enter), like the original navigator, so renaming is one undo step. */
function InlineInput({ value, onCommit, className, label, placeholder, disabled, resetKey, maxLength = 80 }) {
  const [local, setLocal, ref] = useSyncedValue(value, resetKey);
  return (
    <input
      ref={ref}
      className={`inlineInput ${className || ''}`}
      value={local}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local !== value && onCommit(local)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setLocal(value);
          requestAnimationFrame(() => e.target.blur());
        }
      }}
    />
  );
}

export default function Navigator() {
  const project = getProject();
  const ui = getUI();
  const editable = isEditable();
  const [collapsed, setCollapsed] = useState(() => new Set());
  const listRef = useRef(null);
  const fps = project.fps;

  // Keep the selected panel in view as you step, scrub or play through.
  useEffect(() => {
    const node = listRef.current && listRef.current.querySelector('.navPanel.isActive');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [ui.panelId]);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sceneCount = project.sequences.reduce((n, s) => n + s.scenes.length, 0);

  return (
    <aside className="navigator" aria-label="Sequences, scenes and panels">
      <div className="paneHead">
        <h2>Board</h2>
        <button
          type="button"
          className="chipBtn"
          onClick={addSequence}
          disabled={!editable}
          title="Add a sequence"
        >
          <Plus size={13} aria-hidden="true" /> Sequence
        </button>
      </div>
      <div className="navBody" ref={listRef}>
        {project.sequences.map((seq) => (
          <section key={seq.id} className="navSequence">
            <header className="navSeqHead">
              <InlineInput
                className="navSeqName"
                value={seq.name}
                label="Sequence name"
                disabled={!editable}
                resetKey={seq.id}
                onCommit={(name) => renameSequence(seq.id, name)}
              />
              <button
                type="button"
                className="chipBtn"
                onClick={() => addScene(seq.id)}
                disabled={!editable}
                title="Add a scene to this sequence"
              >
                <Plus size={13} aria-hidden="true" /> Scene
              </button>
            </header>

            {seq.scenes.map((scene) => {
              const isOpen = !collapsed.has(scene.id);
              const sceneFrames = scene.panels.reduce((n, p) => n + p.durationFrames, 0);
              return (
                <div key={scene.id} className={`navScene ${scene.id === ui.sceneId ? 'isActive' : ''}`}>
                  <div className="navSceneHead">
                    <button
                      type="button"
                      className={`disclosure ${isOpen ? 'isOpen' : ''}`}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${scene.name}`}
                      onClick={() => toggle(scene.id)}
                    >
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    <InlineInput
                      className="navSceneName"
                      value={scene.name}
                      label="Scene name"
                      disabled={!editable}
                      resetKey={scene.id}
                      onCommit={(name) => updateScene(scene.id, { name })}
                    />
                    <span className="navCount" title={`${scene.panels.length} panels · ${framesToLabel(sceneFrames, fps)}`}>
                      {scene.panels.length}
                    </span>
                    {sceneCount > 1 ? (
                      <button
                        type="button"
                        className="iconBtn ghost small revealOnHover"
                        aria-label={`Delete scene ${scene.name}`}
                        title="Delete scene (you can undo)"
                        disabled={!editable}
                        onClick={() => deleteSceneWithUndo(scene.id, scene.name)}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <>
                      <InlineInput
                        className="navSlug"
                        value={scene.slug}
                        label="Scene slug line"
                        placeholder="INT. LOCATION — DAY"
                        disabled={!editable}
                        resetKey={scene.id}
                        maxLength={120}
                        onCommit={(slug) => updateScene(scene.id, { slug })}
                      />
                      {scene.scriptText ? (
                        <p className="navScript" title={scene.scriptText.slice(0, 600)}>
                          <Clapperboard size={11} aria-hidden="true" /> From the screenplay
                        </p>
                      ) : null}
                      <ul className="navPanelList">
                        {scene.panels.map((panel) => {
                          const active = panel.id === ui.panelId;
                          return (
                            <li key={panel.id}>
                              <button
                                type="button"
                                className={`navPanel ${active ? 'isActive' : ''}`}
                                aria-current={active ? 'true' : undefined}
                                onClick={() => selectPanel(panel.id)}
                              >
                                <div className="navThumb">
                                  <PanelThumb panel={panel} />
                                </div>
                                <div className="navMeta">
                                  <span className="navMetaTop">
                                    <strong>{panelNumber(panel.id)}</strong>
                                    <span className="navShot">{panel.shotType}</span>
                                  </span>
                                  <span className="navAction">{panel.action || panel.dialogue || '—'}</span>
                                  <span className="navMetaBottom">
                                    <em>{framesToLabel(panel.durationFrames, fps)}</em>
                                    <ReviewBadge panelId={panel.id} />
                                  </span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <button
                        type="button"
                        className="addRow"
                        disabled={!editable}
                        onClick={() => {
                          const last = scene.panels[scene.panels.length - 1];
                          if (last) addPanelAfter(last.id);
                        }}
                      >
                        <Plus size={13} aria-hidden="true" /> Panel
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
