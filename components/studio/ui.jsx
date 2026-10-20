'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Upload, X } from 'lucide-react';

/* An icon-only (or icon + label) button. `label` is the accessible name and
   the tooltip; `kbd` is appended to the tooltip so shortcuts are learnable. */
export function IconButton({
  icon: Icon,
  label,
  kbd,
  showLabel = false,
  pressed,
  className = '',
  size = 17,
  ...rest
}) {
  return (
    <button
      type="button"
      className={`iconBtn ${showLabel ? 'withLabel' : ''} ${className}`}
      aria-label={showLabel ? undefined : label}
      aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
      title={kbd ? `${label} (${kbd})` : label}
      {...rest}
    >
      <Icon size={size} aria-hidden="true" />
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}

export function Spinner({ size = 14 }) {
  return <LoaderCircle size={size} className="spin" aria-hidden="true" />;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* A toggle switch built on a real checkbox, so it is keyboard- and
   screen-reader-correct for free. */
export function Switch({ checked, onChange, label, disabled, id }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <label className={`switch ${disabled ? 'isDisabled' : ''}`} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switchTrack" aria-hidden="true">
        <span className="switchThumb" />
      </span>
      <span className="switchLabel">{label}</span>
    </label>
  );
}

/* A dropdown menu: button + role="menu" list. Arrow keys move, Enter/Space
   picks, Escape and outside clicks close, focus returns to the button. */
export function Menu({ label, icon: Icon, items, align = 'right', buttonClass = 'btn btn-outline', showLabel = true }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!listRef.current || listRef.current.contains(e.target) || btnRef.current.contains(e.target))
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    requestAnimationFrame(() => {
      const first = listRef.current && listRef.current.querySelector('[role="menuitem"]:not([disabled])');
      if (first) first.focus();
    });
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus();
  };

  const onKeyDown = (e) => {
    const nodes = [...listRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = nodes.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="menuWrap">
      <button
        ref={btnRef}
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={showLabel ? undefined : label}
        title={showLabel ? undefined : label}
        onClick={() => setOpen((v) => !v)}
      >
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
        {showLabel ? <span>{label}</span> : null}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          className={`menu menu-${align}`}
          onKeyDown={onKeyDown}
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep${i}`} className="menuSep" role="separator" />
            ) : item.heading ? (
              <div key={`h${i}`} className="menuHeading">
                {item.heading}
              </div>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menuItem ${item.danger ? 'isDanger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon ? <item.icon size={15} aria-hidden="true" /> : <span className="menuIconGap" />}
                <span className="menuText">
                  <span>{item.label}</span>
                  {item.hint ? <small>{item.hint}</small> : null}
                </span>
                {item.kbd ? <Kbd>{item.kbd}</Kbd> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* Drag-and-drop file picker with a real <input type="file"> underneath. */
export function Dropzone({ accept, multiple = false, files, onFiles, title, hint, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const inputId = useId();

  const take = (list) => {
    const picked = [...(list || [])];
    if (!picked.length) return;
    onFiles(multiple ? [...files, ...picked] : picked.slice(0, 1));
  };

  return (
    <div className="dropzoneWrap">
      <label
        htmlFor={inputId}
        className={`dropzone ${over ? 'isOver' : ''} ${disabled ? 'isDisabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
      >
        <Upload size={22} aria-hidden="true" />
        <span className="dropTitle">{title}</span>
        <span className="dropHint">{hint}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="visually-hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {files.length ? (
        <ul className="fileList">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="fileName">{f.name}</span>
              <span className="fileSize">{formatBytes(f.size)}</span>
              <button
                type="button"
                className="iconBtn ghost small"
                aria-label={`Remove ${f.name}`}
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* A chunk of SVG markup we generated ourselves (shot icons from vocab.js).
   Never use this for model output or anything from storage — that goes
   through svgsafe. */
export function TrustedSvg({ markup, className, viewBox = '0 0 100 60', label }) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
