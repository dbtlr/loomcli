/*
 * The shutdown where only a process can show it, under docs/core/signals.md and ADR-0106: a real
 * signal, a real terminal, a real shell, and the process's own exit status, under Node and Bun.
 *
 * - The terminal. On a pseudo-terminal, an action that enters raw mode and hides the cursor,
 *   restoring both through `onShutdown`, and then ignores its signal, is sent `kill -TERM` and, in
 *   a second run, `SIGHUP`. Each time the process dies by the signal (143, 129), the cursor shows,
 *   and the terminal settings read as they did before. A region's cancelled line reaches the
 *   terminal at a budget of 0.
 * - The status a shell sees. A cooperative run sent SIGHUP, SIGINT, SIGQUIT, or SIGTERM dies by it,
 *   and `sh` reports 129, 130, 131, or 143.
 * - The budget. An action that ignores its signal ends within its budget, not before it.
 * - signal-exit. Installed beside core, it still ends the process: with an action that ignores its
 *   signal and with one that honours it, both core's handler and signal-exit's run, and the process
 *   dies by the signal.
 * - Order. Handlers from the action, its middleware, and the process run once, newest first, after
 *   the run unwound, and core's listeners are held only while asked.
 * - The process's own end. `process.exit()` and an uncaught exception mid-action call the pending
 *   handler with `exit` and the status.
 * - Two copies of core listen once and call each handler once.
 * - Suspend and resume. SIGTSTP calls the suspend handlers newest first and stops the process, and
 *   the SIGCONT that follows calls the resume handlers in registration order.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { childEnvironment, invoke, start } from '../../../scripts/test-process.js';
import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';

const fixtureUrl = new URL('fixtures/shutdown.mjs', import.meta.url);

const fixture = fileURLToPath(fixtureUrl);

/** A folder for a second installed copy of core's built output, which loads as its own instance. */
const copies = mkdtempSync(join(tmpdir(), 'loom-core-copy-'));

afterAll(() => {
  rmSync(copies, { force: true, recursive: true });
});

/** The runtime a fixture runs on, by the name the shell finds it under. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

/**
 * Runs one scenario on a real terminal under `sh`, which then prints the status the scenario ended
 * with and whether the terminal's settings read as they did before it ran, so a test reads what
 * the operator's shell would meet.
 */
function onTerminal(scenario: string) {
  return drive([
    'sh',
    '-c',
    [
      'before=$(stty -g)',
      '"$0" "$1" "$2"',
      'echo "status=$?"',
      'if [ "$(stty -g)" = "$before" ]; then echo terminal=restored; else echo terminal=changed; fi',
      'echo @@DONE@@',
    ].join('; '),
    runtime,
    fixture,
    scenario,
  ]);
}

/** The process id a scenario announced with `ready:<pid>:`. */
function announcedPid(transcript: string): number {
  const pid = /ready:(?<pid>\d+):/u.exec(transcript)?.groups?.pid;
  if (pid === undefined) {
    throw new Error(`The scenario announced no process id:\n${transcript}`);
  }
  return Number(pid);
}

test.skipIf(zsh === undefined).each([
  { signal: 'SIGTERM', status: 143 },
  { signal: 'SIGHUP', status: 129 },
] as const)(
  'a $signal leaves the terminal cooked with the cursor shown, and the process dies by it',
  async ({ signal, status }) => {
    const terminal = onTerminal('raw-terminal');
    try {
      const ready = await terminal.expect('ready:*:');
      expect(ready).toContain('\u001B[?25l');
      process.kill(announcedPid(ready), signal);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('\u001B[?25h');
      expect(ended).toContain(`status=${status}`);
      expect(ended).toContain('terminal=restored');
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  "a region's cancelled line reaches the terminal at a budget of 0, and the cursor shows",
  async () => {
    const terminal = onTerminal('region');
    try {
      const ready = await terminal.expect('ready:*:');
      expect(ready).toContain('WORKING-FRAME');
      process.kill(announcedPid(ready), 'SIGTERM');
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('CANCELLED-LINE');
      expect(ended).toContain('\u001B[?25h');
      expect(ended).toContain('status=143');
    } finally {
      await terminal.close();
    }
  },
);

/**
 * Runs the cooperative scenario under `sh`, which prints the status it ended with, sends the
 * scenario `signal` once it announced its process id, and resolves everything `sh` printed. A core
 * dump is what SIGQUIT asks for, so the shell turns dumps off before the scenario starts.
 */
function underShell(signal: NodeJS.Signals): Promise<string> {
  const child = spawn(
    'sh',
    ['-c', 'ulimit -c 0; "$0" "$1" "$2"; echo "status=$?"', runtime, fixture, 'cooperative'],
    { env: childEnvironment({}), stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 },
  );
  let output = '';
  let sent = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
    const pid = /ready:(?<pid>\d+):/u.exec(output)?.groups?.pid;
    if (!sent && pid !== undefined) {
      sent = true;
      process.kill(Number(pid), signal);
    }
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => {
      resolve(output);
    });
  });
}

