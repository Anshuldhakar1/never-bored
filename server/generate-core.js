/*
 * Generation core. The Next.js API route (app/api/[...path]/route.js, via
 * router.js) calls runGeneration() and gets back { status, body }. Lives
 * outside app/ so it is never served as a route of its own.
 *
 * The client sends { task, content }:
 *   shots / sketch / art — content is a prompt string
 *   import               — content is an array of Anthropic content blocks
 *                          (image/document blocks plus a text instruction)
 *   raster               — content is { prompt, image (base64 PNG), aspect }
 *
 * Text backends, chosen by environment:
 *   LOCAL_MODEL_URL set  -> an OpenAI-compatible server you run yourself
 *                           (Ollama, LM Studio, vLLM, llama.cpp). Nothing
 *                           leaves the machine; no Anthropic key needed.
 *   otherwise            -> Anthropic, with the key held here. On Netlify the
 *                           AI Gateway can inject ANTHROPIC_API_KEY and
 *                           ANTHROPIC_BASE_URL; a key you set yourself wins.
 *
 * Vision (import) always goes to Anthropic, whatever LOCAL_MODEL_URL says, and
 * is rejected outright when no key is configured — never silently degraded.
 *
 * Raster renders go to an image model (Gemini by default). They are refused in
 * local-model mode, because the whole point of that mode is that nothing
 * leaves the machine.
 *
 * The model and token budgets are fixed here, so a page cannot talk the server
 * into a bigger spend. Responses are normalised to the Anthropic content-block
 * shape so the client does not care which backend answered.
 */

import Anthropic from '@anthropic-ai/sdk';

// Keep in sync with MODEL_ID / TASK_CONFIG in lib/ai.js. Opus 5.5 always thinks
// and that thinking comes out of max_tokens, so each budget sits well above
// the size of the answer itself. Drawing a panel needs by far the most room.
const MODEL_ID = 'claude-opus-5-5';
const TASK_CONFIG = {
  scene: { maxTokens: 8000, effort: 'low' },
  shots: { maxTokens: 8000, effort: 'low' },
  sketch: { maxTokens: 8000, effort: 'low' },
  art: { maxTokens: 32000, effort: 'medium' },
  import: { maxTokens: 12000, effort: 'low' },
};
const DEFAULT_TASK = 'shots';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const DEFAULT_RASTER_MODEL = 'gemini-2.5-flash-image';
const RASTER_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const MAX_RASTER_INPUT_CHARS = 6 * 1024 * 1024;

/* An unrecognised task falls back to the smallest budget rather than erroring. */
function configFor(task) {
  return TASK_CONFIG[task] || TASK_CONFIG[DEFAULT_TASK];
}

function fail(status, error) {
  return { status, body: { error } };
}

/* ---------------- Local model ---------------- */

async function callLocalModel(content, env, cfg, extraHeaders = {}, extraBody = {}) {
  const upstream = await fetch(env.LOCAL_MODEL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({
      model: env.LOCAL_MODEL_NAME || 'llama3.1',
      max_tokens: cfg.maxTokens,
      stream: false,
      messages: [{ role: 'user', content }],
      ...extraBody,
    }),
  });

  let data = null;
  try {
    data = await upstream.json();
  } catch {
    data = null;
  }
  if (!upstream.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      `Local model error (${upstream.status})`;
    return fail(upstream.status, String(message));
  }

  // OpenAI-compatible servers answer with choices[].message.content; Ollama's
  // native /api/chat answers with message.content. Accept either.
  const text =
    (data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    (data && data.message && data.message.content) ||
    '';
  if (!text) return fail(502, 'The local model returned an empty or unrecognised response.');
  // Cut off at the length limit: the text is incomplete (often half a JSON
  // document), which the caller needs to know rather than parse.
  const cutOff = data && data.choices && data.choices[0] && data.choices[0].finish_reason === 'length';
  return {
    status: 200,
    body: { content: [{ type: 'text', text }], stop_reason: cutOff ? 'max_tokens' : 'end_turn' },
  };
}

/* ---------------- Free hosted model ----------------
 *
 * An opt-in, no-key text model for people with no API key: by default
 * Pollinations.ai's OpenAI-compatible endpoint (gpt-oss-20b). The page asks
 * for it explicitly ({ provider: 'free' }) — it is a third-party service, so
 * nothing is ever routed there silently — and it is refused in local-model
 * mode, whose whole point is that nothing leaves the machine.
 *
 * The anonymous tier answers one request every 30 seconds per IP, and every
 * visitor of this server shares the server's IP. So requests queue here and
 * are spaced FREE_MODEL_GAP_MS apart; a FREE_LIMIT answer is waited out and
 * retried. With FREE_MODEL_KEY set (a Pollinations key, or any provider's
 * key) there is no spacing.
 */

const DEFAULT_FREE_URL = 'https://text.pollinations.ai/openai';
const DEFAULT_FREE_MODEL = 'openai'; // Pollinations' alias for gpt-oss-20b
const FREE_LIMIT_GAP_MS = 31 * 1000;
const FREE_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let freeChain = Promise.resolve();
let lastFreeReplyAt = 0;

