'use client';

/* Bridges between the plain-JS modules (store, cloud, studioBus) and React.
 * Each of those modules exposes subscribe + a tick counter, so a component
 * re-renders exactly once per coalesced change. */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribe, getTick } from '@/lib/store';
import { onCloudChange, getCloudTick } from '@/lib/cloud';
import { subscribeBus, getBusTick, getBus } from '@/lib/studioBus';

export function useStoreTick() {
  return useSyncExternalStore(subscribe, getTick, getTick);
}

export function useCloudTick() {
  return useSyncExternalStore(onCloudChange, getCloudTick, getCloudTick);
}

export function useBus() {
  useSyncExternalStore(subscribeBus, getBusTick, getBusTick);
  return getBus();
}

/* A text input bound to a value that lives in the store.
 *
 * The store notifies once per animation frame, so a plainly controlled input
 * would briefly snap back to the old value between a keystroke and the next
 * paint, and the caret would jump. Instead the input owns its text while it
 * has focus and only takes the store's value when idle — the same rule the
 * original inspector followed ("built once, value-synced"). `resetKey`
 * (usually the panel id) forces a resync when the subject changes.
 *
 * A layout effect, not a passive one: the store's notifications re-render
 * through useSyncExternalStore, and a passive effect here was observed to be
 * skipped on such a re-render — the title kept showing the old board after
 * a new one was loaded. Syncing at commit also avoids a frame of stale text. */
export function useSyncedValue(value, resetKey) {
  const [local, setLocal] = useState(value);
  const ref = useRef(null);
  const lastKey = useRef(resetKey);
  useLayoutEffect(() => {
    const keyChanged = lastKey.current !== resetKey;
    lastKey.current = resetKey;
    if (keyChanged || typeof document === 'undefined' || document.activeElement !== ref.current) {
      setLocal(value);
    }
  }, [value, resetKey]);
  return [local, setLocal, ref];
}

/* Remembered per-browser UI preferences (collapsed sections, pane widths). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* best-effort */
    }
  }, [key, value]);
  return [value, setValue];
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
