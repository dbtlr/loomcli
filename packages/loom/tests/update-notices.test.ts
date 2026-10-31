// @module-tag docs

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { applicationDirectory } from '@loomcli/core';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';

import { recordInstallation } from '../../../scripts/test-installation.js';
import { removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, loom } from './package.js';

/** How long compiling the probe may take. */
const slow = 300_000;

/** How long the test waits for the refresh child to end. */
const childDeadline = 10_000;

/** An application that installs `selfUpdate()` and declares a Command that prints one line. */
const application = `import { Application, Command } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';

export const probe = new Application('probe', {
  description: 'Probe update notices.',
  plugins: [selfUpdate()],
}).command(
  new Command('add', { description: 'Add a note.' }).action(({ out }) => out.success('Added note 12.')),
);
`;

/**
 * The entry: a run at a terminal whose \`program\` is the one core reads, with a fake GitHub whose
 * \`releases/latest\` names v1.0.1. It records to PROBE_EVENTS when a refresh child starts, each
 * request, and when each process exits, with what the cache held then. A child's requests wait
 * until the run that started it, PROBE_RUN_PID, has exited.
 */
const entry = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { processHandle } from '@loomcli/core';

import { probe } from './application.js';

const child = process.argv.includes('--refresh-notice');
const events = process.env.PROBE_EVENTS ?? '';

function record(event: string, details: Record<string, unknown> = {}): void {
  appendFileSync(events, \`\${JSON.stringify({ event, role: child ? 'child' : 'run', ...details })}\\n\`);
}

function cacheIn(directory: string): string | null {
  try {
    return readFileSync(join(directory, 'update.json'), 'utf8');
  } catch {
    return null;
  }
}

if (child) {
  record('start', { cache: cacheIn(process.cwd()), execPath: process.execPath });
}
process.on('exit', (code) => record('exit', { cache: cacheIn(process.env.PROBE_CACHE ?? ''), code }));

globalThis.fetch = async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  while (process.ppid === Number(process.env.PROBE_RUN_PID)) {
    await sleep(10);
  }
  record('request', { url });
  if (url === 'https://github.com/acme/probe/releases/latest') {
    const location = 'https://github.com/acme/probe/releases/tag/v1.0.1';
    return new Response(null, { headers: { location }, status: 302 });
  }
  return new Response('Not Found', { status: 404 });
};

const tty = { columns: 80, isTTY: true, rows: 24 };
const env = child ? process.env : { ...process.env, PROBE_RUN_PID: String(process.pid) };
await probe.run({
  process: processHandle({ env, terminal: { stderr: tty, stdin: { isTTY: false }, stdout: tty } }),
});
`;

/** The compiled probe, built once for the file. */
let binary = '';

beforeAll(async () => {
  const root = fixturePackage(
    {
      'package.json': `${JSON.stringify({
        bin: { probe: 'dist/main.js' },
        name: '@acme/probe',
        repository: 'git+https://github.com/acme/probe.git',
        type: 'module',
        version: '1.0.0',
      })}\n`,
      'src/application.ts': application,
      'src/main.ts': entry,
    },
    ['core', 'plugins'],
  );
  const result = await loom(root, ['build', '--release', '--out', 'bin/probe']);
  if (result.status !== 0) {
    throw new Error(`loom build --release failed:\n${result.stderr}`);
  }
  binary = join(root, 'bin/probe');
}, slow);

afterAll(() => {
  removeRoots();
});

interface ProbeEvent {
  readonly event: 'start' | 'request' | 'exit';
  readonly role: 'run' | 'child';
  readonly cache?: string | null;
  readonly code?: number;
  readonly execPath?: string;
}

function events(file: string): ProbeEvent[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

/** Waits until the refresh child has exited, failing past the deadline. */
async function childExited(file: string): Promise<ProbeEvent[]> {
  const deadline = Date.now() + childDeadline;
  while (Date.now() < deadline) {
    const found = events(file);
    if (found.some(({ event, role }) => event === 'exit' && role === 'child')) {
      return found;
    }
    await sleep(25);
  }
  throw new Error(`The refresh child did not finish: ${JSON.stringify(events(file))}`);
}

/** The pinned cache line for acme/probe on stable, matched with any `checked` at or after `from`. */
function expectCacheLine(content: string | null | undefined, from: number, latest: string | null) {
  const { checked } = JSON.parse(content ?? '{}');
  expect(content).toBe(
    `{"format":1,"checked":"${checked}","repository":"acme/probe","channel":"stable","latest":${JSON.stringify(latest)}}\n`,
  );
  expect(new Date(Date.parse(checked)).toISOString()).toBe(checked);
  expect(Date.parse(checked)).toBeGreaterThanOrEqual(from);
}

test(
  'a compiled binary built with --release starts its refresh child from its own path alone',
  async () => {
    const root = temporaryRoot('loom-update-notices-');
    const home = join(root, 'home');
    const state = join(root, 'state');
    const cacheHome = join(root, 'cache');
    for (const directory of [home, state, cacheHome]) {
      mkdirSync(directory);
    }
    const file = join(root, 'events.jsonl');
    const env = {
      CI: '',
      HOME: home,
      NO_COLOR: '1',
      NO_UPDATE_NOTIFIER: '',
      PATH: process.env.PATH,
      PROBE_CACHE: '',
      PROBE_EVENTS: file,
      XDG_CACHE_HOME: cacheHome,
      XDG_STATE_HOME: state,
    };
    // The binary runs on this platform, so its cache is where applicationDirectory puts it here.
    const lookup = applicationDirectory('cache', 'probe', {
      env,
      home: env.HOME,
      platform: process.platform,
    });
    if (!('path' in lookup)) {
      throw new Error(`The cache directory needs ${lookup.variable}.`);
    }
    const cache = lookup.path;
    env.PROBE_CACHE = cache;
    expect(recordInstallation('probe', binary, env)).toMatchObject({ status: 0 });

    const from = Date.now();
    const result = execute(binary, ['add'], { env });
    expect(result).toEqual({ status: 0, stderr: '✔ Added note 12.\n', stdout: '' });

    const all = await childExited(file);
    const runExit = all.find(({ event, role }) => event === 'exit' && role === 'run');
    expectCacheLine(runExit?.cache, from, null);
    // The child is the binary itself, started in the cache directory, and finds the run's checked.
    expect(all.filter(({ event, role }) => event === 'start' && role === 'child')).toEqual([
      { cache: runExit?.cache, event: 'start', execPath: binary, role: 'child' },
    ]);
    const firstRequest = all.findIndex(
      ({ event, role }) => event === 'request' && role === 'child',
    );
    expect(firstRequest).toBeGreaterThan(all.findLastIndex(({ role }) => role === 'run'));
    expect(all.at(-1)).toMatchObject({ code: 0, event: 'exit', role: 'child' });
    expectCacheLine(readFileSync(join(cache, 'update.json'), 'utf8'), from, '1.0.1');
  },
  slow,
);
