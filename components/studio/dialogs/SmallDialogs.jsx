'use client';

import { useEffect, useState } from 'react';
import { currentBoard, getName, setName, serverCaps } from '@/lib/cloud';
import { toast } from '@/lib/studioBus';
import Modal from '../Modal';
import { Kbd, Spinner } from '../ui';

/* ---------------- Joining a shared board ---------------- */

export function NameDialog({ open, onClose }) {
  const [name, setNameLocal] = useState('');
  useEffect(() => {
    if (open) setNameLocal(getName());
  }, [open]);
  const save = () => {
    setName(name);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Joining a shared board"
      size="sm"
      initialFocus="#nameInput"
      footer={
        <>
          <div className="footSpacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Skip
          </button>
          <button type="button" className="btn btn-amber" onClick={save}>
            Continue
          </button>
        </>
      }
    >
      <div className="setupField">
        <label htmlFor="nameInput">Your name</label>
        <input
          id="nameInput"
          maxLength={40}
          placeholder="So the team knows who is editing and who left a note"
          value={name}
          onChange={(e) => setNameLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>
    </Modal>
  );
}

/* ---------------- Feedback ---------------- */

export function FeedbackDialog({ open, onClose }) {
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const send = async (e) => {
    e.preventDefault();
    setError('');
    if (!message.trim()) {
      setError('Write something first.');
      return;
    }
    setBusy(true);
    try {
      // Never the full URL: on a shared board the #fragment holds its key.
      const page = `${location.origin}${location.pathname}${currentBoard() ? ' (shared board)' : ''}`;
      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), email, kind, page }),
      });
      if (!resp.ok) throw new Error('Feedback could not be sent from here.');
      setMessage('');
      setEmail('');
      onClose();
      toast('Thanks — feedback sent', { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Feedback is stored by the server; a deployment with no storage (e.g. Vercel
  // without a database connected) can't keep it, so say so up front.
  const caps = serverCaps();
  const canStore = caps.collab !== false;

  return (
    <Modal open={open} onClose={onClose} title="Send feedback" subtitle="Bugs, ideas, anything — it all gets read." size="sm" initialFocus="#feedbackMessage">
      <form onSubmit={send} className="stackForm">
        {!canStore ? (
          <div className="callout isWarn">
            <p>
              This deployment has no storage connected, so feedback can’t be saved here. Please send it to whoever shared
              this link with you.
            </p>
          </div>
        ) : null}
        <div className="setupField">
          <label htmlFor="feedbackKind">What is it about?</label>
          <select id="feedbackKind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="bug">Something broke or looks wrong</option>
            <option value="idea">An idea or a request</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div className="setupField">
          <label htmlFor="feedbackMessage">Tell us</label>
          <textarea
            id="feedbackMessage"
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What were you doing, what happened, what did you expect?"
          />
        </div>
        <div className="setupField">
          <label htmlFor="feedbackEmail">
            Email <span className="optional">(optional, for a reply)</span>
          </label>
          <input id="feedbackEmail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error ? (
          <div className="errorMsg" role="alert">
            {error}
          </div>
        ) : null}
        <div className="settingsActions end">
          <button type="submit" className="btn btn-amber" disabled={busy || !canStore}>
            {busy ? <Spinner /> : null} Send feedback
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Keyboard shortcuts ---------------- */

const SHORTCUTS = [
  {
    group: 'Drawing',
    items: [
      ['V', 'Select — click a mark, drag to move'],
      ['B', 'Brush'],
      ['L', 'Line'],
      ['R', 'Rectangle'],
      ['E', 'Ellipse'],
      ['X', 'Eraser'],
      ['[  ]', 'Thinner / thicker stroke'],
      ['Shift', 'Hold for straight lines, squares, circles'],
      ['Delete', 'Remove the selected mark'],
    ],
  },
  {
    group: 'Board',
    items: [
      ['← →', 'Previous / next panel'],
      ['Alt ← →', 'Move the panel earlier / later'],
      ['N', 'New panel after this one'],
      ['Ctrl D', 'Duplicate panel'],
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z', 'Redo'],
      ['Ctrl S', 'Save a project file'],
    ],
  },
  {
    group: 'View & playback',
    items: [
      ['Space', 'Play the whole board / pause (resumes where paused)'],
      ['Shift Space', 'Play from the selected panel'],
      ['O', 'Onion skin'],
      ['G', 'Thirds & safe-area guides'],
      ['C', 'Camera move frames'],
      ['?', 'This list'],
      ['Ctrl Enter', 'Send a review note'],
    ],
  },
];

export function ShortcutsDialog({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <div className="shortcutGrid">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="setupSubhead">{g.group}</h3>
            <dl>
              {g.items.map(([keys, what]) => (
                <div key={keys} className="shortcutRow">
                  <dt>
                    {keys.split(' ').filter(Boolean).map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
