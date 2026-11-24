#!/usr/bin/env node
// Check the built TypeScript examples against the shared expectations in conformance/.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  realpathSync,
  renameSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const repo = resolvePath(workspace, '..');
const conformanceDir = join(repo, 'conformance');
const casesDir = join(conformanceDir, 'cases');
const fixturesDir = join(conformanceDir, 'fixtures');
const expectedDir = join(conformanceDir, 'expected');
const scratch = join(repo, '.scratch');
const APPS = new Set(['jsonkit', 'textstat']);
const TIMEOUT_MS = 30_000;
const SANDBOX_TOKEN = '{sandbox}';

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed:\n${result.stderr ?? result.error?.message ?? ''}`);
  }
  return result.stdout.trim();
}

function scratchRun() {
  mkdirSync(scratch, { recursive: true });
  const location = relative(realpathSync(repo), realpathSync(scratch));
  if (isAbsolute(location) || location === '..' || location.startsWith(`..${sep}`)) {
    fail('.scratch resolves outside the repository');
  }
  return mkdtempSync(join(scratch, 'conformance-'));
}

function loadCases() {
  const cases = [];
  const seen = new Set();
  for (const file of readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .toSorted((left, right) => left.localeCompare(right, 'en'))) {
    const parsed = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
    for (const example of parsed.cases) {
      const where = `${file}: ${example.id}`;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(example.id ?? '')) {
        fail(`${where}: bad id`);
      }
      if (seen.has(example.id)) {
        fail(`${where}: duplicate id`);
      }
      seen.add(example.id);
      if (!APPS.has(example.app)) {
        fail(`${where}: unknown app`);
      }
      if (!Array.isArray(example.argv) || !example.argv.every((arg) => typeof arg === 'string')) {
        fail(`${where}: argv must be an array of strings`);
      }
      if (example.stdin !== undefined && example.session !== undefined) {
        fail(`${where}: stdin and session are never combined`);
      }
      if (example.cwd !== undefined) {
        const target = resolvePath(fixturesDir, example.cwd);
        if (
          example.cwd.startsWith('/') ||
          !target.startsWith(`${fixturesDir}/`) ||
          !existsSync(target)
        ) {
          fail(`${where}: cwd must name an existing folder under fixtures/`);
        }
      }
      for (const name of example.fixtures ?? []) {
        if (!existsSync(join(fixturesDir, name))) {
          fail(`${where}: missing fixture ${name}`);
        }
      }
      cases.push(example);
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
  return (
    (typeof item === 'string' && item.trim() !== '') ||
    (item !== null &&
      typeof item === 'object' &&
      'id' in item &&
      !('result' in item) &&
      !('error' in item))
  );
}

/** The whole input a case feeds: `stdin` as text, or the lines of `session` joined. */
function stdinText(example) {
  if (example.session !== undefined) {
    return example.session.map(sessionLine).join('');
  }
  return example.stdin ?? '';
}

/** Runs the child. A session sends one line at a time and waits for each answer before the next. */
function execute(command, args, { cwd, env }, example, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let lines = 0;
    let waiter = undefined;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(`${example.id}: timed out after ${TIMEOUT_MS / 1000} seconds`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      out.push(chunk);
      lines += [...chunk].filter((byte) => byte === 10).length;
      waiter?.();
    });
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => reject(new Error(`${example.id}: ${error.message}`)));
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ signal, status, stderr: Buffer.concat(err), stdout: Buffer.concat(out) });
    });
    function answered(target) {
      const { promise, resolve: responseReceived } = Promise.withResolvers();
      waiter = () => {
        if (lines >= target) {
          waiter = undefined;
          responseReceived();
        }
      };
      waiter();
      return promise;
    }
    const sendInput = async () => {
      if (example.session === undefined) {
        child.stdin.end(stdin);
        return;
      }
      let target = 0;
      for (const item of example.session) {
        child.stdin.write(sessionLine(item));
        if (expectsAnswer(item)) {
          await answered(++target);
        }
      }
      child.stdin.end();
    };
    sendInput().catch(reject);
  });
}

function listFiles(directory, base = directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listFiles(path, base);
      }
      return entry.isFile() ? [relative(base, path)] : [];
    })
    .toSorted((left, right) => left.localeCompare(right, 'en'));
}

function fixtureSnapshot(directory = fixturesDir) {
  return listFiles(directory)
    .map(
      (name) =>
        `${name}:${createHash('sha256')
          .update(readFileSync(join(directory, name)))
          .digest('hex')}`,
    )
    .join('\n');
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function decode(buffer, what) {
  try {
    return decoder.decode(buffer);
  } catch {
    return fail(`${what} is not valid UTF-8`);
  }
}

async function runCase(example, runDir, pristine) {
  const sandbox = join(runDir, example.id);
  const home = join(sandbox, 'home');
  const work = join(sandbox, 'work');
  for (const dir of [home, work, join(sandbox, 'tmp')]) {
    mkdirSync(dir, { recursive: true });
  }
  /** Keep fixtures inside HOME so a configuration search stops before it reaches the checkout. */
  const fixturesCopy = join(home, 'fixtures');
  cpSync(fixturesDir, fixturesCopy, { recursive: true });
  const cwd = join(fixturesCopy, example.cwd ?? '');
  const substitute = (text) => text.split(SANDBOX_TOKEN).join(work);
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '',
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
  };
  for (const [key, value] of Object.entries(example.env ?? {})) {
    env[key] = substitute(value);
  }
  const stdin = stdinText(example);
  const result = await execute(
    process.execPath,
    [join(workspace, 'examples', example.app, 'dist', 'main.js'), ...example.argv.map(substitute)],
    { cwd, env },
    example,
    stdin,
  );
  if (result.status === null) {
    fail(`${example.id}: ended by signal ${result.signal}`);
  }
  if (fixtureSnapshot(fixturesCopy) !== pristine) {
    fail(`${example.id}: the case changed the fixtures`);
  }
  const canonicalWork = realpathSync(work);
  const normalize = (text) =>
    text.replaceAll(work, SANDBOX_TOKEN).replaceAll(canonicalWork, SANDBOX_TOKEN);
  const produced = listFiles(work).map((name) => {
    const bytes = readFileSync(join(work, name));
    return { name, text: normalize(decode(bytes, `${example.id}: file ${name}`)) };
  });
  const captured = {
    exit: result.status,
    produced,
    stderr: normalize(decode(result.stderr, `${example.id}: stderr`)),
    stdin,
    stdout: normalize(decode(result.stdout, `${example.id}: stdout`)),
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

function assertClean(example, captured, forbidden) {
  const texts = [captured.stdout, captured.stderr, ...captured.produced.map((file) => file.text)];
  for (const text of texts) {
    for (const needle of forbidden) {
      if (text.includes(needle)) {
        fail(`${example.id}: output embeds machine path ${needle}`);
      }
    }
  }
}

function streams(example, captured) {
  return {
    exit: `${captured.exit}\n`,
    stderr: captured.stderr,
    stdin:
      example.stdin !== undefined || example.session !== undefined ? captured.stdin : undefined,
    stdout: captured.stdout,
  };
}

function writeExpected(example, captured, outDir) {
  const dir = join(outDir, example.id);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(streams(example, captured))) {
    if (text !== undefined) {
      writeFileSync(join(dir, name), text);
    }
  }
  for (const file of captured.produced) {
    const target = join(dir, 'files', file.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.text);
  }
}

function matches(path, text) {
  if (!existsSync(path)) {
    return text === undefined;
  }
  return text !== undefined && readFileSync(path).equals(Buffer.from(text));
}

function differingParts(example, captured) {
  const dir = join(expectedDir, example.id);
  const parts = Object.entries(streams(example, captured))
    .filter(([name, text]) => !matches(join(dir, name), text))
    .map(([name]) => name);
  const files = join(dir, 'files');
  const expectedNames = listFiles(files);
  if (
    expectedNames.length !== captured.produced.length ||
    captured.produced.some(
      ({ name, text }, index) => expectedNames[index] !== name || !matches(join(files, name), text),
    )
  ) {
    parts.push('files');
  }
  return parts;
}

function checkExpectedEntries(cases, full) {
  if (!existsSync(expectedDir)) {
    return;
  }
  const unexpected = [];
  if (full) {
    const ids = new Set(cases.map((example) => example.id));
    for (const name of readdirSync(expectedDir)) {
      if (name !== 'META.json' && !ids.has(name)) {
        unexpected.push(`expected/${name}: no case owns this entry`);
      }
    }
  }
  for (const example of cases) {
    const directory = join(expectedDir, example.id);
    const entries = existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : [];
    const names = new Set(['exit', 'stderr', 'stdout']);
    if (example.stdin !== undefined || example.session !== undefined) {
      names.add('stdin');
    }
    for (const entry of entries) {
      const allowed =
        entry.name === 'files' ? entry.isDirectory() : names.has(entry.name) && entry.isFile();
      if (!allowed) {
        unexpected.push(`expected/${example.id}/${entry.name}: unexpected entry`);
      }
    }
  }
  if (unexpected.length) {
    fail(unexpected.toSorted().join('\n'));
  }
}

function publishExpected(staged, backup) {
  const exists = existsSync(expectedDir);
  if (exists) {
    renameSync(expectedDir, backup);
  }
  try {
    renameSync(staged, expectedDir);
  } catch (error) {
    if (exists) {
      try {
        renameSync(backup, expectedDir);
      } catch {
        fail(`could not install the new expectations or restore the original tree at ${backup}`);
      }
    }
    throw error;
  }
  if (exists) {
    try {
      rmSync(backup, { recursive: true });
    } catch (error) {
      console.warn(
        `check-conformance: could not remove the previous expectations at ${backup}: ${error.message}`,
      );
    }
  }
}

async function main() {
  const {
    values: { only, update },
  } = parseArgs({
    options: { only: { type: 'string' }, update: { type: 'boolean' } },
  });
  if (only === '') {
    fail('--only needs a case id prefix');
  }
  const cases = loadCases().filter((example) => only === undefined || example.id.startsWith(only));
  // An update replaces each folder it writes whole, so only a check judges the entries already there.
  if (!update) {
    checkExpectedEntries(cases, only === undefined);
  }
  if (!cases.length) {
    fail('no case matches the selection');
  }
  for (const app of new Set(cases.map((example) => example.app))) {
    if (!existsSync(join(workspace, 'examples', app, 'dist', 'main.js'))) {
      fail(`the ${app} build is missing. Run pnpm run build, then pnpm run build:examples.`);
    }
  }

  const meta =
    update && only === undefined
      ? {
          cases: cases.length,
          node_version: process.version,
          platform: process.platform,
          reference_build: 'workspace dist',
          reference_had_uncommitted_changes: git('status', '--porcelain', '--', '.') !== '',
          reference_revision: git('rev-parse', 'HEAD'),
        }
      : undefined;
  const before = fixtureSnapshot();
  const forbidden = [
    ...new Set(
      [repo, workspace, process.env.HOME, process.execPath].flatMap((path) =>
        path ? [path, safeReal(path)] : [],
      ),
    ),
  ].filter((path) => path !== '/');
  const runDir = scratchRun();
  const staged = join(runDir, 'staged');
  const backup = join(runDir, 'previous');
  const sandboxes = join(runDir, 'sandboxes');
  try {
    if (update && only !== undefined && existsSync(expectedDir)) {
      cpSync(expectedDir, staged, { recursive: true });
    }
    const failures = [];
    for (const example of cases) {
      const captured = await runCase(example, sandboxes, before);
      assertClean(example, captured, forbidden);
      if (update) {
        writeExpected(example, captured, staged);
      } else {
        const parts = differingParts(example, captured);
        if (parts.length) {
          failures.push(`${example.id}: ${parts.join(', ')}`);
        }
      }
    }
    if (fixtureSnapshot() !== before) {
      fail('a case changed conformance/fixtures');
    }
    if (failures.length) {
      fail(`${failures.length} of ${cases.length} cases differ\n${failures.join('\n')}`);
    }
    if (update) {
      if (meta !== undefined) {
        writeFileSync(join(staged, 'META.json'), `${JSON.stringify(meta, null, 2)}\n`);
      }
      publishExpected(staged, backup);
    }
    console.log(`${update ? 'Updated' : 'Checked'} ${cases.length} conformance cases`);
  } finally {
    if (!existsSync(backup)) {
      try {
        rmSync(runDir, { force: true, recursive: true });
      } catch (error) {
        console.warn(`check-conformance: could not remove ${runDir}: ${error.message}`);
      }
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`check-conformance: ${error.message}`);
  process.exitCode = 1;
}
