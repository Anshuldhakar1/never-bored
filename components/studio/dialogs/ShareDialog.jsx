'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link as LinkIcon, Users, Eye, X, Server } from 'lucide-react';
import { saveNow } from '@/lib/store';
import {
  currentBoard,
  boardLinks,
  shareCurrentBoard,
  leaveSharedBoard,
  deleteSharedBoard,
  myBoards,
  forgetBoard,
  getName,
  setName,
  serverCaps,
} from '@/lib/cloud';
import { toast } from '@/lib/studioBus';
import Modal from '../Modal';
import { Spinner } from '../ui';

function LinkField({ id, label, value, note, icon: Icon }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      inputRef.current.select();
      toast('Press Ctrl+C to copy the selected link');
    }
  };
  return (
    <div className="setupField">
      <label htmlFor={id}>
        <Icon size={13} aria-hidden="true" /> {label}
      </label>
      <div className="linkRow">
        <input id={id} ref={inputRef} readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className={`btn ${copied ? 'btn-teal' : 'btn-outline'}`} onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="dialogNote">{note}</p>
    </div>
  );
}

export default function ShareDialog({ open, onClose }) {
  const [name, setNameLocal] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [, force] = useState(0);
  const board = currentBoard();
  const caps = serverCaps();

  useEffect(() => {
    if (!open) return;
    setNameLocal(getName());
    setError('');
    setArmed(false);
  }, [open]);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const create = async () => {
    setError('');
    if (name.trim()) setName(name);
    setBusy(true);
    try {
      saveNow();
      await shareCurrentBoard();
      toast('Board shared — copy a link for your team', { type: 'success' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    try {
      await deleteSharedBoard();
      onClose();
      toast('Shared board deleted — back on your own board');
    } catch (e) {
      setError(e.message);
    }
  };

  const links = board ? boardLinks() : { edit: null, review: null };
  const boards = myBoards();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Team & review"
      subtitle={board ? board.title : 'Share this board to work on it together'}
      size="sm"
      initialFocus={board ? undefined : '#shareName'}
    >
      <div className="setupField">
        <label htmlFor="shareName">Your name</label>
        <input
          id="shareName"
          maxLength={40}
          placeholder="Shown on your notes and while you edit"
          value={name}
          onChange={(e) => setNameLocal(e.target.value)}
          onBlur={() => setName(name)}
        />
      </div>

      {!board ? (
        <section className="shareIntro">
          <div className="roleCards">
            <div className="roleCard">
              <Users size={16} aria-hidden="true" />
              <strong>Edit link</strong>
              <span>For your team. One person edits at a time; everyone else follows live and can take over.</span>
            </div>
            <div className="roleCard">
              <Eye size={16} aria-hidden="true" />
              <strong>Review link</strong>
              <span>For clients and reviewers. Watch live, leave notes on panels, approve or ask for changes.</span>
            </div>
          </div>
          {caps.collab ? (
            <button type="button" className="btn btn-teal wide" onClick={create} disabled={busy}>
              {busy ? <Spinner /> : <LinkIcon size={15} aria-hidden="true" />}
              {busy ? 'Sharing…' : 'Share this board'}
            </button>
          ) : (
            <div className="callout">
              <Server size={15} aria-hidden="true" />
              <p>
                Sharing isn’t switched on for this deployment — it needs somewhere to store shared boards. Everything
                else works. To turn it on: on Vercel, connect a free <strong>Upstash Redis</strong> database to the
                project (Storage → Marketplace) and redeploy; when running it yourself, use <code>npm start</code>{' '}
                without <code>SHARING=off</code>. You can still send the board as a file: <em>Export → Project file</em>.
              </p>
            </div>
          )}
        </section>
      ) : (
        <section>
          <p className="dialogNote">
            {board.role === 'edit'
              ? 'You opened this board with its edit link. One person edits at a time; everyone else follows live.'
              : 'You opened this board with a review link: follow it live, leave notes on panels and approve them.'}
          </p>
          {links.edit ? (
            <LinkField
              id="shareEditLink"
              label="Edit link"
              icon={Users}
              value={links.edit}
              note="Anyone with this link can edit the board — keep it to your team."
            />
          ) : null}
          {links.review ? (
            <LinkField
              id="shareReviewLink"
              label="Review link"
              icon={Eye}
              value={links.review}
              note="Watch live, leave notes on panels, approve or ask for changes."
            />
          ) : null}
          <div className="settingsActions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                leaveSharedBoard();
                onClose();
                toast('Back on the board kept in this browser');
              }}
            >
              Back to my own board
            </button>
            {board.role === 'edit' ? (
              <button type="button" className={`btn ${armed ? 'btn-danger' : 'btn-ghost dangerText'}`} onClick={remove}>
                {armed ? 'Click again to delete for everyone' : 'Delete shared board'}
              </button>
            ) : null}
          </div>
        </section>
      )}

      {error ? (
        <div className="errorMsg" role="alert">
          {error}
        </div>
      ) : null}

      <hr className="dialogRule" />
      <div className="setupSubhead">Shared boards opened in this browser</div>
      <ul className="boardList">
        {boards.length ? (
          boards.map((entry) => (
            <li key={entry.id} className={`boardRow ${board && board.id === entry.id ? 'isCurrent' : ''}`}>
              <button
                type="button"
                className="linkBtn boardOpen"
                onClick={() => {
                  onClose();
                  window.location.hash = `board=${entry.id}&key=${entry.key}`;
                }}
              >
                {entry.title || 'Untitled Board'}
              </button>
              <span className="boardRole">{entry.role === 'edit' ? 'edit' : 'review'}</span>
              <button
                type="button"
                className="iconBtn ghost small"
                aria-label={`Remove ${entry.title || 'board'} from this list`}
                onClick={() => {
                  forgetBoard(entry.id);
                  force((n) => n + 1);
                }}
              >
                <X size={14} />
              </button>
            </li>
          ))
        ) : (
          <li className="commentEmpty">None yet.</li>
        )}
      </ul>
    </Modal>
  );
}
