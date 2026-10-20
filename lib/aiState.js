/* What generation can do right now, in words the UI can show. Combines the
 * server's /api/status capabilities with whatever the user set under
 * Settings (their own key, the free model, or a custom endpoint), so the
 * studio can say up front that a button will fail rather than letting the
 * request find out. */

import { serverCaps } from './cloud.js';
import { hasOwnKey, usingFreeModel } from './ai.js';
import { loadSettings } from './store.js';

export function aiState() {
  const caps = serverCaps();
  const customEndpoint = Boolean((loadSettings().endpoint || '').trim());
  const ownKey = hasOwnKey();
  const free = usingFreeModel();
  const loaded = Object.keys(caps).length > 0;
  const freeGap = caps.freeGapSeconds || 0;

  let text;
  if (free) {
    text =
      caps.free === false
        ? { ok: false, label: 'Free model off', detail: 'This server has the free model turned off — pick another provider in Settings' }
        : {
            ok: true,
            free: true,
            label: 'Free model',
            detail: `gpt-oss-20b via Pollinations.ai — free, no key${freeGap ? `, one request every ~${freeGap} s` : ''}`,
          };
  } else if (ownKey) text = { ok: true, label: 'Your key', detail: 'Claude, called from this browser with your key' };
  else if (customEndpoint) text = { ok: true, label: 'Custom server', detail: 'Sent to the endpoint set in Settings' };
  else if (caps.text === 'anthropic') text = { ok: true, label: 'Claude', detail: 'Claude, through this server' };
  else if (caps.text === 'local') text = { ok: true, label: 'Local model', detail: 'A model on this machine — nothing leaves it' };
  else if (!loaded) text = { ok: null, label: 'Checking…', detail: 'Asking the server what it can do' };
  else text = { ok: false, label: 'AI off', detail: 'No API key is set on the server or in this browser' };

  return {
    text,
    // The free model is offered wherever AI is off, as a one-click opt-in.
    canUseFree: !free && caps.free === true,
    freeGap,
    // Vision always needs Anthropic: the user's key or the server's.
    vision: !free && (ownKey || Boolean(caps.vision) || customEndpoint),
    // Renders always go through a server with an image model.
    raster: caps.raster === true || (customEndpoint && caps.raster !== false),
    collab: Boolean(caps.collab),
    accessCode: Boolean(caps.accessCode),
    caps,
  };
}
