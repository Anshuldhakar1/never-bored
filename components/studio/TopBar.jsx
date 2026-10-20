'use client';

import Link from 'next/link';
import {
  Undo2,
  Redo2,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Layers,
  Grid3x3,
  Video,
  Share2,
  Download,
  Ellipsis,
  PanelLeft,
  PanelRight,
  FileText,
  FileImage,
  FileJson,
  FolderOpen,
  Plus,
  Settings,
  Keyboard,
  MessageSquare,
  House,
  Sparkles,
  CircleAlert,
  CloudCheck,
  Film,
} from 'lucide-react';
import {
  getProject,
  getUI,
  update,
  commit,
  canUndo,
  canRedo,
  isEditable,
  getSaveInfo,
  totalFrames,
} from '@/lib/store';
import { togglePlay, stepPanel, framesToLabel } from '@/lib/stage';
import { currentBoard } from '@/lib/cloud';
import { undo, redo, runExport, loadDemoBoard } from '@/lib/actions';
import { aiState } from '@/lib/aiState';
import { LogoMark } from '@/components/brand/Logo';
import { IconButton, Menu } from './ui';
import { useSyncedValue } from './hooks';

function SaveIndicator() {
  const board = currentBoard();
  if (board) return null; // the share bar reports cloud saving
  const info = getSaveInfo();
  if (info.failed) {
    return (
      <span className="saveState isError" title="Browser storage is full — export a project file to keep your work">
        <CircleAlert size={13} aria-hidden="true" /> Not saved
      </span>
    );
  }
  return (
    <span className="saveState" title="Your board saves itself in this browser as you work" aria-live="off">
      <span className={`saveDot ${info.dirty ? 'isDirty' : ''}`} aria-hidden="true" />
      {info.dirty ? 'Saving…' : 'Saved'}
    </span>
  );
}

