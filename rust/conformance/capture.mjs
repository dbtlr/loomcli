#!/usr/bin/env node
// Captures the conformance corpus: runs every case in conformance/cases/*.json against the
// TypeScript reference examples and writes stdout, stderr, and the exit code to conformance/expected/.
//
//   LOOM_TS_REF=/path/to/loomcli node conformance/capture.mjs [--only <id-prefix>]
//
// No dependencies. The format and the rules are in conformance/README.md.

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  realpathSync,
  renameSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const casesDir = join(here, 'cases');
const fixturesDir = join(here, 'fixtures');
const expectedDir = join(here, 'expected');
const scratch = join(repo, '.scratch');
const sandboxRoot = join(scratch, 'capture');
const buildCopy = join(scratch, 'ref-build');
const APPS = ['jsonkit', 'textstat'];
const TIMEOUT_MS = 30_000;
const SANDBOX_TOKEN = '{sandbox}';

function fail(message) {
  console.error(`capture: ${message}`);
  rmSync(`${expectedDir}.tmp`, { force: true, recursive: true });
  process.exit(1);
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout.trim();
}

/** The newest modification time under the sources of the reference packages and examples. */
function newestSource(ref) {
  let newest = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  };
  for (const group of ['packages', 'examples']) {
    const base = join(ref, group);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const src = join(base, entry.name, 'src');
      if (entry.isDirectory() && existsSync(src)) visit(src);
    }
  }
  return newest;
}

function builtInPlace(ref) {
  const newest = newestSource(ref);
  return APPS.every((app) => {
    const main = join(ref, 'examples', app, 'dist', 'main.js');
    return existsSync(main) && statSync(main).mtimeMs >= newest;
  });
}

/**
 * Returns the checkout whose dist the cases run. The reference checkout is read-only, so a dist
 * older than its sources is rebuilt in a copy under .scratch/ref-build, never in place.
 */
function prepareBuild(ref, stamp, forceRebuild) {
  if (!forceRebuild && builtInPlace(ref)) return { root: ref, how: 'reference checkout dist' };
  const marker = join(buildCopy, '.built-for');
  if (!(existsSync(marker) && readFileSync(marker, 'utf8') === stamp)) {
    console.error('capture: reference dist is older than its sources; rebuilding in .scratch/ref-build');
    if (!realpathSync(scratch).startsWith(repo)) fail('.scratch resolves outside the repository');
    rmSync(buildCopy, { force: true, recursive: true });
    mkdirSync(scratch, { recursive: true });
    mkdirSync(buildCopy, { recursive: true });
    // cp -R keeps pnpm's relative symlinks relative, which a Node copy would not.
    // The reference path may itself be a symlink, so copy the folder it names, not the link.
    run('cp', ['-R', `${realpathSync(ref)}/.`, buildCopy]);
    run('pnpm', ['build'], { cwd: buildCopy });
    run('pnpm', ['run', 'build:examples'], { cwd: buildCopy });
    writeFileSync(marker, stamp);
  }
  return { root: buildCopy, how: 'rebuilt in a scratch copy because the reference dist was stale' };
}

function loadCases() {
  const cases = [];
  const seen = new Set();
  for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
    for (const c of parsed.cases) {
      const where = `${file}: ${c.id}`;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(c.id ?? '')) fail(`${where}: bad id`);
      if (seen.has(c.id)) fail(`${where}: duplicate id`);
      seen.add(c.id);
      if (!APPS.includes(c.app)) fail(`${where}: unknown app`);
      if (!Array.isArray(c.argv) || !c.argv.every((a) => typeof a === 'string')) {
        fail(`${where}: argv must be an array of strings`);
      }
      if (c.stdin !== undefined && c.session !== undefined) fail(`${where}: stdin and session are never combined`);
      if (c.cwd !== undefined) {
        const target = resolve(fixturesDir, c.cwd);
        if (c.cwd.startsWith('/') || !target.startsWith(`${fixturesDir}/`) || !existsSync(target)) {
          fail(`${where}: cwd must name an existing folder under fixtures/`);
        }
      }
      for (const name of c.fixtures ?? []) {
        if (!existsSync(join(fixturesDir, name))) fail(`${where}: missing fixture ${name}`);
      }
      cases.push({ ...c, group: file.replace(/\.json$/, '') });
    }
  }
  return cases;
}

/** The line one session item sends: a string is a raw line, any other value is compact JSON. */
function sessionLine(item) {
  return `${typeof item === 'string' ? item : JSON.stringify(item)}\n`;
}

/** Whether the server answers a session item: a raw line, or a JSON object with an "id". */
function expectsAnswer(item) {
  return (typeof item === 'string' && item.trim() !== '') || (item !== null && typeof item === 'object' && 'id' in item && !('result' in item) && !('error' in item));
}

/** The whole input a case feeds: `stdin` as text, or the lines of `session` joined. */
function stdinText(c) {
  if (c.session !== undefined) return c.session.map(sessionLine).join('');
  return c.stdin ?? '';
}

/** Runs the child. A session sends one line at a time and waits for each answer before the next. */
function execute(command, args, { cwd, env }, c, stdin) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let lines = 0;
    let waiter;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`${c.id}: timed out`);
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      out.push(chunk);
      lines += [...chunk].filter((b) => b === 10).length;
      waiter?.();
    });
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => fail(`${c.id}: ${error.message}`));
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolveRun({ status, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    const answered = (target) =>
      new Promise((done) => {
        waiter = () => lines >= target && ((waiter = undefined), done());
        waiter();
      });
    (async () => {
      if (c.session === undefined) {
        child.stdin.end(stdin);
        return;
      }
      let target = 0;
      for (const item of c.session) {
        child.stdin.write(sessionLine(item));
        if (expectsAnswer(item)) await answered(++target);
      }
      child.stdin.end();
    })();
  });
}