test.each([
  { signal: 'SIGHUP', status: 129 },
  { signal: 'SIGINT', status: 130 },
  { signal: 'SIGQUIT', status: 131 },
  { signal: 'SIGTERM', status: 143 },
] as const)(
  'a run $signal cancels dies by it, and a shell reports $status',
  async ({ signal, status }) => {
    const output = await underShell(signal);
    // SIGQUIT skips the budget, so the run never unwinds; every other signal lets it.
    const unwound =
      signal === 'SIGQUIT' ? [] : [`action:${signal}`, `resolved:${String(status)}:1,1,1,1,1`];
    expect(output.split('\n').slice(2)).toEqual([...unwound, `status=${String(status)}`, '']);
  },
);

test('an action that ignores its signal ends within its budget, and not before it', async () => {
  const running = start(fixtureUrl, ['ignoring'], { env: { LOOM_FIXTURE_TIMEOUT: '400' } });
  await running.announced(`ready:${String(running.child.pid)}:`);
  const sent = performance.now();
  running.child.kill('SIGTERM');
  const result = await running.exit;
  const elapsed = performance.now() - sent;
  expect({ signal: result.signal, stdout: result.stdout }).toEqual({
    signal: 'SIGTERM',
    stdout: `before:0,0,0,0,0\nready:${String(running.child.pid)}:\nhandler:SIGTERM:143\n`,
  });
  expect(elapsed).toBeGreaterThanOrEqual(350);
  expect(elapsed).toBeLessThan(3000);
});

test.each([
  { honours: 'no', unwound: [] },
  { honours: 'yes', unwound: ['action:SIGTERM', 'resolved:143:2,2,2,2,1'] },
])(
  'signal-exit beside core still ends the process (the action honours its signal: $honours)',
  async ({ honours, unwound }) => {
    const running = start(fixtureUrl, ['signal-exit'], {
      env: { LOOM_FIXTURE_HONOURS: honours, LOOM_FIXTURE_TIMEOUT: '200' },
    });
    const ready = `ready:${String(running.child.pid)}:`;
    await running.announced(ready);
    running.child.kill('SIGTERM');
    const result = await running.exit;
    // Core's handler runs at the shutdown's end, and signal-exit's when core's re-raise finds it alone.
    expect({ signal: result.signal, stdout: result.stdout }).toEqual({
      signal: 'SIGTERM',
      stdout: [
        'before:0,0,0,0,0',
        ready,
        ...unwound,
        'handler:SIGTERM:143',
        'signal-exit:null:SIGTERM',
        '',
      ].join('\n'),
    });
  },
);

test('handlers from the process, the middleware, and the action run once, newest first, after the unwind', async () => {
  const running = start(fixtureUrl, ['order']);
  await running.announced(`ready:${String(running.child.pid)}:`);
  running.child.kill('SIGINT');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGINT',
    status: null,
    stderr: '',
    stdout: [
      'before:0,0,0,0,0',
      `ready:${String(running.child.pid)}:`,
      'unwound:SIGINT',
      'resolved:130:1,1,1,1,1',
      'second:SIGINT:130',
      'first:SIGINT:130',
      'middleware:SIGINT:130',
      '',
    ].join('\n'),
  });
});

