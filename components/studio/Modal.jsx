'use client';

/* Modal dialogs. Opening one traps Tab inside it, Escape closes it, a click
 * on the backdrop closes it, and focus goes back to whatever opened it.
 * Dialogs stack (the scene picker opens over the new-board dialog); keys go
 * to the top one. Same contract as the original js/dialogs.js. */

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const stack = [];

export function isAnyModalOpen() {
  return stack.length > 0;
}

function focusables(root) {
  return [
    ...root.querySelectorAll(
      'button, select, textarea, input, a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  initialFocus,
  footer,
  children,
  closable = true,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const entry = { ref: dialogRef, returnTo: document.activeElement };
    stack.push(entry);
    const node = dialogRef.current;
    const target =
      (initialFocus && node && node.querySelector(initialFocus)) || (node && focusables(node)[0]);
    // After paint, so the dialog is laid out and focusable.
    requestAnimationFrame(() => target && target.focus());

    const onKey = (e) => {
      if (stack[stack.length - 1] !== entry) return;
      if (e.key === 'Escape' && closable) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current && onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = focusables(dialogRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      const back = entry.returnTo;
      if (back && typeof back.focus === 'function' && back.isConnected) back.focus();
    };
    // initialFocus is read once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closable]);

  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closable) onClose && onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialogHead">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="dialogSub">{subtitle}</p> : null}
          </div>
          {closable ? (
            <button type="button" className="iconBtn ghost" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          ) : null}
        </header>
        <div className="dialogBody">{children}</div>
        {footer ? <footer className="dialogFoot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
