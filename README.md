# Never Bored — No more boarding around

A storyboarding workspace, rebuilt as a **Next.js** app. Paste a scene or drop in a
whole screenplay and it is boarded as panels on a timeline. Every panel starts as a
stick-figure sketch you can refine with AI line art, draw over by hand, render as a
finished image, review with your team, and export as PDF or SVG.

> **Logos are placeholders.** The mark lives in `components/brand/Logo.jsx` and the
> favicon in `app/icon.svg`. Replace both; nothing else references the artwork.

## Quick start

```bash
npm install
cp .env.example .env.local      # optional — add ANTHROPIC_API_KEY for the AI buttons
npm run dev                     # http://localhost:3000
```

Without any key the app still works end to end: boards, drawing, screenplay import,
stick-figure sketches, sharing on your machine, and export. For AI without a key, switch
on the **free model** (one click wherever the studio says AI is off, or *Settings → AI
provider*).

### Try it in 30 seconds

- **Demo board** — open `/studio?demo=1` (or *Try the demo board* on the home page,
  *Load demo board* in the studio's ⋯ menu). "The Last Roof" is a 16-panel, three-scene,
  two-sequence board built to exercise the studio: camera moves (crane, push-in, pan,
  pull-out) to play with Space, every transition, varied durations, screenplay text per
  scene, hand-drawn layers (one hidden alternate, one locked note), dialogue and notes.
  Export it as PDF or SVG, share it, or poke at any panel.
- **Scene from a prompt** — *New board → From a scene → Write it for me*: type an idea
  ("a lighthouse keeper finds a stranger on the rocks"), get a screenplay scene in the
  box, edit it, then *Build board*.

## AI providers

| Provider | Key | Quality / speed | Notes |
| --- | --- | --- | --- |
| **Claude** (`claude-opus-5-5`) | `ANTHROPIC_API_KEY` on the server, or the user's own key in Settings | Best; parallel | All features, including reading existing boards (vision). |
| **Free model** — gpt-oss-20b via [Pollinations.ai](https://pollinations.ai) | none | Good for scenes and coverage; ~30 s between requests | Opt-in per user, because text goes to a third-party service. Scene writing, coverage, AI sketch and line art; not board import. Requests queue on the server (the free tier allows one reply every 30 s per IP) and retry on rate limits or incomplete replies. `FREE_MODEL_KEY` removes the spacing. Off in local-model mode. |
| **Local model** | none | Depends on the model | `LOCAL_MODEL_URL` — nothing leaves the machine. |

Rendered images use Gemini (`GEMINI_API_KEY`) whichever text provider is chosen.

Production: `npm run build && npm start`.

## Environment

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude (`claude-opus-5-5`) for coverage, sketches, line art and board import. |
| `GEMINI_API_KEY`, `RASTER_MODEL` | Image renders (*Render*). Default model `gemini-2.5-flash-image`. |
| `LOCAL_MODEL_URL`, `LOCAL_MODEL_NAME` | Any OpenAI-compatible local model. Nothing leaves the machine; board import and renders are switched off. |
| `FREE_MODEL`, `FREE_MODEL_KEY`, `FREE_MODEL_URL`, `FREE_MODEL_NAME`, `FREE_MODEL_REASONING`, `FREE_MODEL_GAP_MS` | The free model — see `.env.example`. `FREE_MODEL=off` hides it. |
| `BETA_ACCESS_CODE` | Require a code (entered under *AI & API settings*) before anyone can generate or share. |
| `DATA_DIR` | Where shared boards, review notes and rendered images are stored (default `./.data`). |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Store shared boards in Upstash Redis instead (Vercel sets these when you connect Upstash). |
| `SHARING=off` | Turn sharing off. On Vercel without Redis it is off automatically. |

Visitors can also paste **their own** Anthropic key under *AI & API settings*. It stays in
their browser and is sent straight to Anthropic — never to this server, a board, an
export or a share link.

## The pages

- **`/`** — landing page. Offers to continue the board kept in this browser.
- **`/studio`** — the workspace. `/studio?new=scene|screenplay|import|blank` opens the
  new-board dialog on that tab. Share links look like `/studio#board=<id>&key=<key>`
  (old `/#board=…` links are forwarded).

## What's in the studio

- **Four ways to start**, one dialog: paste a scene (AI coverage in Classic / Minimalist /
  Dynamic / custom styles, each its own scene to compare — with a *Try a sample scene*
  button), a screenplay (PDF or `.fdx`, drag and drop, scene picker with filter), photos
  or a PDF of an existing board, or blank. Also *Open a project file*.
- **Stage** with a floating tool rail (Select, Brush, Line, Rectangle, Ellipse, Eraser),
  ink swatches and stroke width, onion skin, thirds/safe guides, and draggable camera
  START/END frames that play back as an animatic.
- **Navigator**: sequences → collapsible scenes → panels, inline rename, slug lines,
  review badges.
- **Inspector**: panel art (Quick sketch, Sketch with AI, Detailed line art, Render),
  a visual shot-type picker, angle/lens/movement/transition, content with live counters,
  duration in frames *or* seconds with presets, camera move, layers (visibility, lock,
  rename, opacity, reorder), and review notes/approvals on shared boards.
- **Timeline**: widths proportional to duration, zoom, a keyboard-accessible ruler to
  scrub, **drag to reorder** (across scenes too), **drag a panel's right edge to trim
  it**, transitions and camera moves marked on the strip.
- **Undo everywhere**: destructive actions (delete panel/scene, new board, open file)
  show a toast with *Undo*.
- **Exports download directly**: PDF contact sheet, single SVG of the board (true
  vector), project JSON (`Ctrl S`).
- **Team & review**: edit link (one editor at a time, everyone else follows live, take
  over) and review link (notes, approve / needs changes).
- **Keyboard**: press `?` in the studio for the full list.
- Responsive: below 1100px the navigator and inspector become drawers.

## Layout

```
app/
  page.jsx                landing page
  studio/page.jsx         the studio (client-only, see StudioLoader)
  api/[...path]/route.js  every /api route → server/router.js
  globals.css             all styling; palette = custom properties at the top
  icon.svg                PLACEHOLDER favicon
components/
  brand/Logo.jsx          PLACEHOLDER logo
  landing/                hero illustration, continue-your-board actions
  studio/                 React UI: TopBar, Navigator, Stage, Inspector, Timeline,
                          Toasts, Modal (focus trap), ui primitives, dialogs/
lib/                      the document model and logic — framework-free ES modules
  svgsafe.js              SVG sanitiser + isSafeRasterSrc   ← security-critical
  store.js                document model, undo, autosave, read-only switch
  stage.js, draw.js       imperative SVG stage, vector tools, camera, playback
  sketch.js               stick figures: blocking spec → vector geometry
  demo.js                 the "The Last Roof" demo board (plain data)
  screenplay.js           FDX / PDF → scenes → beats → quick panels
  ai.js                   every model call from the page
  cloud.js                shared boards: links, editor seat, polling, review
  exporter.js             PDF, SVG, project file
  panelOps.js             structural edits (add/move/delete panels, layers…)
  actions.js              what the buttons do (generation, import, export)
  studioBus.js            transient UI state: status, progress, toasts
  thumbs.js, aiState.js, vocab.js
server/
  router.js               every /api route, host-agnostic
  generate-core.js        Anthropic (streamed) / local model / Gemini
  storage.js              local directory and Netlify Blobs adapters
```

The `lib/` modules are ported almost verbatim from the original vanilla-JS app; React
subscribes to them (`useSyncExternalStore` on a tick counter) rather than replacing
them. That keeps the behaviour that was tested — sanitising, undo coalescing, the
shared-board seat — exactly as it was.

## Rules that matter

1. **No API key in client code or a commit.** The user's own key lives only in their
   `localStorage`.
2. **Model-generated SVG goes through `lib/svgsafe.js`** — to DOM nodes, never to a
   string re-parsed via `innerHTML` — on the way in, out of storage, and off the server.
   Stick-figure sketches arrive from the model as JSON, never markup. The only
   `dangerouslySetInnerHTML` is `TrustedSvg`, for shot icons built from our own op list.
3. **A rendered image is a checked `src`**, never markup (`isSafeRasterSrc`,
   `rasterImageNode`).
4. **Mutate the document through `commit()`** (undo, autosave, read-only guard).
   `update()` is for view state.
5. **Text inputs bound to the store use `useSyncedValue`** so typing never loses the
   caret to a re-render.
6. **`MODEL_ID` and `TASK_CONFIG` live in `lib/ai.js` and `server/generate-core.js`** —
   change both.
7. **Shared-board storage never does read-modify-write**; never log or send a board
   link (its `#fragment` holds the key).
8. **Accessibility**: real buttons with labels, dialogs through `Modal`, toggles with
   `aria-pressed`.

## Deploying

### One command: `npm run deploy`

This project is linked to the Vercel project `never-bored` and the GitHub repo, with
automatic deploys **off** (`vercel.json`), so pushing never deploys on its own. To ship:

```bash
npm run deploy -- -m "what changed"   # commit everything, push to GitHub, deploy to production
npm run deploy                        # deploy what's already committed
npm run deploy -- --dry-run           # show what would happen, change nothing
```

It checks first (Vercel login, project link, branch `main`), pulls anything new from
GitHub (a teammate's merged work), pushes so production always matches GitHub, deploys
with `vercel deploy --prod`, then checks the live site responds. It stops with the fix
at the first problem — including when both your copy and GitHub have new commits.

### Working with another developer

Contributors follow [CONTRIBUTING.md](CONTRIBUTING.md): clone, branch, open a pull
request. Adding them as a GitHub collaborator is free (*repo → Settings →
Collaborators*).

The repo is **public**, so on Vercel's free plan anyone's commits can be deployed
("collaboration is free for public repositories"). Deploys stay manual:

- **You** (logged in to Vercel): `npm run deploy` — uses the Vercel CLI.
- **Your teammate** (no Vercel account needed): `npm run deploy -- --hook` — triggers the
  project's deploy hook `teammate-deploy`, which builds GitHub's `main`. The hook URL is in
  your `.env.local` (`DEPLOY_HOOK_URL=…`); send it to them **privately**. Anyone with the
  URL can deploy, so if it leaks: Vercel → never-bored → *Settings → Git → Deploy Hooks*,
  delete it, create a new one, and share the new URL.

`npm run deploy` checks the repo's visibility: if you ever make it private again, it
stops before deploying a teammate's commit (a private repo on the free plan only deploys
the owner's commits) and explains the options — Vercel Pro ($20 per developer / month)
or merging with "Create a merge commit". Never share your Vercel login or token: it
controls your whole account.

### Vercel — free (Hobby plan)

The app is ready for Vercel as-is: no `vercel.json` needed, functions fit the Hobby
plan's 300-second limit, and requests stay under its 4.5 MB body limit. Vercel's disk
is read-only, so **sharing switches itself off** until you connect a database — every
other feature works.

1. **Deploy.** Either:
   - **CLI (fastest, no GitHub):** in this folder run `npx vercel` (log in when asked,
     accept the defaults), then `npx vercel --prod` for the public URL; or
   - **GitHub:** push the project to a repo, then *vercel.com → Add New → Project →
     Import*. If `never-bored/` is a subfolder of the repo, set **Root Directory** to
     `never-bored`. Every push then redeploys.
2. **AI (pick one, optional):**
   - nothing to set up for the **free model** — visitors switch it on in the studio;
   - or add `ANTHROPIC_API_KEY` under *Settings → Environment Variables* **and also
     `BETA_ACCESS_CODE`**, otherwise anyone with the link spends your key. Give the code
     to your testers (they enter it under *AI & API settings*).
3. **Sharing & review (optional, free):** *Project → Storage → Marketplace → Upstash →
   Redis* (free plan), connect it to the project, then **redeploy**. The integration
   adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which the app detects automatically.
   The free tier gives 500K commands/month; an open shared-board tab polls about
   3,600 commands an hour, so that's roughly 140 tab-hours a month.
4. Redeploy after changing environment variables (*Deployments → ⋯ → Redeploy*).

Vercel's Hobby plan is for personal, non-commercial projects.

### Other hosts

- **Any Node host** (`npm run build && npm start`): everything works, boards stored in
  `DATA_DIR`. Put it behind `BETA_ACCESS_CODE` if it's public.
- **Netlify**: with `NETLIFY=true` the API stores boards in Netlify Blobs.
- **Any host + Upstash**: set `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) and boards go to Redis.
- `SHARING=off` turns sharing off anywhere.

## License

MIT — see [LICENSE](LICENSE).
