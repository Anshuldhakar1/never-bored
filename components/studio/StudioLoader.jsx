'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from '@/components/brand/Logo';

function StudioSkeleton() {
  return (
    <div className="studioSkeleton" role="status" aria-live="polite">
      <LogoMark size={44} className="pulse" />
      <p>Opening the studio…</p>
      {/* Revealed by a CSS animation delay, so it appears even if the page's
          JavaScript never loads. */}
      <p className="slowHint">
        Taking a while? Reload the page. On a development server, open it at{' '}
        <code>http://localhost:3000/studio</code> and check the terminal for errors.
      </p>
    </div>
  );
}

/* The studio's modules (store, stage, shared-board session) live in the
   browser — localStorage, SVG DOM, requestAnimationFrame — so it is never
   rendered on the server. */
const Studio = dynamic(() => import('./Studio'), { ssr: false, loading: StudioSkeleton });

export default function StudioLoader() {
  return <Studio />;
}
