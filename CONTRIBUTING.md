# Contributing to Never Bored

Thanks for helping out! This is how to get the project running and send changes.

## 1. Get access

The repository is private. Ask the owner to add you on GitHub
(*repo → Settings → Collaborators → Add people*), then accept the email invite.

## 2. Run it locally

You need [Node.js](https://nodejs.org) 20.9 or newer and git.

```bash
git clone https://github.com/Anshuldhakar1/never-bored.git
cd never-bored
npm install
npm run dev            # http://localhost:3000
```

No API keys are needed: everything works, and for AI you can switch on the free model
in the studio (⋯ → AI & API settings). To use Claude, copy `.env.example` to
`.env.local` and add your own `ANTHROPIC_API_KEY`. **Never commit `.env.local` or any
key** — it is already in `.gitignore`.

Handy to know: open `/studio?demo=1` for a 16-panel demo board, and press `?` in the
studio for keyboard shortcuts. The README explains the layout and the rules that
matter (especially: model-generated SVG always goes through `lib/svgsafe.js`).

## 3. Send a change

Work on a branch and open a pull request — please don't push to `main` directly.

```bash
git switch main && git pull           # start from the latest code
git switch -c short-description       # e.g. fix-timeline-trim
# …make your changes…
npm run build                         # must pass before you open the PR
git add -A
git commit -m "Fix trimming on the timeline"
git push -u origin short-description
```

Then open the pull request on GitHub (it offers a button after the push). Describe what
changed and how you checked it in the browser.

## 4. Deploying

Pushing to GitHub never deploys on its own — deploys are a deliberate, manual step.
You can do it yourself, without a Vercel account, through the project's **deploy hook**:

1. **Once:** ask the owner for the deploy hook URL (send it privately — never in an issue,
   a pull request or chat that others can read). Create a file named `.env.local` in the
   project folder with this line:
   ```
   DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/…
   ```
   `.env.local` is git-ignored, so it never gets committed. Treat the URL like a password:
   anyone who has it can deploy the site.
2. **Each time** your change is merged into `main` on GitHub:
   ```bash
   git switch main
   npm run deploy -- --hook
   ```
   It pulls the latest `main`, checks everything is in order, asks Vercel to build
   GitHub's `main`, and waits until the new version is live (about a minute).

Try `npm run deploy -- --hook --dry-run` first to see what it will do without doing it.
If something is wrong it stops and tells you what to fix.