function freeEnabled(env) {
  return (env.FREE_MODEL || '').toLowerCase() !== 'off' && !env.LOCAL_MODEL_URL;
}

function freeGap(env) {
  if (env.FREE_MODEL_GAP_MS !== undefined) return Math.max(0, Number(env.FREE_MODEL_GAP_MS) || 0);
  return env.FREE_MODEL_KEY ? 0 : FREE_LIMIT_GAP_MS;
}

/* One request at a time, at least `gap` after the previous reply. */
function queueFree(env, fn) {
  const run = freeChain.then(async () => {
    const wait = lastFreeReplyAt + freeGap(env) - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastFreeReplyAt = Date.now();
    }
  });
  freeChain = run.catch(() => {});
  return run;
}

async function callFreeModel(content, env, cfg) {
  const target = {
    LOCAL_MODEL_URL: env.FREE_MODEL_URL || DEFAULT_FREE_URL,
    LOCAL_MODEL_NAME: env.FREE_MODEL_NAME || DEFAULT_FREE_MODEL,
  };
  const headers = env.FREE_MODEL_KEY ? { Authorization: `Bearer ${env.FREE_MODEL_KEY}` } : {};
  const reasoningSetting = (env.FREE_MODEL_REASONING || 'low').toLowerCase();
  const reasoningEffort = reasoningSetting === 'off' ? null : reasoningSetting;
  return queueFree(env, async () => {
    for (let attempt = 0; ; attempt++) {
      let result;
      try {
        // A fresh seed every time: Pollinations caches identical requests, so
        // without it a retry would replay the same (failed) answer, and
        // "Rewrite scene" would hand back the same scene.
        result = await callLocalModel(content, target, cfg, headers, {
          seed: Math.floor(Math.random() * 2 ** 31),
          // gpt-oss is a reasoning model, and the free tier caps each reply.
          // At its default effort the reasoning alone can use the whole cap on
          // a coverage prompt (finish_reason "length", no answer); at "low" it
          // answers in full, and faster. FREE_MODEL_REASONING=off omits it for
          // providers that reject the field.
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        });
      } catch {
        return fail(502, 'Could not reach the free model. Check your connection and try again.');
      }
      const limited = result.status === 402 || result.status === 429;
      // No text, or a reply cut off at the length limit: worth another try.
      const empty =
        result.status === 502 || (result.status === 200 && result.body.stop_reason === 'max_tokens');
      if (!limited && !empty) return result;
      if (attempt >= FREE_RETRIES) {
        return limited
          ? fail(
              429,
              'The free model is busy (it allows one request every 30 seconds). Try again in a minute, or add an API key in Settings.',
            )
          : fail(
              502,
              'The free model returned an empty or incomplete answer. Try again — or use Claude for more reliable results.',
            );
      }
      // Either way the free tier counted a reply: wait out the window first.
      await sleep(freeGap(env) || 1000);
    }
  });
}

/* ---------------- Anthropic ---------------- */

/* Server-side refusal fallbacks are a beta the API itself serves; a gateway in
   between (Netlify's) does not pass beta headers through, so they are only
   requested when talking to Anthropic directly. */
function talksToAnthropicDirectly(env) {
  const base = (env.ANTHROPIC_BASE_URL || '').trim();
  return !base || /^https:\/\/api\.anthropic\.com\/?$/.test(base);
}

async function callAnthropic(content, env, cfg) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
    timeout: 14 * 60 * 1000,
  });
  const params = {
    model: MODEL_ID,
    max_tokens: cfg.maxTokens,
    output_config: { effort: cfg.effort },
    messages: [{ role: 'user', content }],
  };

  // Streamed so a long drawing never trips an idle-connection timeout; only
  // the finished message is needed.
  const message = talksToAnthropicDirectly(env)
    ? await client.beta.messages
        .stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        .finalMessage()
    : await client.messages.stream(params).finalMessage();

  // A refusal is a normal response with stop_reason "refusal"; the client
  // turns it into a readable message, so it passes through as-is.
  return {
    status: 200,
    body: { content: message.content, stop_reason: message.stop_reason, model: message.model },
  };
}

function anthropicError(err) {
  if (err instanceof Anthropic.APIError && err.status) {
    const detail = err.error && err.error.error && err.error.error.message;
    return fail(err.status, detail || err.message || `Anthropic API error (${err.status})`);
  }
  return fail(502, 'Failed to reach the Anthropic API.');
}

/* ---------------- Raster (image model) ---------------- */

function closestAspect(requested) {
  const [w, h] = String(requested || '16:9')
    .split(':')
    .map(Number);
  const target = w > 0 && h > 0 ? w / h : 16 / 9;
  let best = '16:9';
  let bestDiff = Infinity;
  RASTER_ASPECTS.forEach((a) => {
    const [aw, ah] = a.split(':').map(Number);
    const diff = Math.abs(Math.log(aw / ah / target));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = a;
    }
  });
  return best;
}

