#!/usr/bin/env node
/* One-command production deploy.
 *
 * The owner (logged in to Vercel):
 *   npm run deploy                         deploy what's committed (stops if you have unsaved changes)
 *   npm run deploy -- -m "what changed"    commit everything first, then deploy
 *
 * A teammate (no Vercel account needed — uses the project's deploy hook):
 *   npm run deploy -- --hook               deploy GitHub's `main` via DEPLOY_HOOK_URL
 *   npm run deploy -- --hook -m "message"  commit, push, then deploy the same way
 *   (put DEPLOY_HOOK_URL=… in .env.local — ask the owner for it; never commit it)
 *
 * Either way:
 *   npm run deploy -- --dry-run            show what would happen; change nothing
 *   npm run deploy -- --allow-other-author skip the commit-author check (private repo only)
 *   npm run deploy -- --help
 *
 * What it does, in order — and it stops at the first problem, with the fix:
 *   1. Checks: git is here, you're on `main`, and either the Vercel CLI is
 *      logged in and linked (owner) or a deploy hook URL is set (--hook).
 *   2. Syncs: commits your changes (only with -m), pulls anything new on GitHub
 *      (e.g. a teammate's merged work), and pushes `main`. If both sides have
 *      new commits it stops — combine them yourself first.
 *   3. Deploys: owner → `vercel deploy --prod` from these files (identical to
 *      GitHub now); --hook → Vercel builds GitHub's `main` itself.
 *   4. Verifies: the live site answers (and, with --hook, shows the new build).
 *
 * Automatic deploys on push are off (vercel.json: git.deploymentEnabled =
 * false), so pushing on its own never deploys. This script is the deploy.
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'main';
const VERCEL = 'vercel@64.7.0'; // pinned so a CLI update can't change behaviour under you
const PRODUCTION_URL = process.env.DEPLOY_URL || 'https://never-bored.vercel.app';
const HOOK_RE = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/;
const isWin = process.platform === 'win32';

/* ---------------- Arguments ---------------- */

const argv = process.argv.slice(2);
const has = (...flags) => flags.some((f) => argv.includes(f));
const valueOf = (...flags) => {
  const i = argv.findIndex((a) => flags.includes(a));
  return i !== -1 ? argv[i + 1] : undefined;
};
const DRY = has('--dry-run', '-n');
const HOOK = has('--hook');
const message = valueOf('-m', '--message');

