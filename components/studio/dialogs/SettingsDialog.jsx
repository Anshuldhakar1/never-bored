'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Eye, EyeOff, KeyRound } from 'lucide-react';
import { loadSettings, saveSettings, update } from '@/lib/store';
import { getEndpoint, hasOwnKey } from '@/lib/ai';
import { loadCaps } from '@/lib/cloud';
import { aiState } from '@/lib/aiState';
import { toast } from '@/lib/studioBus';
import Modal from '../Modal';

function Cap({ ok, label, detail }) {
  return (
    <li className={`capRow ${ok ? 'isOk' : 'isNo'}`}>
      {ok ? <CircleCheck size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />}
      <span>
        <strong>{label}</strong> <span className="capDetail">{detail}</span>
      </span>
      <span className="visually-hidden">{ok ? 'available' : 'unavailable'}</span>
    </li>
  );
}

export default function SettingsDialog({ open, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [reveal, setReveal] = useState(false);
  const [provider, setProvider] = useState('default');
  const [, force] = useState(0);

  useEffect(() => {
    if (!open) return;
    const s = loadSettings();
    setProvider(s.provider === 'free' ? 'free' : 'default');
    setApiKey(s.apiKey || '');
    setAccessCode(s.accessCode || '');
    setEndpoint(s.endpoint || '');
    setReveal(false);
    loadCaps().then(() => force((n) => n + 1));
  }, [open]);

  const ai = aiState();
  const caps = ai.caps;

  const save = () => {
    saveSettings({
      ...loadSettings(),
      provider,
      apiKey: apiKey.trim(),
      endpoint: endpoint.trim(),
      accessCode: accessCode.trim(),
    });
    update(() => {}); // repaint the AI chip and every AI notice
    toast('Settings saved to this browser', { type: 'success' });
    onClose();
  };

  const clearKey = () => {
    const s = loadSettings();
    delete s.apiKey;
    saveSettings(s);
    setApiKey('');
    force((n) => n + 1);
    toast('Key removed from this browser');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI & API settings"
      subtitle="Stored in this browser only — never in a board, an export or a share link."
      size="md"
      footer={
        <>
          {hasOwnKey() ? (
            <button type="button" className="btn btn-ghost dangerText" onClick={clearKey}>
              Remove my key
            </button>
          ) : null}
          <div className="footSpacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-amber" onClick={save}>
            Save settings
          </button>
        </>
      }
    >
      <div className="setupSubhead">AI provider</div>
      <div className="styleChips" role="radiogroup" aria-label="AI provider">
        <label className={`styleChip ${provider === 'default' ? 'isOn' : ''}`}>
          <input
            type="radio"
            name="aiProvider"
            value="default"
            checked={provider === 'default'}
            onChange={() => setProvider('default')}
          />
          <span className="chipTitle">Claude</span>
          <span className="chipDesc">
            Best quality, all features. Uses your key below, or the server’s{' '}
            {caps.text === 'anthropic' ? '(set up ✓)' : caps.text === 'local' ? '(local model)' : '(none set)'}.
          </span>
        </label>
        <label className={`styleChip ${provider === 'free' ? 'isOn' : ''} ${caps.free === false ? 'isDisabled' : ''}`}>
          <input
            type="radio"
            name="aiProvider"
            value="free"
            checked={provider === 'free'}
            disabled={caps.free === false}
            onChange={() => setProvider('free')}
          />
          <span className="chipTitle">Free model — no key</span>
          <span className="chipDesc">
            {caps.free === false
              ? 'Turned off on this server.'
              : `gpt-oss-20b via Pollinations.ai. Your scene text goes to that third-party service. One request every ~${caps.freeGapSeconds || 30} s; no board import.`}
          </span>
        </label>
      </div>

      <div className="setupSubhead">What this server can do</div>
      <ul className="capList">
        <Cap
          ok={ai.text.ok !== false}
          label="Coverage, sketches & line art"
          detail={ai.text.detail}
        />
        <Cap
          ok={ai.vision}
          label="Reading existing boards"
          detail={ai.vision ? 'Claude vision' : 'Needs an Anthropic key (never sent to a local model)'}
        />
        <Cap
          ok={ai.raster}
          label="Rendered images"
          detail={ai.raster ? 'Image model on the server' : 'Needs GEMINI_API_KEY on the server'}
        />
        <Cap
          ok={ai.collab}
          label="Sharing & review"
          detail={ai.collab ? 'Boards stored by this server' : 'Turned off on this deployment'}
        />
        {caps.accessCode ? <Cap ok={Boolean(accessCode.trim())} label="Beta access code" detail="This server asks for one before it generates or shares" /> : null}
      </ul>

      <div className="setupField">
        <label htmlFor="fApiKey">
          <KeyRound size={13} aria-hidden="true" /> Your Anthropic API key <span className="optional">(optional)</span>
        </label>
        <div className="linkRow">
          <input
            id="fApiKey"
            type={reveal ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="iconBtn"
            aria-label={reveal ? 'Hide key' : 'Show key'}
            aria-pressed={reveal}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="dialogNote">
          With a key here, text generation goes straight from this browser to Anthropic. Leave it empty to use the server’s
          key. Get one at{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
            console.anthropic.com
          </a>
          . Rendered images always go through the server.
        </p>
      </div>

      <div className="setupField">
        <label htmlFor="fAccessCode">
          Beta access code <span className="optional">(if the site asks for one)</span>
        </label>
        <input
          id="fAccessCode"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
        />
      </div>

      <details className="advanced">
        <summary>Advanced: generation endpoint</summary>
        <div className="setupField">
          <label htmlFor="fEndpoint">Endpoint</label>
          <input
            id="fEndpoint"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="/api/generate"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
          <p className="dialogNote">
            Where generation is sent when no key is set above — currently <code>{getEndpoint()}</code>. Point it at your
            own server, including one on <code>localhost</code>, to keep scene text in-house.
          </p>
        </div>
      </details>
    </Modal>
  );
}
