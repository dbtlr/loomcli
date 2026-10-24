/*
 * The shutdown where only a process can show it, under docs/core/signals.md and ADR-0106: a real
 * signal, a real terminal, a real shell, and the process's own exit status, under Node and Bun.
 *
 * - The terminal. On a pseudo-terminal, an action that enters raw mode and hides the cursor,
 *   restoring both through `onShutdown`, and then ignores its signal, is sent `kill -TERM` and, in
 *   a second run, `SIGHUP`. Each time the process dies by the signal (143, 129), the cursor shows,
 *   and every terminal flag raw mode turns off reads as it did before the run. A region's cancelled line reaches the
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

import { invoke, start } from '../../../scripts/test-process.js';
import { zsh } from '../../../scripts/test-pty.js';
import { sealedShellEnvironment } from '../../../scripts/test-shell.js';
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
 * The shell command that prints the terminal modes raw mode turns off, each as `stty -a` names it
 * with a leading `-` when it is off, in one sorted line. Raw mode is a change to exactly these, so a
 * test compares them rather than the whole of `stty -g`, which on macOS also carries `pendin`, a
 * flag the kernel sets on its own whenever a program turns canonical mode back on.
 */
const ttyModes = String.raw`stty -a | tr -s ' ;' '\n\n' | grep -E '^-?(icanon|echo|isig|iexten|icrnl|ixon|opost)$' | LC_ALL=C sort | tr '\n' ' '`;

/**
 * Runs one scenario on a real terminal under `sh`, which then prints the status the scenario ended
 * with and the raw-mode flags before and after it ran, so a test reads what the operator's shell
 * would meet. The scenario prints the same flags while it holds raw mode.
 */
function onTerminal(scenario: string) {
  return drive(
    [
      'sh',
      '-c',
      [
        `before=$(${ttyModes})`,
        '"$0" "$1" "$2"',
        'echo "status=$?"',
        `echo "modes-before=$before"`,
        `echo "modes-after=$(${ttyModes})"`,
        'echo @@DONE@@',
      ].join('; '),
      runtime,
      fixture,
      scenario,
    ],
    { LOOM_FIXTURE_TTY_MODES: ttyModes },
  );
}

/** The raw-mode flags one line of a transcript names after `label=`. */
function modesOf(transcript: string, label: string): string {
  const modes = new RegExp(`${label}=(?<modes>[^\\r\\n]*)`, 'u').exec(transcript)?.groups?.modes;
  if (modes === undefined) {
    throw new Error(`The transcript names no ${label}:\n${transcript}`);
  }
  return modes.trim();
}

/**
 * The flags of a cooked terminal apart from `echo`, and the flags of the raw mode Node and Bun set,
 * which keeps output processing on.
 */
const cooked = ['icanon', 'icrnl', 'iexten', 'isig', 'ixon', 'opost'];
const raw = '-echo -icanon -icrnl -iexten -isig -ixon opost';

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
      // The action holds raw mode: every flag raw mode turns off is off.
      expect(modesOf(ready, 'modes-during')).toBe(raw);
      process.kill(announcedPid(ready), signal);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('\u001B[?25h');
      expect(ended).toContain(`status=${status}`);
      // The handler left raw mode: the shell reads every flag as it was before the run, which was
      // Cooked. The driver's terminal starts with its echo off, so `echo` is compared, not required.
      const before = modesOf(ended, 'modes-before');
      expect(before.split(' ').filter((flag) => !flag.endsWith('echo'))).toEqual(cooked);
      expect(modesOf(ended, 'modes-after')).toBe(before);
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

test.skipIf(zsh === undefined)(
  'an entry that calls process.exit with the code a shutdown resolved still shows the cursor after the cancelled line',
  async () => {
    const terminal = onTerminal('region-exit');
    try {
      const ready = await terminal.expect('ready:*:');
      expect(ready).toContain('WORKING-FRAME');
      process.kill(announcedPid(ready), 'SIGTERM');
      const ended = await terminal.expect('@@DONE@@');
      const cancelledAt = ended.indexOf('CANCELLED-LINE');
      expect(cancelledAt).toBeGreaterThan(-1);
      expect(ended.indexOf('\u001B[?25h', cancelledAt)).toBeGreaterThan(cancelledAt);
      // The process ended through process.exit with the run's code, before the shutdown's end.
      expect(ended).toContain('status=143');
    } finally {
      await terminal.close();
    }
  },
);

/**
 * The shell script that runs the scenario with no core dump and prints the status it ended with.
 * A core dump is what SIGQUIT asks for, and a Bun process's dump spans gigabytes of reserved
 * address space. `ulimit -c 0` stops a dump to a file, but where the kernel pipes dumps to a
 * collector, as systemd-coredump and apport are installed on Linux CI runners, it streams the whole
 * dump whatever the limit, except a limit of exactly one byte, which only `prlimit` can set. Where
 * there is no `prlimit`, as on macOS, `ulimit -c 0` is enough.
 */
const noCoreDump = [
  // The shell's `ulimit` sets the hard limit too, which no later call may raise, so it comes second.
  'if command -v prlimit >/dev/null 2>&1; then prlimit --core=1 "$0" "$1" "$2"',
  'else ulimit -c 0; "$0" "$1" "$2"; fi',
  'echo "status=$?"',
].join('; ');

/**
 * Runs the cooperative scenario under `sh`, which prints the status it ended with, sends the
 * scenario `signal` once it announced its process id, and resolves everything `sh` printed. The
 * shell starts under a sealed home of the test's own, so nothing it runs reaches the real home.
 */
function underShell(signal: NodeJS.Signals): Promise<string> {
  const child = spawn('sh', ['-c', noCoreDump, runtime, fixture, 'cooperative'], {
    env: sealedShellEnvironment(join(copies, 'home')),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
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
  // A bounded wait, so a fixture that never stops, or a missing `ps`, fails here and says so.
  const stoppedBy = Date.now() + 5000;
  while (!processState(pid).startsWith('T')) {
    if (Date.now() > stoppedBy) {
      throw new Error(`The fixture never stopped on SIGTSTP; ps reported "${processState(pid)}".`);
    }
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