if (has('--help', '-h')) {
  // The header comment above is the help text.
  const header = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
  console.log(header.replace(/^#!.*\r?\n/, '').replace(/^\/\*\s?/, '').replace(/^ \* ?/gm, '').trimEnd());
  process.exit(0);
}

/* ---------------- Output ---------------- */

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const green = c('32');
const yellow = c('33');
const red = c('31');
const dim = c('2');

let stepNo = 0;
const step = (title) => console.log(`\n${bold(`${++stepNo}. ${title}`)}`);
const ok = (msg) => console.log(`   ${green('✓')} ${msg}`);
const warn = (msg) => console.log(`   ${yellow('!')} ${msg}`);
const note = (msg) => console.log(`   ${dim(msg)}`);
const would = (msg) => console.log(`   ${yellow('→ would')} ${msg}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* Stopping throws instead of calling process.exit(): exiting while a fetch's
   socket is still closing crashes Node on Windows (UV_HANDLE_CLOSING), which
   would turn a clean stop — or a successful dry run — into exit code 127. */
class Stop extends Error {}
function fail(msg, hint) {
  console.error(`\n${red('✗ Deploy stopped:')} ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error(dim('  Nothing was deployed.'));
  throw new Stop(msg);
}

/* ---------------- Running commands ---------------- */

/* git is a real executable, so arguments (like your commit message) are
   passed as-is, never through a shell. */
function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) fail('git is not installed or not on PATH.');
  if (r.status !== 0 && !allowFail) fail(`git ${args[0]} failed:\n${(r.stderr || r.stdout).trim()}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/* npx is a .cmd shim on Windows, which needs a shell. Only fixed arguments
   are ever passed here — nothing user-typed. */
function npx(args) {
  return spawnSync('npx', ['--yes', ...args], { cwd: ROOT, encoding: 'utf8', shell: isWin, stdio: 'pipe' });
}

/* Streams Vercel's progress to the terminal while keeping a copy: stdout
   carries the deployment URL, stderr any error worth explaining. */
function vercelDeploy() {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', VERCEL, 'deploy', '--prod', '--yes'], {
      cwd: ROOT,
      shell: isWin,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      err += d;
      process.stderr.write(d);
    });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/* DEPLOY_HOOK_URL from the environment, or from .env.local / .env (both are
   git-ignored). Only this one value is read from those files. */
function readHookUrl() {
  if (process.env.DEPLOY_HOOK_URL) return process.env.DEPLOY_HOOK_URL.trim();
  for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^\s*DEPLOY_HOOK_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (m) return m[1].trim();
  }
  return '';
}

/* Public or private? Vercel's free plan deploys anyone's commits from a
   public repo, but only the owner's from a private one. Asked anonymously:
   a public repo answers 200, a private one 404. */
async function repoVisibility() {
  const remote = git(['remote', 'get-url', 'origin'], { allowFail: true }).out;
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return { visibility: 'unknown', slug: remote };
  const slug = `${m[1]}/${m[2]}`;
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { 'User-Agent': 'never-bored-deploy' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) return { visibility: 'private', slug };
    if (r.ok) return { visibility: (await r.json()).private ? 'private' : 'public', slug };
  } catch {
    /* offline or rate-limited — treated as unknown */
  }
  return { visibility: 'unknown', slug };
}

/* A fingerprint of the live home page, to see a new build arrive. */
async function liveFingerprint() {
  try {
    const r = await fetch(PRODUCTION_URL, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const etag = r.headers.get('etag');
    const body = await r.text();
    return { status: r.status, id: etag || crypto.createHash('sha1').update(body).digest('hex') };
  } catch {
    return { status: 0, id: '' };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (has('-m', '--message') && !message) fail('-m needs a message, e.g.  npm run deploy -- -m "Fix the timeline"');

  /* ---------------- 1. Checks ---------------- */

  console.log(
    bold(`Never Bored → production deploy${HOOK ? ' (deploy hook)' : ''}`) +
      (DRY ? yellow('  (dry run — nothing will change)') : ''),
  );

  step('Checking everything is ready');

  if (!git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }).ok) {
    fail('this folder is not a git repository.', `Run the command from ${ROOT}`);
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (branch !== BRANCH) {
    fail(`you are on branch "${branch}", but production deploys from "${BRANCH}".`, `Switch with:  git switch ${BRANCH}`);
  }
  ok(`on branch ${BRANCH}`);

  let hookUrl = '';
  if (HOOK) {
    hookUrl = readHookUrl();
    if (!hookUrl) {
      fail(
        'no deploy hook URL found.',
        'Ask the project owner for it, then add this line to a file named .env.local in the project folder:\n' +
          '    DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/…\n' +
          '  (.env.local is git-ignored — never commit or share the URL publicly: anyone with it can deploy.)',
      );
    }
    if (!HOOK_RE.test(hookUrl)) {
      fail('DEPLOY_HOOK_URL does not look like a Vercel deploy hook.', 'It should start with https://api.vercel.com/v1/integrations/deploy/');
    }
    ok('deploy hook URL found');
  } else {
    const linkFile = path.join(ROOT, '.vercel', 'project.json');
    if (!fs.existsSync(linkFile)) {
      fail(
        'this folder is not linked to a Vercel project.',
        'Owner: run once  npx vercel link   (pick "never-bored").\n  Teammate without Vercel access: use  npm run deploy -- --hook',
      );
    }
    const link = JSON.parse(fs.readFileSync(linkFile, 'utf8'));
    ok(`linked to Vercel project ${link.projectName || link.projectId}`);

    const who = npx([VERCEL, 'whoami']);
    const vercelUser = (who.stdout || '').trim().split(/\r?\n/).pop();
    if (who.status !== 0 || !vercelUser) {
      fail('the Vercel CLI is not logged in.', 'Run once:  npx vercel login   (or, without Vercel access:  npm run deploy -- --hook)');
    }
    ok(`logged in to Vercel as ${vercelUser}`);
  }

  /* ---------------- 2. Sync with GitHub ---------------- */

  step('Saving your work to GitHub');

  const changes = git(['status', '--porcelain']).out;
  if (changes) {
    const files = changes.split(/\r?\n/);
    if (!message) {
      warn(`You have ${plural(files.length, 'unsaved change')}:`);
      files.slice(0, 15).forEach((f) => console.log(dim(`     ${f}`)));
      if (files.length > 15) console.log(dim(`     …and ${files.length - 15} more`));
      fail(
        'there are changes that are not committed, so production would not match GitHub.',
        `Deploy them with a message:  npm run deploy -- ${HOOK ? '--hook ' : ''}-m "what changed"\n  (or commit them yourself first)`,
      );
    }
    if (DRY) {
      would(`commit ${plural(files.length, 'change')} as "${message}"`);
    } else {
      git(['add', '-A']);
      git(['commit', '-q', '-m', message]);
      ok(`committed ${plural(files.length, 'change')}: "${message}"`);
    }
  } else {
    if (message) note('nothing to commit — your -m message was not needed');
    ok('no unsaved changes');
  }

  // Bring in anything new on GitHub — a teammate's merged pull request, an
  // edit made on github.com, work pushed from another computer.
  const fetched = git(['fetch', 'origin', BRANCH, '--quiet'], { allowFail: true });
  if (!fetched.ok) fail('could not reach GitHub to check for changes.', fetched.err);
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', `origin/${BRANCH}...HEAD`]).out.split(/\s+/).map(Number);
  const willCommit = DRY && changes && message ? 1 : 0; // the commit a real run would make
  const localAhead = ahead + willCommit;

  if (behind > 0 && localAhead > 0) {
    // Both sides moved: combining them can conflict, and the result should be
    // tried before it goes live — that is a person's job, not this script's.
    fail(
      `GitHub has ${plural(behind, 'new commit')} and you have ${plural(localAhead, 'commit')} it doesn't — they need combining first.`,
      `Run:  git pull origin ${BRANCH}   (fix any conflicts), check it with  npm run dev , then deploy again.`,
    );
  }
  if (behind > 0) {
    const incoming = git(['log', '--format=%h  %an: %s', `HEAD..origin/${BRANCH}`]).out.split(/\r?\n/);
    if (DRY) {
      would(`pull ${plural(behind, 'new commit')} from GitHub:`);
    } else {
      git(['merge', '--ff-only', '--quiet', `origin/${BRANCH}`]);
      ok(`pulled ${plural(behind, 'new commit')} from GitHub:`);
    }
    incoming.slice(0, 8).forEach((line) => note(`  ${line}`));
    if (incoming.length > 8) note(`  …and ${incoming.length - 8} more`);
  }

  if (localAhead > 0) {
    if (DRY) {
      would(`push ${plural(localAhead, 'commit')} to GitHub (origin/${BRANCH})`);
    } else {
      const pushed = git(['push', '--quiet', 'origin', BRANCH], { allowFail: true });
      if (!pushed.ok) {
        fail(
          'could not push to GitHub.',
          `${pushed.err}\n  If you're a teammate, check you accepted the owner's collaborator invite.`,
        );
      }
      ok(`pushed ${plural(ahead, 'commit')} to GitHub`);
    }
  } else {
    ok('GitHub is up to date');
  }

  // In a dry run nothing was pulled, so look at what *would* be deployed.
  const deployRef = DRY && behind > 0 ? `origin/${BRANCH}` : 'HEAD';
  const commit = git(['log', '-1', '--format=%h %s', deployRef]).out;
  note(`deploying commit ${commit}${willCommit ? ' + your new commit' : ''}`);

  /* Vercel's free (Hobby) plan deploys a PRIVATE repo's commits only when the
     Vercel account owner wrote them; a PUBLIC repo's commits deploy whoever
     wrote them. Check before contacting Vercel rather than fail mid-build. */
  const [authorName = '', authorEmail = ''] = git(['log', '-1', '--format=%an%n%ae', deployRef]).out.split(/\r?\n/);
  const myEmail = git(['config', 'user.email'], { allowFail: true }).out;
  const otherAuthor = !willCommit && myEmail && authorEmail.toLowerCase() !== myEmail.toLowerCase();
  const PRIVATE_AUTHOR_HELP =
    `The repo is private, and on Vercel's free plan a private repo's commits only deploy if the Vercel account owner wrote them.\n` +
    `  Fixes: make the repo public (then anyone's commits deploy), or merge pull requests with "Create a merge commit"\n` +
    `  so the newest commit is the owner's — or, if already merged:  git commit --allow-empty -m "Release"`;
  let repo = { visibility: 'unknown' };
  if (otherAuthor) {
    repo = await repoVisibility();
    if (repo.visibility === 'public') {
      ok(`newest commit is by ${authorName} — fine, the repo is public`);
    } else if (repo.visibility === 'private' && !has('--allow-other-author')) {
      fail(`the newest commit is by ${authorName} <${authorEmail}>, not you (${myEmail}).`, PRIVATE_AUTHOR_HELP);
    } else {
      warn(
        `The newest commit is by ${authorName} <${authorEmail}>. ${
          repo.visibility === 'unknown' ? "Couldn't check whether the repo is public; " : ''
        }if Vercel refuses it, see the message below.`,
      );
    }
  }

  /* ---------------- 3. Deploy ---------------- */

  step(HOOK ? 'Deploying GitHub’s main through the deploy hook' : 'Deploying to production on Vercel');

  if (DRY) {
    would(HOOK ? 'trigger the deploy hook (Vercel builds GitHub’s main)' : `run: npx ${VERCEL} deploy --prod --yes`);
    would(`then check ${PRODUCTION_URL}`);
    console.log(`\n${green('Dry run finished')} — everything is ready. Run without --dry-run to deploy.`);
    return;
  }

  const started = Date.now();

  if (HOOK) {
    const before = await liveFingerprint();
    let job;
    try {
      const r = await fetch(hookUrl, { method: 'POST', signal: AbortSignal.timeout(20000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.job) throw new Error(`Vercel answered ${r.status} ${JSON.stringify(data).slice(0, 160)}`);
      job = data.job;
    } catch (e) {
      fail(
        'the deploy hook did not accept the request.',
        `${e.message}\n  The hook may have been deleted or replaced — ask the owner for the current URL.`,
      );
    }
    ok(`deploy started (job ${job.id})`);
    note('Vercel is building GitHub’s main — usually about a minute. Watching the live site…');

    // Watch for the live site to switch to the new build.
    let after = before;
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(10000);
      after = await liveFingerprint();
      if (after.status === 200 && after.id && after.id !== before.id) break;
      process.stdout.write(dim('.'));
    }
    console.log('');
    step('Checking the live site');
    if (after.status === 200 && after.id !== before.id) {
      ok(`the new build is live after ${Math.round((Date.now() - started) / 1000)}s`);
      console.log(`\n${green('Done!')} Share: ${bold(PRODUCTION_URL)}`);
    } else {
      warn("Couldn't see the new build go live yet.");
      note('  If this change only touched docs, the site looks identical — that is fine.');
      note('  Otherwise give it a minute and refresh; if it never changes, the build may have failed —');
      note('  ask the owner to check the Vercel dashboard (never-bored → Deployments).');
      if (otherAuthor && repo.visibility !== 'public') note(`  ${PRIVATE_AUTHOR_HELP.split('\n')[0]}`);
    }
    return;
  }

  note('building on Vercel — this usually takes about a minute…');
  const { code, out, err } = await vercelDeploy();
  if (code !== 0) {
    if (/must have access|git author|commit author|hobby/i.test(`${out}\n${err}`) || (otherAuthor && repo.visibility !== 'public')) {
      fail('Vercel refused this commit because of who wrote it.', PRIVATE_AUTHOR_HELP);
    }
    fail('Vercel could not deploy (see its messages above).', 'Your code is safely on GitHub; fix the problem and run the deploy again.');
  }
  const deploymentUrl = (out.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();
  ok(`deployed in ${Math.round((Date.now() - started) / 1000)}s${deploymentUrl ? dim(`  (${deploymentUrl})`) : ''}`);

  /* ---------------- 4. Verify ---------------- */

  step('Checking the live site');

  async function check(url) {
    try {
      const r = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(10000) });
      return r.status;
    } catch {
      return 0;
    }
  }
  const home = await check(PRODUCTION_URL);
  const api = await check(`${PRODUCTION_URL}/api/status`);
  if (home === 200 && api === 200) {
    ok(`${PRODUCTION_URL} is live (pages and API respond)`);
    console.log(`\n${green('Done!')} Share: ${bold(PRODUCTION_URL)}`);
  } else {
    warn(`${PRODUCTION_URL} answered ${home || 'nothing'} (page) / ${api || 'nothing'} (API).`);
    note('  The deploy succeeded; the site may need a few seconds. Open it to check.');
  }
}

main().catch((e) => {
  if (!(e instanceof Stop)) console.error(e);
  process.exitCode = 1;
});