function listFiles(directory, base = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path, base) : [relative(base, path)];
    })
    .sort();
}

function fixtureSnapshot(directory = fixturesDir) {
  return listFiles(directory)
    .map((f) => `${f}:${createHash('sha256').update(readFileSync(join(directory, f))).digest('hex')}`)
    .join('\n');
}

const decoder = new TextDecoder('utf-8', { fatal: true });
function decode(buffer, what) {
  try {
    return decoder.decode(buffer);
  } catch {
    fail(`${what} is not valid UTF-8`);
  }
}

async function runCase(c, root, node, pristine) {
  const sandbox = join(sandboxRoot, c.id);
  rmSync(sandbox, { force: true, recursive: true });
  const home = join(sandbox, 'home');
  const work = join(sandbox, 'work');
  for (const dir of [home, work, join(sandbox, 'tmp')]) mkdirSync(dir, { recursive: true });
  // The fixtures live inside HOME so a configuration search from the working directory stops
  // at the fixtures folder and never reads a file from an ancestor of the checkout.
  const fixturesCopy = join(home, 'fixtures');
  cpSync(fixturesDir, fixturesCopy, { recursive: true });
  const cwd = join(fixturesCopy, c.cwd ?? '');
  const substitute = (text) => text.split(SANDBOX_TOKEN).join(work);
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    TMPDIR: join(sandbox, 'tmp'),
  };
  for (const [key, value] of Object.entries(c.env ?? {})) env[key] = substitute(value);
  const stdin = stdinText(c);
  const result = await execute(
    node,
    [join(root, 'examples', c.app, 'dist', 'main.js'), ...c.argv.map(substitute)],
    { cwd, env },
    c,
    stdin,
  );
  if (result.status === null) fail(`${c.id}: ended by signal ${result.signal}`);
  if (fixtureSnapshot(fixturesCopy) !== pristine) fail(`${c.id}: the case changed the fixtures`);
  const normalize = (text) => text.split(work).join(SANDBOX_TOKEN);
  const produced = listFiles(work).map((name) => ({
    name,
    text: normalize(decode(readFileSync(join(work, name)), `${c.id}: file ${name}`)),
  }));
  const captured = {
    stdin,
    stdout: normalize(decode(result.stdout, `${c.id}: stdout`)),
    stderr: normalize(decode(result.stderr, `${c.id}: stderr`)),
    exit: result.status,
    produced,
  };
  rmSync(sandbox, { force: true, recursive: true });
  return captured;
}

function safeReal(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const dirty = [];
function assertClean(c, captured, forbidden) {
  const texts = [captured.stdout, captured.stderr, ...captured.produced.map((p) => p.text)];
  for (const text of texts) {
    for (const needle of forbidden) {
      if (needle && text.includes(needle)) dirty.push(`${c.id}: output embeds machine path ${needle}`);
    }
  }
}

function writeExpected(c, captured, outDir) {
  const dir = join(outDir, c.id);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stdout'), captured.stdout);
  writeFileSync(join(dir, 'stderr'), captured.stderr);
  writeFileSync(join(dir, 'exit'), `${captured.exit}\n`);
  if (c.stdin !== undefined || c.session !== undefined) writeFileSync(join(dir, 'stdin'), captured.stdin);
  for (const file of captured.produced) {
    const target = join(dir, 'files', file.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.text);
  }
}

async function main() {
  const refEnv = process.env.LOOM_TS_REF;
  if (!refEnv) fail('set LOOM_TS_REF to the reference checkout (for example ../typescript)');
  const ref = resolve(refEnv);
  if (!existsSync(join(ref, 'examples', 'jsonkit'))) fail(`${ref} is not the reference checkout`);
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : undefined;

  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: ref });
  const hasChanges = run('git', ['status', '--porcelain', '--', '.'], { cwd: ref }) !== '';
  const stamp = `${revision}\n${run('git', ['diff', 'HEAD', '--', '.'], { cwd: ref })}`;
  const { root, how } = prepareBuild(ref, stamp, process.argv.includes('--rebuild'));

  const cases = loadCases();
  const before = fixtureSnapshot();
  const node = process.execPath;
  const forbidden = [
    ...new Set([repo, ref, process.env.HOME, process.execPath, here, scratch, safeReal(repo), safeReal(ref), safeReal(fixturesDir)]),
  ].filter((p) => p && p !== '/');

  // A full run writes a fresh tree and swaps it in only after every check passed.
  const outDir = only ? expectedDir : `${expectedDir}.tmp`;
  if (!only) rmSync(outDir, { force: true, recursive: true });
  let count = 0;
  for (const c of cases) {
    if (only && !c.id.startsWith(only)) continue;
    const captured = await runCase(c, root, node, before);
    assertClean(c, captured, forbidden);
    writeExpected(c, captured, outDir);
    count++;
  }
  if (dirty.length) fail(dirty.join('\n'));
  if (fixtureSnapshot() !== before) fail('a case changed conformance/fixtures');
  rmSync(sandboxRoot, { force: true, recursive: true });

  if (!only) {
    const meta = {
      reference_revision: revision,
      reference_had_uncommitted_changes: hasChanges,
      reference_build: how,
      node_version: process.version,
      platform: process.platform,
      cases: count,
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'META.json'), `${JSON.stringify(meta, null, 2)}\n`);
    rmSync(expectedDir, { force: true, recursive: true });
    renameSync(outDir, expectedDir);
  }
  console.log(`captured ${count} cases`);
}

await main();
