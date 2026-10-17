import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Application, locate } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { answer } from '../src/completion/answer.js';
import { judgeCache } from '../src/self-update/cache.js';
import { selfUpdate } from '../src/self-update/plugin.js';

const fixture = new URL('fixtures/self-update-run.mjs', import.meta.url);

const asset = 'notes-linux-x64';
const binaryBytes = 'notes 1.5.0 binary\n';

/** The notice a run of notes 1.5.0 prints for a cache naming 1.5.1 on the stable channel. */
const notice =
  'notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.';

/**
 * The same notice as the info lane writes it on the 80-column terminal the fixture reports: wider
 * than the 78 columns right of the gutter, so it wraps, with the gutter on its continuation line.
 */
const noticeLines = [
  'notes 1.5.1 is available on the stable channel. Run notes self-update to',
  '  update from 1.5.0.',
];

/** How long a test waits for a child that should never start before it concludes none did. */
const quiet = 1500;

/** How long a test waits for a refresh child to end. */
const childDeadline = 10_000;

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function release(version: string): [string, { assets: Record<string, string>; sums: string }] {
  const bytes = `notes ${version} binary\n`;
  return [`v${version}`, { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` }];
}

interface GitHub {
  readonly repository: string;
  readonly latest: string | null;
  readonly feed: readonly string[];
  readonly releases: Record<string, { assets: Record<string, string>; sums: string | null }>;
}

const defaultGitHub: GitHub = {
  feed: ['v1.5.1', 'v1.5.0'],
  latest: 'v1.5.1',
  releases: Object.fromEntries([release('1.5.1'), release('1.5.0')]),
  repository: 'acme/notes',
};

/** A sandbox: the home, the cache and state directories, the binary, and the logs a run appends. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly cacheHome: string;
  readonly state: string;
  readonly binary: string;
  /** The application's cache directory, `$XDG_CACHE_HOME/notes`. */
  readonly cache: string;
  /** The cache file, `update.json` in the cache directory. */
  readonly file: string;
  readonly requests: string;
  readonly events: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755);
    const cache = join(root, 'cache', 'notes');
    if (existsSync(cache)) {
      chmodSync(cache, 0o755);
    }
    rmSync(root, { force: true, recursive: true });
  }
});

function sandbox(): Sandbox {
  // Resolved, so a child's working directory compares equal where the temporary folder is a link, as on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-update-notices-')));
  roots.push(root);
  const home = join(root, 'home');
  const cacheHome = join(root, 'cache');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  for (const directory of [home, cacheHome, bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, binaryBytes, { mode: 0o755 });
  // The record lets `self-update` itself pass its refusals, so leaving it out is the plugin's choice.
  writeFileSync(
    join(state, 'notes', 'installation', 'install.json'),
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(binaryBytes)}"}\n`,
  );
  const cache = join(cacheHome, 'notes');
  return {
    binary,
    cache,
    cacheHome,
    events: join(root, 'events.jsonl'),
    file: join(cache, 'update.json'),
    home,
    requests: join(root, 'requests.txt'),
    root,
    state,
  };
}

/** What a cache line holds, each member optional so a case can leave one at its default. */
interface CacheFacts {
  readonly checked?: string;
  readonly repository?: string;
  readonly channel?: string;
  readonly latest?: string | null;
}

const hour = 3_600_000;

/** A time `hours` before now, in the `toISOString()` form, or after now for a negative count. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * hour).toISOString();
}

/** The pinned cache line, its members in the contract's order. */
function cacheLine(written: CacheFacts = {}): string {
  const {
    checked = hoursAgo(1),
    repository = 'acme/notes',
    channel = 'stable',
    latest = '1.5.1',
  } = written;
  // The members keep the cache's order, which an object literal would not survive formatting in.
  return `{"format":1,"checked":${JSON.stringify(checked)},"repository":${JSON.stringify(repository)},"channel":${JSON.stringify(channel)},"latest":${JSON.stringify(latest)}}\n`;
}

/** Writes `update.json` with these bytes, creating the cache directory. */
function writeCache(box: Sandbox, content: string): void {
  mkdirSync(box.cache, { recursive: true });
  writeFileSync(box.file, content);
}

interface Scenario {
  readonly version?: string;
  readonly channel?: string;
  /** The release facts, replacing the default `distributed` ones whole. */
  readonly releaseFacts?: unknown;
  readonly github?: Partial<GitHub>;
  readonly rules?: Record<string, string | number>;
  readonly env?: Record<string, string>;
  readonly tty?: { readonly stdout: boolean; readonly stderr: boolean };
  readonly notices?: unknown;
  /** Where the help plugin sits beside `selfUpdate()`, when the application installs it. */
  readonly help?: 'before' | 'after';
  readonly restyle?: boolean;
  readonly hold?: boolean;
  /** Each run and refresh child records its process group and session. */
  readonly session?: boolean;
  /** `fixture` starts the fixture again with its scenario; `inert` starts a runtime that does nothing. */
  readonly program?: 'fixture' | 'inert' | readonly string[];
}

/** The release facts of a script-installed binary at `version`, on the channel it derives. */
function scriptFacts(box: Sandbox, version: string, channel: string) {
  return {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(binaryBytes)}`, method: 'script', path: box.binary },
    release: { asset, channel, repository: 'acme/notes', version },
  };
}

/** Runs `notes ...argv` at a terminal in the sandbox, the fixture its own refresh program. */
function run(box: Sandbox, argv: string[], scenario: Scenario = {}) {
  const file = join(box.root, 'scenario.json');
  const program =
    scenario.program === 'inert' ? [process.execPath, '-e', ''] : (scenario.program ?? 'fixture');
  writeFileSync(
    file,
    JSON.stringify({
      cache: box.cache,
      env: {
        CI: '',
        HOME: box.home,
        NO_COLOR: '1',
        NO_UPDATE_NOTIFIER: '',
        XDG_CACHE_HOME: box.cacheHome,
        XDG_STATE_HOME: box.state,
        ...scenario.env,
      },
      events: box.events,
      github: { ...defaultGitHub, ...scenario.github },
      help: scenario.help,
      hold: scenario.hold,
      ...('notices' in scenario ? { notices: scenario.notices } : {}),
      program,
      release:
        'releaseFacts' in scenario
          ? scenario.releaseFacts
          : scriptFacts(box, scenario.version ?? '1.5.0', scenario.channel ?? 'stable'),
      requests: box.requests,
      restyle: scenario.restyle,
      rules: scenario.rules,
      session: scenario.session,
      tty: scenario.tty ?? { stderr: true, stdout: true },
    }),
  );
  return invoke(fixture, [file, ...argv]);
}

/** One event the fixture recorded: a run's or a child's start, request, exit, or session. */
interface FixtureEvent {
  readonly event: 'start' | 'request' | 'exit' | 'session';
  readonly role: 'run' | 'child';
  readonly cache?: string | null;
  readonly cwd?: string;
  readonly code?: number;
  readonly url?: string;
  readonly group?: number;
  readonly session?: number;
}

function events(box: Sandbox): FixtureEvent[] {
  return existsSync(box.events)
    ? readFileSync(box.events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

function childEvents(box: Sandbox): FixtureEvent[] {
  return events(box).filter(({ role }) => role === 'child');
}

/** Waits until every refresh child that started has exited, failing past the deadline. */
async function childrenDone(box: Sandbox): Promise<FixtureEvent[]> {
  const deadline = Date.now() + childDeadline;
  while (Date.now() < deadline) {
    const found = childEvents(box);
    const started = found.filter(({ event }) => event === 'start').length;
    const exited = found.filter(({ event }) => event === 'exit').length;
    if (started > 0 && started === exited) {
      return found;
    }
    await sleep(25);
  }
  throw new Error(
    `No refresh child finished in ${childDeadline} ms: ${JSON.stringify(events(box))}`,
  );
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

/** The pinned line a refresh writes, matched with any `checked` between two times. */
function expectRefreshed(content: string | null | undefined, from: number, latest: string | null) {
  const parsed: unknown = JSON.parse(content ?? 'null');
  expect(parsed).toEqual({
    channel: 'stable',
    checked: expect.any(String),
    format: 1,
    latest,
    repository: 'acme/notes',
  });
  const checked = Date.parse(JSON.parse(content ?? '{}').checked);
  expect(content).toBe(cacheLine({ checked: new Date(checked).toISOString(), latest }));
  expect(checked).toBeGreaterThanOrEqual(from);
  expect(checked).toBeLessThanOrEqual(Date.now());
}

test('a fresh cache naming a newer release prints the notice after the Command line through lanes.info, and starts no child', async () => {
  const box = sandbox();
  const line = cacheLine();
  writeCache(box, line);
  const result = run(box, ['add']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`✔ Added note 12.\nℹ ${noticeLines.join('\n')}\n`);

  const restyled = sandbox();
  writeCache(restyled, line);
  const styled = run(restyled, ['add'], { restyle: true });
  // The override owns the lane, wrapping included, so its notice stays one line.
  expect(styled.stderr).toBe(`✔ Added note 12.\n[info] ${notice}\n`);

  await sleep(quiet);
  expect(childEvents(box)).toEqual([]);
  expect(readFileSync(box.file, 'utf8')).toBe(line);
});

test('a cache naming 1.10.0 prints the notice to a run of 1.9.0, by SemVer precedence', () => {
  const box = sandbox();
  writeCache(box, cacheLine({ latest: '1.10.0' }));
  const result = run(box, ['add'], { program: 'inert', version: '1.9.0' });
  expect(lines(result.stderr)).toEqual([
    'Added note 12.',
    'notes 1.10.0 is available on the stable channel. Run notes self-update to',
    '  update from 1.9.0.',
  ]);
});

test.each([
  ['the running version', cacheLine({ latest: '1.5.0' })],
  ['an older version', cacheLine({ latest: '1.4.2' })],
  ['null', cacheLine({ latest: null })],
  ['another channel', cacheLine({ channel: 'next', latest: '1.6.0-next.1' })],
  ['another repository', cacheLine({ repository: 'acme/other' })],
])('a cache naming %s prints no notice', (_label, line) => {
  const box = sandbox();
  writeCache(box, line);
  const result = run(box, ['add'], { program: 'inert' });
  expect(result.status).toBe(0);
  expect(lines(result.stderr)).toEqual(['Added note 12.']);
});

test('a fresh cache with an extra member and its members reordered reads the same', async () => {
  const box = sandbox();
  const line = `{"latest":"1.5.1","note":"kept","channel":"stable","repository":"acme/notes","checked":"${hoursAgo(1)}","format":1}\n`;
  writeCache(box, line);
  const result = run(box, ['add']);
  expect(lines(result.stderr)).toEqual(['Added note 12.', ...noticeLines]);
  await sleep(quiet);
  expect(childEvents(box)).toEqual([]);
  expect(readFileSync(box.file, 'utf8')).toBe(line);
});

test.each([
  ['whose format is 2', cacheLine().replace('"format":1', '"format":2'), []],
  ['whose checked is not a time', cacheLine({ checked: 'yesterday' }), noticeLines],
])('a cache %s is stale and starts a child', async (_label, line, expected) => {
  const box = sandbox();
  writeCache(box, line);
  const from = Date.now();
  const result = run(box, ['add']);
  expect(lines(result.stderr)).toEqual(['Added note 12.', ...expected]);
  const children = await childrenDone(box);
  expect(children.filter(({ event }) => event === 'start')).toHaveLength(1);
  expectRefreshed(readFileSync(box.file, 'utf8'), from, '1.5.1');
});

test('a cache that is a directory is stale, so it names no release', () => {
  const box = sandbox();
  mkdirSync(box.file, { recursive: true });
  const result = run(box, ['add'], { program: 'inert' });
  expect(result.status).toBe(0);
  expect(lines(result.stderr)).toEqual(['Added note 12.']);
});

test.each([
  ['missing', undefined],
  ['25 hours old', cacheLine({ checked: hoursAgo(25), latest: '1.5.0' })],
  ['an hour ahead', cacheLine({ checked: hoursAgo(-1), latest: '1.5.0' })],
  ['for another channel', cacheLine({ channel: 'next', latest: null })],
  ['holding {', '{'],
])(
  'a cache %s starts one child, which finds the run’s checked, waits for the run to exit, and writes the latest version',
  async (_label, line) => {
    const box = sandbox();
    if (line !== undefined) {
      writeCache(box, line);
    }
    const from = Date.now();
    const result = run(box, ['add'], { hold: true });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual(['Added note 12.']);

    const children = await childrenDone(box);
    const all = events(box);
    const runExit = all.find(({ event, role }) => event === 'exit' && role === 'run');
    // The run wrote `checked` before it started the child, and kept a latest only from a cache
    // Whose one fault is its `checked`.
    const kept = line?.includes('"latest":"1.5.0"') === true ? '1.5.0' : null;
    expectRefreshed(runExit?.cache, from, kept);
    const starts = children.filter(({ event }) => event === 'start');
    expect(starts).toEqual([
      { cache: runExit?.cache, cwd: box.cache, event: 'start', role: 'child' },
    ]);
    // The run exited before the child's first request was answered.
    const firstRequest = all.findIndex(
      ({ event, role }) => event === 'request' && role === 'child',
    );
    expect(runExit).toBeDefined();
    expect(firstRequest).toBeGreaterThan(all.findLastIndex(({ role }) => role === 'run'));
    expect(children.at(-1)).toMatchObject({ code: 0, event: 'exit' });
    expectRefreshed(readFileSync(box.file, 'utf8'), from, '1.5.1');
  },
);

test.each([
  ['25 hours old', hoursAgo(25)],
  ['an hour ahead', hoursAgo(-1)],
  ['not a time', 'not a time'],
])(
  'a cache naming 1.5.1 whose checked is %s prints the notice, starts a child, and keeps 1.5.1 as latest',
  async (_label, checked) => {
    const box = sandbox();
    writeCache(box, cacheLine({ checked }));
    const from = Date.now();
    const result = run(box, ['add'], { github: { latest: 'v1.5.0' }, hold: true });
    expect(lines(result.stderr)).toEqual(['Added note 12.', ...noticeLines]);
    await childrenDone(box);
    const runExit = events(box).find(({ event, role }) => event === 'exit' && role === 'run');
    expectRefreshed(runExit?.cache, from, '1.5.1');
    // The child then writes what GitHub answered.
    expectRefreshed(readFileSync(box.file, 'utf8'), from, '1.5.0');
  },
);

test('a cache directory whose parents are missing is created with them, by the run and by its child', async () => {
  const box = sandbox();
  const cacheHome = join(box.root, 'a', 'b');
  const cache = join(cacheHome, 'notes');
  const from = Date.now();
  const result = run(box, ['add'], { env: { XDG_CACHE_HOME: cacheHome } });
  expect(result).toEqual({ status: 0, stderr: '✔ Added note 12.\n', stdout: '' });
  const children = await childrenDone(box);
  const start = children.find(({ event }) => event === 'start');
  expect(start?.cwd).toBe(cache);
  // The run wrote `checked` before it started the child.
  expectRefreshed(start?.cache, from, null);
  expect(children.at(-1)).toMatchObject({ code: 0, event: 'exit' });
  expectRefreshed(readFileSync(join(cache, 'update.json'), 'utf8'), from, '1.5.1');
});

test.skipIf(process.platform !== 'linux')(
  'the refresh child leads its own session and process group, apart from the run',
  async () => {
    const box = sandbox();
    run(box, ['add'], { session: true });
    const children = await childrenDone(box);
    const sessions = events(box).filter(({ event }) => event === 'session');
    const runSession = sessions.find(({ role }) => role === 'run');
    const childSession = sessions.find(({ role }) => role === 'child');
    expect(runSession).toBeDefined();
    expect(childSession).toBeDefined();
    expect(childSession?.session).not.toBe(runSession?.session);
    expect(childSession?.group).not.toBe(runSession?.group);
    // A child that called setsid leads both: its session and its group are its own process.
    expect(childSession?.group).toBe(childSession?.session);
    expect(children.at(-1)).toMatchObject({ event: 'exit' });
  },
);

test('a 503 makes the child exit 1 and write nothing, so the run’s checked stays and a second run starts no child', async () => {
  const box = sandbox();
  const from = Date.now();
  const first = run(box, ['add'], { rules: { 'releases/latest': 503 } });
  // The child's own failure sentence never reaches the run's streams.
  expect(first).toEqual({ status: 0, stderr: '✔ Added note 12.\n', stdout: '' });
  const children = await childrenDone(box);
  expect(children.at(-1)).toMatchObject({ code: 1, event: 'exit' });
  const runExit = events(box).find(({ event, role }) => event === 'exit' && role === 'run');
  expect(readFileSync(box.file, 'utf8')).toBe(runExit?.cache);
  expectRefreshed(runExit?.cache, from, null);

  rmSync(box.events);
  const second = run(box, ['add']);
  expect(lines(second.stderr)).toEqual(['Added note 12.']);
  await sleep(quiet);
  expect(childEvents(box)).toEqual([]);
});

test('self-update --refresh-notice resolves stable through releases/latest, requests no asset, writes the pinned line, and prints nothing', () => {
  const box = sandbox();
  const from = Date.now();
  const result = run(box, ['self-update', '--refresh-notice'], {
    tty: { stderr: false, stdout: false },
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(readFileSync(box.requests, 'utf8')).toBe(
    'https://github.com/acme/notes/releases/latest\n',
  );
  expectRefreshed(readFileSync(box.file, 'utf8'), from, '1.5.1');
});

test('self-update --refresh-notice on next resolves through the feed past a tag whose SHA256SUMS answers 404', () => {
  const box = sandbox();
  const result = run(box, ['self-update', '--refresh-notice'], {
    channel: 'next',
    github: {
      feed: ['v1.7.0-next.1', 'v1.6.0-next.2', 'v1.5.1'],
      releases: Object.fromEntries([release('1.6.0-next.2'), release('1.5.1')]),
    },
    version: '1.6.0-next.1',
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
  const requested = readFileSync(box.requests, 'utf8').trim().split('\n');
  expect(requested.slice(0, 3)).toEqual([
    'https://github.com/acme/notes/releases.atom',
    'https://github.com/acme/notes/releases/download/v1.7.0-next.1/SHA256SUMS',
    'https://github.com/acme/notes/releases/download/v1.6.0-next.2/SHA256SUMS',
  ]);
  expect(requested.filter((url) => url.endsWith(asset))).toEqual([]);
  const written: unknown = JSON.parse(readFileSync(box.file, 'utf8'));
  expect(written).toMatchObject({ channel: 'next', latest: '1.6.0-next.2' });
});

test('self-update --refresh-notice writes null for a channel with no release', () => {
  const box = sandbox();
  const from = Date.now();
  const result = run(box, ['self-update', '--refresh-notice'], { github: { latest: null } });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
  expectRefreshed(readFileSync(box.file, 'utf8'), from, null);
});

test.each([[['1.4.0']], [['--channel', 'next']], [['--check']]])(
  'self-update --refresh-notice beside %j is a usage error',
  (argv) => {
    const box = sandbox();
    const result = run(box, ['self-update', '--refresh-notice', ...argv]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'Option "--refresh-notice" cannot be given with other inputs. Leave out the other inputs.',
    );
    expect(existsSync(box.requests)).toBe(false);
    expect(existsSync(box.cache)).toBe(false);
  },
);

test('self-update --refresh-notice refuses a run with no asset and a run whose cache directory does not resolve', () => {
  const box = sandbox();
  const unbuilt = run(box, ['self-update', '--refresh-notice'], {
    releaseFacts: {
      build: 'distributed',
      release: { channel: 'stable', repository: 'acme/notes', version: '1.5.0' },
    },
  });
  expect(unbuilt.status).toBe(1);
  expect(unbuilt.stderr).toBe(
    'notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.\n',
  );
  const homeless = run(box, ['self-update', '--refresh-notice'], {
    env: { HOME: 'home', XDG_CACHE_HOME: '' },
  });
  expect(homeless.status).toBe(1);
  expect(homeless.stderr).toBe(
    'notes cannot find its cache directory because HOME is not an absolute path. Set HOME to an absolute path.\n',
  );
  expect(existsSync(box.requests)).toBe(false);
  expect(existsSync(box.cache)).toBe(false);
});

test.skipIf(process.getuid?.() === 0)(
  'self-update --refresh-notice exits 1 with the write sentence when its cache directory cannot be written',
  () => {
    const box = sandbox();
    mkdirSync(box.cache);
    chmodSync(box.cache, 0o555);
    const result = run(box, ['self-update', '--refresh-notice'], {
      tty: { stderr: false, stdout: false },
    });
    expect(result).toEqual({
      status: 1,
      stderr: `notes could not write its update cache to ${box.cache}. Free space there or check its permissions, then run self-update --refresh-notice again.\n`,
      stdout: '',
    });
    expect(readdirSync(box.cache)).toEqual([]);
  },
);

test('--refresh-notice is listed by no help page', () => {
  const box = sandbox();
  const result = run(box, ['self-update', '--help'], {
    help: 'before',
    tty: { stderr: false, stdout: false },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('--check');
  expect(result.stdout).not.toContain('refresh');
});

test('--refresh-notice is offered by no completion', () => {
  const graph = new Application('notes', { plugins: [selfUpdate()] }).inspect();
  const offered = answer(graph, locate(graph, ['self-update', '--']));
  expect(offered).toContain('--check');
  expect(offered).not.toContain('refresh');
});

/** A run left out: its label, its words, and the scenario that leaves it out. */
const leftOut: [string, string[], (box: Sandbox) => Scenario][] = [
  ['an action that fails', ['fail'], () => ({})],
  ['a run cancelled during its action', ['cancel'], () => ({})],
  ['--help under the help plugin', ['--help'], () => ({ help: 'before' })],
  ['--help under a help plugin installed after it', ['--help'], () => ({ help: 'after' })],
  ['self-update itself', ['self-update', '--check'], () => ({})],
  ['stderr that is not a terminal', ['add'], () => ({ tty: { stderr: false, stdout: true } })],
  ['stdout that is not a terminal', ['add'], () => ({ tty: { stderr: true, stdout: false } })],
  ['CI=1', ['add'], () => ({ env: { CI: '1' } })],
  ['NO_UPDATE_NOTIFIER=1', ['add'], () => ({ env: { NO_UPDATE_NOTIFIER: '1' } })],
  [
    'the author’s env set to 1',
    ['add'],
    () => ({ env: { NOTES_NO_UPDATE_NOTICE: '1' }, notices: { env: 'NOTES_NO_UPDATE_NOTICE' } }),
  ],
  ['notices: false', ['add'], () => ({ notices: false })],
  ['a source build', ['add'], () => ({ releaseFacts: { build: 'source' } })],
  [
    'a release with no asset',
    ['add'],
    () => ({
      releaseFacts: {
        build: 'distributed',
        release: { channel: 'stable', repository: 'acme/notes', version: '1.5.0' },
      },
    }),
  ],
  [
    'a script installation whose release names no asset',
    ['add'],
    (box) => {
      const { build, installation } = scriptFacts(box, '1.5.0', 'stable');
      const group = { channel: 'stable', repository: 'acme/notes', version: '1.5.0' };
      return { releaseFacts: { build, installation, release: group } };
    },
  ],
  [
    'the method npm',
    ['add'],
    (box) => {
      const base = scriptFacts(box, '1.5.0', 'stable');
      return { releaseFacts: { ...base, installation: { ...base.installation, method: 'npm' } } };
    },
  ],
  [
    'no installation',
    ['add'],
    (box) => {
      const { build, release: group } = scriptFacts(box, '1.5.0', 'stable');
      return { releaseFacts: { build, release: group } };
    },
  ],
  [
    'a relative HOME with no XDG_CACHE_HOME',
    ['add'],
    () => ({ env: { HOME: 'home', XDG_CACHE_HOME: '' } }),
  ],
];

test('runs left out print no notice, write no cache, and start no child', async () => {
  // A stale cache naming 1.5.1 would print the notice and start a child, were the run not left out.
  const line = cacheLine({ checked: hoursAgo(25) });
  const boxes = new Map<string, Sandbox>();
  const observed: Record<string, { cache: string[][]; notice: boolean; children?: unknown }> = {};
  for (const [label, argv, scenario] of leftOut) {
    const box = sandbox();
    boxes.set(label, box);
    writeCache(box, line);
    const result = run(box, argv, scenario(box));
    observed[label] = {
      cache: readdirSync(box.cache).map((name) => [
        name,
        readFileSync(join(box.cache, name), 'utf8'),
      ]),
      notice: `${result.stdout}${result.stderr}`.includes('is available'),
    };
  }
  await sleep(quiet);
  for (const [label, box] of boxes) {
    const found = observed[label];
    if (found !== undefined) {
      found.children = childEvents(box);
    }
  }
  const expected = { cache: [['update.json', line]], children: [], notice: false };
  expect(observed).toEqual(Object.fromEntries(leftOut.map(([label]) => [label, expected])));
});

test('a run whose action returns once it is cancelled exits 130, prints no notice, writes no cache, and starts no child', async () => {
  const box = sandbox();
  const line = cacheLine({ checked: hoursAgo(25) });
  writeCache(box, line);
  const result = run(box, ['interrupt']);
  expect(result.status).toBe(130);
  expect(`${result.stdout}${result.stderr}`).not.toContain('is available');
  await sleep(quiet);
  expect(readdirSync(box.cache)).toEqual(['update.json']);
  expect(readFileSync(box.file, 'utf8')).toBe(line);
  expect(childEvents(box)).toEqual([]);
});

test('NO_UPDATE_NOTIFIER and the author’s env set to the empty string do not turn notices off', () => {
  const box = sandbox();
  writeCache(box, cacheLine());
  const result = run(box, ['add'], {
    env: { NOTES_NO_UPDATE_NOTICE: '', NO_UPDATE_NOTIFIER: '' },
    notices: { env: 'NOTES_NO_UPDATE_NOTICE' },
  });
  expect(lines(result.stderr)).toEqual(['Added note 12.', ...noticeLines]);
});

test.skipIf(process.getuid?.() === 0)(
  'a cache directory that cannot be written exits 0 with the Command line alone and starts no child',
  async () => {
    const box = sandbox();
    mkdirSync(box.cache);
    chmodSync(box.cache, 0o555);
    const result = run(box, ['add']);
    expect(result).toEqual({ status: 0, stderr: '✔ Added note 12.\n', stdout: '' });
    await sleep(quiet);
    expect(childEvents(box)).toEqual([]);
  },
);

test('a program naming a missing file exits 0 with the Command line alone', () => {
  const box = sandbox();
  const result = run(box, ['add'], { program: [join(box.root, 'missing-runtime')] });
  expect(result).toEqual({ status: 0, stderr: '✔ Added note 12.\n', stdout: '' });
  // The run still wrote `checked`, so the next run waits a day before it looks again.
  expect(JSON.parse(readFileSync(box.file, 'utf8'))).toMatchObject({ latest: null });
});

test('the cache is fresh from its checked time until 24 hours later, and stale outside that span', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  const lookup = { channel: 'stable', repository: 'acme/notes' };
  const at = (checked: string) => judgeCache(cacheLine({ checked }), lookup, now);
  expect(at('2026-10-14T12:00:00.000Z')).toMatchObject({ fresh: true, latest: '1.5.1' });
  expect(at('2026-10-13T12:00:00.001Z')).toMatchObject({ fresh: true, latest: '1.5.1' });
  expect(at('2026-10-13T12:00:00.000Z')).toMatchObject({ fresh: false, latest: '1.5.1' });
  expect(at('2026-10-14T12:00:00.001Z')).toMatchObject({ fresh: false, latest: '1.5.1' });
  // A time in another form is not a time the cache holds.
  expect(at('2026-10-14T11:00:00Z')).toMatchObject({ fresh: false, latest: '1.5.1' });
  expect(judgeCache(cacheLine({ latest: 'v1.5.1' }), lookup, now)).toEqual({
    fresh: false,
    latest: undefined,
  });
});