async function runRaster(content, env, saveImage) {
  if (env.LOCAL_MODEL_URL) {
    return fail(
      501,
      'Image rendering is off in local-model mode — it would send the sketch to a hosted image model.',
    );
  }
  if (!env.GEMINI_API_KEY) {
    return fail(
      501,
      'Image rendering is not set up on this server. Set GEMINI_API_KEY (or enable the Netlify AI Gateway) to turn it on.',
    );
  }
  const prompt = content && typeof content.prompt === 'string' ? content.prompt.slice(0, 6000) : '';
  const image = content && typeof content.image === 'string' ? content.image : '';
  if (
    !prompt ||
    !image ||
    image.length > MAX_RASTER_INPUT_CHARS ||
    !/^[A-Za-z0-9+/=]+$/.test(image)
  ) {
    return fail(400, 'A render needs a prompt and the sketch as a base64 PNG.');
  }

  // Loaded on first use so text-only deployments never pay for it.
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    ...(env.GOOGLE_GEMINI_BASE_URL ? { httpOptions: { baseUrl: env.GOOGLE_GEMINI_BASE_URL } } : {}),
  });

  let response;
  try {
    response = await ai.models.generateContent({
      model: env.RASTER_MODEL || DEFAULT_RASTER_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'image/png', data: image } }, { text: prompt }],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: closestAspect(content.aspect) },
      },
    });
  } catch (err) {
    const status = Number(err && err.status) || 502;
    return fail(status, `The image model could not render this panel (${status}).`);
  }

  const parts =
    (response && response.candidates && response.candidates[0] && response.candidates[0].content
      ? response.candidates[0].content.parts
      : null) || [];
  const picture = parts.find((p) => p.inlineData && /^image\//.test(p.inlineData.mimeType || ''));
  if (!picture) {
    return fail(502, 'The image model declined or returned no picture. Try a different style.');
  }
  const mimeType = picture.inlineData.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = Buffer.from(picture.inlineData.data, 'base64');

  // Stored server-side when the host has somewhere to put it, so boards carry
  // a short URL instead of megabytes of base64. Otherwise inline.
  if (saveImage) {
    const imageUrl = await saveImage(bytes, mimeType);
    return { status: 200, body: { imageUrl } };
  }
  return { status: 200, body: { image: `data:${mimeType};base64,${bytes.toString('base64')}` } };
}

/* ---------------- Entry point ---------------- */

function describeBackend(env) {
  return {
    text: env.LOCAL_MODEL_URL ? 'local' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'none',
    vision: Boolean(env.ANTHROPIC_API_KEY),
    raster: Boolean(env.GEMINI_API_KEY) && !env.LOCAL_MODEL_URL,
    free: freeEnabled(env),
    // Spacing between free-model requests, so the page can set expectations.
    freeGapSeconds: freeEnabled(env) ? Math.round(freeGap(env) / 1000) : 0,
  };
}

async function runGeneration(body, { env = process.env, saveImage = null } = {}) {
  const task = body && body.task;
  const content = body && body.content;

  if (task === 'raster') return runRaster(content, env, saveImage);

  const cfg = configFor(task);
  const isTextPrompt = typeof content === 'string' && content.trim().length > 0;
  const isVisionContent = Array.isArray(content) && content.length > 0;
  if (!isTextPrompt && !isVisionContent) {
    return fail(400, 'Request body must include a non-empty "content" string or array.');
  }

  if (body.provider === 'free') {
    if (!freeEnabled(env)) {
      return fail(
        403,
        env.LOCAL_MODEL_URL
          ? 'The free hosted model is off in local-model mode — it would send your text off this machine.'
          : 'The free model is turned off on this server.',
      );
    }
    if (isVisionContent) {
      return fail(400, 'Reading an existing board needs Claude vision — the free model cannot see images.');
    }
    return callFreeModel(content, env, cfg);
  }

  if (isVisionContent) {
    if (!env.ANTHROPIC_API_KEY) {
      return fail(
        400,
        'Importing a storyboard file needs an Anthropic API key (for vision) — set ANTHROPIC_API_KEY on the server, or add your own key under API settings. Local models are not supported for this.',
      );
    }
    try {
      return await callAnthropic(content, env, cfg);
    } catch (err) {
      return anthropicError(err);
    }
  }

  if (env.LOCAL_MODEL_URL) {
    try {
      return await callLocalModel(content, env, cfg);
    } catch {
      return fail(502, `Failed to reach the local model at ${env.LOCAL_MODEL_URL}. Is it running?`);
    }
  }
  if (!env.ANTHROPIC_API_KEY) {
    return fail(
      500,
      'Server has neither ANTHROPIC_API_KEY nor LOCAL_MODEL_URL set, so it cannot generate.',
    );
  }
  try {
    return await callAnthropic(content, env, cfg);
  } catch (err) {
    return anthropicError(err);
  }
}

export { runGeneration, describeBackend, MODEL_ID, TASK_CONFIG };
