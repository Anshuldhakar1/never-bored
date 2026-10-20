'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ScrollText, FolderOpen, Film } from 'lucide-react';

const STORAGE_KEY = 'neverBored.project.v2';

/* Reads (never writes) the board kept in this browser, so the landing page
   can offer to pick up where you left off. */
function readSavedBoard() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const project = raw && raw.project;
    if (!project || !Array.isArray(project.sequences)) return null;
    let panels = 0;
    project.sequences.forEach((s) => (s.scenes || []).forEach((sc) => (panels += (sc.panels || []).length)));
    return { title: String(project.title || 'Untitled Board').slice(0, 90), panels };
  } catch {
    return null;
  }
}

export default function HomeActions() {
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    // Share links made by the original single-page app pointed at "/#board=…".
    if (/^#board=/.test(window.location.hash)) {
      window.location.replace(`/studio${window.location.hash}`);
      return;
    }
    setSaved(readSavedBoard());
  }, []);

  return (
    <div className="heroActions">
      {saved ? (
        <Link href="/studio" className="btn btn-amber large">
          Continue “{saved.title}”
          <span className="btnMeta">{saved.panels} panel{saved.panels === 1 ? '' : 's'}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      ) : (
        <Link href="/studio?new=scene" className="btn btn-amber large">
          Start boarding — it’s free <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}
      <Link href="/studio?new=screenplay" className="btn btn-outline large">
        <ScrollText size={18} aria-hidden="true" /> Board a screenplay
      </Link>
      <Link
        href="/studio?demo=1"
        className="btn btn-ghost large"
        title={saved ? 'Replaces the board in this browser — you can undo it' : undefined}
      >
        <Film size={18} aria-hidden="true" /> Try the demo board
      </Link>
      {saved ? (
        <Link href="/studio?new=scene" className="btn btn-ghost large">
          <FolderOpen size={18} aria-hidden="true" /> New board
        </Link>
      ) : null}
    </div>
  );
}
