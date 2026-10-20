'use client';

/* The studio. Owns no document state — it mounts the panes, subscribes them
 * to the store, and translates keystrokes into store mutations. Loaded
 * client-only (see StudioLoader), because the store, stage and shared-board
 * session are browser singletons. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadInitial,
  getUI,
  update,
  activePanel,
  allPanels,
} from '@/lib/store';
import { togglePlay, stepPanel, getDrawing } from '@/lib/stage';
import { addPanelAfter, duplicatePanel, movePanel } from '@/lib/panelOps';
import {
  loadCaps,
  onCloudNotice,
  currentBoard,
  parseBoardHash,
  openSharedBoard,
  getName,
} from '@/lib/cloud';
import { undo, redo, runExport, openProjectFile, loadDemoBoard } from '@/lib/actions';
import { toast, setStatus } from '@/lib/studioBus';
import { useCloudTick, useMediaQuery, usePersistentState, useStoreTick } from './hooks';
import { isAnyModalOpen } from './Modal';
import TopBar from './TopBar';
import Navigator from './Navigator';
import Inspector from './Inspector';
import Timeline from './Timeline';
import Toasts from './Toasts';
import { ToolRail, StageCanvas, StageBar, ShareBar } from './Stage';
import NewBoardDialog from './dialogs/NewBoardDialog';
import ScenePickerDialog from './dialogs/ScenePickerDialog';
import ShareDialog from './dialogs/ShareDialog';
import SettingsDialog from './dialogs/SettingsDialog';
import { NameDialog, FeedbackDialog, ShortcutsDialog } from './dialogs/SmallDialogs';

const TOOL_KEYS = { v: 'select', b: 'brush', l: 'line', r: 'rect', e: 'ellipse', x: 'eraser' };
const NEW_TABS = ['scene', 'screenplay', 'import', 'blank'];

function isTyping(target) {
  return (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  );
}

export default function Studio() {
  // Restore the board from this browser before the first paint reads it.
  const [boot] = useState(() => loadInitial());
  const tick = useStoreTick();
  useCloudTick();

  const [newBoard, setNewBoard] = useState(null); // tab key when open
  const [picker, setPicker] = useState(null); // { screenplay, base }
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const fileRef = useRef(null);

  const narrow = useMediaQuery('(max-width: 1100px)');
  const [widePanes, setWidePanes] = usePersistentState('neverBored.panes.v1', { navigator: true, inspector: true });
  const [narrowPanes, setNarrowPanes] = useState({ navigator: false, inspector: false });
  const panes = narrow ? narrowPanes : widePanes;
  const togglePane = useCallback(
    (which) => {
      if (narrow) setNarrowPanes((p) => ({ navigator: false, inspector: false, [which]: !p[which] }));
      else setWidePanes((p) => ({ ...p, [which]: !p[which] }));
    },
    [narrow, setWidePanes],
  );

  const open = {
    newBoard: (tab = 'scene') => setNewBoard(tab),
    share: () => setShareOpen(true),
    settings: () => setSettingsOpen(true),
    feedback: () => setFeedbackOpen(true),
    shortcuts: () => setShortcutsOpen(true),
    projectFile: () => fileRef.current && fileRef.current.click(),
  };

  /* ---------------- Shared boards from the URL ---------------- */

  const openBoardFromHash = useCallback(async () => {
    const link = parseBoardHash(window.location.hash);
    if (!link) return;
    const board = currentBoard();
    if (board && board.id === link.id) return;
    setStatus('Opening shared board…');
    try {
      await openSharedBoard(link.id, link.key);
      const opened = currentBoard();
      toast(
        opened.editing
          ? 'Shared board open — you are editing'
          : opened.role === 'edit'
            ? 'Shared board open — someone else is editing, you are watching live'
            : 'Review link open — leave notes and approve panels in the inspector',
        { type: 'success', ms: 4500 },
      );
      if (!getName()) setNameOpen(true);
    } catch (e) {
      toast(`Could not open the shared board — ${e.message}`, { type: 'error', ms: 6000 });
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } finally {
      setStatus('');
    }
  }, []);

  /* ---------------- Boot ---------------- */

  useEffect(() => {
    onCloudNotice((message) => toast(message, { ms: 5000 }));
    const onFull = () =>
      toast(
        'This browser is out of storage space, so the board is not being saved. Export a project file, or share the board to keep it on the server.',
        { type: 'error', ms: 9000 },
      );
    window.addEventListener('neverbored:storagefull', onFull);
    window.addEventListener('hashchange', openBoardFromHash);

    (async () => {
      const link = parseBoardHash(window.location.hash);
      await loadCaps();
      if (link) {
        await openBoardFromHash();
        return;
      }
      const params = new URLSearchParams(window.location.search);
      if (params.has('demo')) {
        history.replaceState(null, '', window.location.pathname);
        loadDemoBoard();
        return;
      }
      const wanted = params.get('new');
      if (wanted) {
        history.replaceState(null, '', window.location.pathname);
        setNewBoard(NEW_TABS.includes(wanted) ? wanted : 'scene');
        return;
      }
      const note = getUI().migrationNote;
      if (note) {
        toast(note, { ms: 9000 });
        update((u) => (u.migrationNote = null));
      } else if (!boot.restored) {
        setNewBoard('scene');
      }
    })();

    return () => {
      window.removeEventListener('neverbored:storagefull', onFull);
      window.removeEventListener('hashchange', openBoardFromHash);
    };
  }, [boot.restored, openBoardFromHash]);

  /* ---------------- Keyboard ---------------- */

  useEffect(() => {
    const onKeydown = (e) => {
      if (isAnyModalOpen() || e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        runExport('json');
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && key === 'd') {
        e.preventDefault();
        const panel = activePanel();
        if (panel) duplicatePanel(panel.id);
        return;
      }
      // Leave other browser/OS shortcuts alone; Alt only means "move panel".
      if (mod || (e.altKey && !['arrowleft', 'arrowright'].includes(key))) return;

      if (TOOL_KEYS[key] && !e.shiftKey) {
        update((u) => (u.tool = TOOL_KEYS[key]));
        return;
      }
      if (e.key === ' ') {
        const t = e.target;
        if (t.closest && t.closest('[role="menu"]')) return;
        // A control reached with the keyboard (Tab → :focus-visible) keeps
        // Space for itself — that is how keyboard users press buttons. After a
        // mouse click focus isn't :focus-visible, so Space still plays. The
        // Play button and the timeline ruler (which only uses arrows, Page
        // Up/Down, Home, End) always play: scrub, then Space, is natural.
        if (
          t.closest &&
          t.closest('button, [role="radio"], [role="tab"], [role="switch"], a[href], summary') &&
          !t.closest('.playBtn, [role="slider"]') &&
          t.matches &&
          t.matches(':focus-visible')
        ) {
          return;
        }
        e.preventDefault();
        // Holding Space must not flip play/pause on every auto-repeat.
        if (e.repeat) return;
        // Space plays the whole board; Shift+Space plays from this panel.
        togglePlay({ fromPanel: e.shiftKey });
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.target.closest && e.target.closest('[role="menu"], [role="slider"], [role="radiogroup"]')) return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.altKey) {
          const panel = activePanel();
          if (panel) movePanel(panel.id, dir);
        } else stepPanel(dir);
        return;
      }
      if (key === 'o') return update((u) => (u.onionSkin = !u.onionSkin));
      if (key === 'g') return update((u) => (u.showGuides = !u.showGuides));
      if (key === 'c') return update((u) => (u.showCamera = !u.showCamera));
      if (key === 'n') {
        const panel = activePanel();
        if (panel) addPanelAfter(panel.id);
        return;
      }
      if (e.key === '?') {
        setShortcutsOpen(true);
        return;
      }
      if (e.key === '[' || e.key === ']') {
        update((u) => (u.brushWidth = Math.max(1, Math.min(28, u.brushWidth + (e.key === ']' ? 1 : -1)))));
        return;
      }
      if (e.key === 'Escape') {
        const drawing = getDrawing();
        if (drawing) drawing.clearSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const drawing = getDrawing();
        if (drawing && drawing.hasSelection()) {
          e.preventDefault();
          drawing.deleteSelection();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, []);

  const showNav = panes.navigator;
  const showIns = panes.inspector;

  return (
    <div
      className={`studio ${narrow ? 'isNarrow' : ''} ${showNav ? 'hasNav' : ''} ${showIns ? 'hasIns' : ''}`}
      data-panels={allPanels().length}
    >
      <TopBar panes={panes} onTogglePane={togglePane} open={open} />

      <div className="workspace">
        {showNav ? <Navigator /> : null}
        <main className="stageColumn" aria-label="Stage">
          <ShareBar onOpenShare={open.share} />
          <div className="stageArea">
            <ToolRail />
            <StageCanvas tick={tick} />
          </div>
          <StageBar />
        </main>
        {showIns ? <Inspector onOpenSettings={open.settings} /> : null}
        {narrow && (showNav || showIns) ? (
          <button
            type="button"
            className="drawerScrim"
            aria-label="Close side panel"
            onClick={() => setNarrowPanes({ navigator: false, inspector: false })}
          />
        ) : null}
      </div>

      <Timeline />
      <Toasts />

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          try {
            await openProjectFile(file);
            setNewBoard(null);
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }}
      />

      <NewBoardDialog
        open={newBoard !== null}
        initialTab={newBoard || 'scene'}
        onClose={() => setNewBoard(null)}
        onScreenplay={(screenplay, base) => setPicker({ screenplay, base })}
        onOpenSettings={open.settings}
        onOpenProjectFile={open.projectFile}
      />
      <ScenePickerDialog
        open={Boolean(picker)}
        screenplay={picker && picker.screenplay}
        base={picker && picker.base}
        onClose={() => setPicker(null)}
        onDone={() => {
          setPicker(null);
          setNewBoard(null);
        }}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NameDialog open={nameOpen} onClose={() => setNameOpen(false)} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
