'use client';

import { memo, useLayoutEffect, useRef } from 'react';
import { panelThumb, panelSignature } from '@/lib/thumbs';
import { panelReview } from '@/lib/cloud';

/* The thumbnail DOM comes from lib/thumbs (sanitised, cached). React only
   owns the host element and swaps the node in when the signature changes. */
const ThumbHost = memo(
  function ThumbHost({ panel }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
      if (ref.current) ref.current.replaceChildren(panelThumb(panel));
    });
    return <div ref={ref} className="thumbHost" />;
  },
  (prev, next) => prev.sig === next.sig,
);

export default function PanelThumb({ panel }) {
  return <ThumbHost panel={panel} sig={panelSignature(panel)} />;
}

/* Approved / needs changes / open notes. Nothing when the board is not
   shared or the panel has no review state. Glyphs for the eye, words for
   assistive tech. */
export function ReviewBadge({ panelId }) {
  const review = panelReview(panelId);
  if (!review || (!review.status && !review.open)) return null;
  const status = review.status ? review.status.status : null;
  const parts = [];
  if (status) parts.push(status === 'approved' ? 'approved' : 'needs changes');
  if (review.open) parts.push(`${review.open} open note${review.open === 1 ? '' : 's'}`);
  return (
    <span
      className={`reviewBadge ${status === 'approved' ? 'isApproved' : status ? 'isChanges' : 'isNotes'}`}
      title={parts.join(', ')}
    >
      <span aria-hidden="true">
        {status ? (status === 'approved' ? '✓' : '!') : ''}
        {review.open ? `${status ? ' ' : '✎ '}${review.open}` : ''}
      </span>
      <span className="visually-hidden">, {parts.join(', ')}</span>
    </span>
  );
}