test('a run that asks nothing holds no listener before or after, and one for each event during', () => {
  expect(invoke(fixtureUrl, ['listening'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before:0,0,0,0,0\nduring:1,1,1,1,1\nresolved:0:0,0,0,0,0\n',
  });
});

test('a process-scoped handler keeps core listening with no run, and a removed one is not called', async () => {
  const running = start(fixtureUrl, ['process-scoped']);
  await running.announced('ready:1,1,1,1,1');
  running.child.kill('SIGHUP');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGHUP',
    status: null,
    stderr: '',
    stdout: 'before:0,0,0,0,0\nready:1,1,1,1,1\nkept:SIGHUP:129\n',
  });
});

test('process.exit() mid-action calls the pending handler with exit and the status', () => {
  expect(invoke(fixtureUrl, ['exit'])).toEqual({
    status: 3,
    stderr: '',
    stdout: 'before:0,0,0,0,0\nhandler:exit:3\n',
  });
});

test('an uncaught exception mid-action calls the pending handler with exit and the status', () => {
  const result = invoke(fixtureUrl, ['uncaught']);
  expect({ status: result.status, stdout: result.stdout }).toEqual({
    status: 1,
    stdout: 'before:0,0,0,0,0\nhandler:exit:1\n',
  });
  expect(result.stderr).toContain('the timer broke');
});

test('two copies of core share one lane, listen once, and call each handler once', async () => {
  const copy = join(copies, 'dist');
  cpSync(fileURLToPath(new URL('../dist', import.meta.url)), copy, { recursive: true });
  const running = start(fixtureUrl, ['two-copies'], { env: { LOOM_CORE_COPY: copy } });
  await running.announced('ready:1,1,1,1,1');
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGTERM',
    status: null,
    stderr: '',
    stdout: 'ready:1,1,1,1,1\ncopy:SIGTERM:143\noriginal:SIGTERM:143\n',
  });
});

test.skipIf(zsh === undefined)(
  'an app that leads its own terminal session runs its suspend and resume handlers at each Ctrl-Z and keeps running',
  async () => {
    // `exec` makes the runtime the session's leader, so its process group is orphaned.
    const terminal = drive(['sh', '-c', 'exec "$0" "$1" "$2"', runtime, fixture, 'suspend-leader']);
    try {
      await terminal.expect('ready');
      // A second Ctrl-Z calls the handlers again, because core listens for SIGTSTP once more.
      const rounds: string[][] = [];
      for (const press of ['first', 'second']) {
        terminal.send(String.raw`\x1a`);
        const pressed = await terminal.expect('resumed:second');
        rounds.push([press, ...(pressed.match(/(?:suspended|resumed):\w+/gu) ?? [])]);
      }
      const order = ['suspended:second', 'suspended:first', 'resumed:first', 'resumed:second'];
      expect(rounds).toEqual([
        ['first', ...order],
        ['second', ...order],
      ]);
      // The run is still live, so Ctrl-C starts its shutdown and the run unwinds.
      terminal.send(String.raw`\x03`);
      await expect(terminal.expect('action:SIGINT')).resolves.toContain('action:SIGINT');
    } finally {
      await terminal.close();
    }
  },
);

/** The process state `ps` reports for one process: `T` when it is stopped. */
function processState(pid: number): string {
  return spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
}

test('SIGTSTP calls suspend handlers newest first and stops; SIGCONT resumes them oldest first', async () => {
  const running = start(fixtureUrl, ['suspend']);
  await running.announced('ready:1,2:0,0,0,0,0');
  const { pid } = running.child;
  if (pid === undefined) {
    throw new Error('The fixture has no process id.');
  }
  // A SIGCONT with no suspend before it calls none.
  running.child.kill('SIGCONT');
  await running.announced('continued');
  running.child.kill('SIGTSTP');
  await running.announced('suspended:first');
  while (!processState(pid).startsWith('T')) {
    await delay(10);
  }
  running.child.kill('SIGCONT');
  await running.announced('resumed:second');
  // Nothing asks core to listen for an ending signal, so SIGTERM has its default effect.
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGTERM',
    status: null,
    stderr: '',
    stdout: [
      'before:0,0',
      'ready:1,2:0,0,0,0,0',
      'continued',
      'suspended:second',
      'suspended:first',
      'resumed:first',
      'resumed:second',
      'continued',
      '',
    ].join('\n'),
  });
});