function TitleInput() {
  const project = getProject();
  const editable = isEditable();
  const [value, setValue, ref] = useSyncedValue(project.title, project.id);
  return (
    <input
      ref={ref}
      className="projectTitle"
      aria-label="Board title"
      maxLength={90}
      placeholder="Untitled Board"
      value={value}
      disabled={!editable}
      onChange={(e) => {
        setValue(e.target.value);
        commit((proj) => (proj.title = e.target.value.slice(0, 90)), { coalesceKey: 'title' });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export default function TopBar({ panes, onTogglePane, open }) {
  const ui = getUI();
  const project = getProject();
  const board = currentBoard();
  const ai = aiState();

  const exportItems = [
    { label: 'PDF contact sheet', hint: 'Two panels per row, with shot notes', icon: FileText, onSelect: () => runExport('pdf') },
    { label: 'SVG board', hint: 'True vector — opens in Illustrator, Inkscape…', icon: FileImage, onSelect: () => runExport('svg') },
    'separator',
    { label: 'Project file (.json)', hint: 'Everything, to open again later', icon: FileJson, kbd: 'Ctrl S', onSelect: () => runExport('json') },
  ];

  const moreItems = [
    { label: 'New board…', icon: Plus, onSelect: () => open.newBoard() },
    { label: 'Open project file…', icon: FolderOpen, onSelect: () => open.projectFile() },
    { label: 'Load demo board', hint: '“The Last Roof” — every feature in one board', icon: Film, onSelect: loadDemoBoard },
    'separator',
    { label: 'AI & API settings', icon: Settings, onSelect: () => open.settings() },
    { label: 'Keyboard shortcuts', icon: Keyboard, kbd: '?', onSelect: () => open.shortcuts() },
    { label: 'Send feedback', icon: MessageSquare, onSelect: () => open.feedback() },
    'separator',
    { label: 'Home', icon: House, onSelect: () => (window.location.href = '/') },
  ];

  const aiClass = ai.text.ok === false ? 'isOff' : ai.text.ok ? 'isOn' : 'isUnknown';

  return (
    <header className="topbar">
      <div className="tbBrand">
        <Link href="/" className="tbLogo" title="Never Bored — home">
          <LogoMark size={26} />
        </Link>
        <IconButton
          icon={PanelLeft}
          label={panes.navigator ? 'Hide board navigator' : 'Show board navigator'}
          pressed={panes.navigator}
          onClick={() => onTogglePane('navigator')}
          className="ghost paneToggle"
        />
        <div className="titleBlock">
          <TitleInput />
          <SaveIndicator />
        </div>
      </div>

      <div className="tbGroup" role="group" aria-label="History">
        <IconButton icon={Undo2} label="Undo" kbd="Ctrl Z" disabled={!canUndo()} onClick={undo} />
        <IconButton icon={Redo2} label="Redo" kbd="Ctrl Shift Z" disabled={!canRedo()} onClick={redo} />
      </div>

      <div className="tbGroup tbTransport" role="group" aria-label="Playback">
        <IconButton icon={SkipBack} label="Previous panel" kbd="←" onClick={() => stepPanel(-1)} />
        <button
          type="button"
          className={`playBtn ${ui.playing ? 'isPlaying' : ''}`}
          onClick={(e) => togglePlay({ fromPanel: e.shiftKey })}
          title={
            ui.playing
              ? 'Pause (Space)'
              : 'Play the whole board (Space) · Shift-click or Shift+Space: from this panel'
          }
          aria-label={ui.playing ? 'Pause' : 'Play the whole board'}
        >
          {ui.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <IconButton icon={SkipForward} label="Next panel" kbd="→" onClick={() => stepPanel(1)} />
        <span className="timecode" aria-label="Playhead time and board length">
          {framesToLabel(ui.playheadFrame, project.fps)}
          <span className="timecodeTotal"> / {framesToLabel(totalFrames(), project.fps)}</span>
        </span>
      </div>

      <div className="tbGroup" role="group" aria-label="Stage overlays">
        <IconButton
          icon={Layers}
          label="Onion"
          showLabel
          kbd="O"
          pressed={ui.onionSkin}
          onClick={() => update((u) => (u.onionSkin = !u.onionSkin))}
          className="toggle"
          title="Onion skin — see the previous panel faintly (O)"
        />
        <IconButton
          icon={Grid3x3}
          label="Guides"
          showLabel
          kbd="G"
          pressed={ui.showGuides}
          onClick={() => update((u) => (u.showGuides = !u.showGuides))}
          className="toggle"
          title="Thirds and safe areas (G)"
        />
        <IconButton
          icon={Video}
          label="Camera"
          showLabel
          kbd="C"
          pressed={ui.showCamera}
          onClick={() => update((u) => (u.showCamera = !u.showCamera))}
          className="toggle"
          title="Camera move frames (C)"
        />
      </div>

      <div className="tbSpacer" />

      <button
        type="button"
        className={`aiChip ${aiClass}`}
        onClick={open.settings}
        title={`${ai.text.detail} — click for AI settings`}
      >
        <Sparkles size={14} aria-hidden="true" />
        <span>{ai.text.label}</span>
      </button>

      <button
        type="button"
        className={`btn ${board ? 'btn-teal-soft' : 'btn-teal'}`}
        onClick={open.share}
      >
        {board ? <CloudCheck size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
        <span>{board ? 'Shared' : 'Share'}</span>
      </button>

      <Menu label="Export" icon={Download} items={exportItems} buttonClass="btn btn-amber" />
      <Menu
        label="More"
        icon={Ellipsis}
        items={moreItems}
        buttonClass="iconBtn"
        showLabel={false}
      />
      <IconButton
        icon={PanelRight}
        label={panes.inspector ? 'Hide panel inspector' : 'Show panel inspector'}
        pressed={panes.inspector}
        onClick={() => onTogglePane('inspector')}
        className="ghost paneToggle"
      />
    </header>
  );
}
