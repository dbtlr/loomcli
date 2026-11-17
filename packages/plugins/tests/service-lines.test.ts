/*
 * The -v lines and the change events of the service plugin, under "At -v and in the log" in
 * docs/plugins/service.md and ADR-0165. Each case runs notes with the verbose and service plugins
 * and an `onLog` observer on mockProcess, whose `systemctl`, `loginctl`, and `launchctl` scripts
 * answer by their words, with its home and XDG directories in a fresh sandbox under the temporary
 * directory, which it removes after.
 *
 * - The default verbosity gains no line. At -v each manager call that started writes `Ran` with its
 *   words once it ends, whatever its code, the reads `status` makes included, and each change event
 *   shows as well; -vv adds nothing.
 * - Each call that changes a unit records `Program run.` with the code the plugin accepted, and the
 *   unit file and the plugin's record file record `File written.` and `File removed.`. A read
 *   records nothing, and no event carries the environment.
 * - A program that cannot start writes no line and records no event.
 * - A call that runs while the run is cancelled writes no line.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import { verbose } from '@loomcli/plugins/verbose';
import type { Program, ProgramAnswer } from '@loomcli/testing';
import { afterEach, describe, expect, it, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const uid = 501;
const label = 'com.acme.notes';
const unitName = `${label}.service`;
const target = `gui/${uid}/${label}`;
const identity = '@loomcli/plugins/service';

/** A value the environment holds that no event may carry. */
const secret = 'sk-live-0123456789';

/** A sandbox: the home and the XDG config and state homes. */
interface Sandbox {
  readonly home: string;
  readonly config: string;
  readonly state: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-service-lines-'));
  roots.push(root);
  const box = {
    config: join(root, 'config'),
    home: join(root, 'home'),
    state: join(root, 'state'),
  };
  mkdirSync(box.home);
  return box;
}

/** What each manager answers, by its joined words; any other call exits 0. */
type Answers = Readonly<Record<string, ProgramAnswer>>;

interface Scenario {
  readonly platform?: 'linux' | 'darwin';
  readonly answers?: Answers;
  /** The managers that cannot start. */
  readonly missing?: readonly string[];
  /** The joined words of a call that cancels the run while it runs, then exits 0. */
  readonly cancelOn?: string;
}

/** Runs `notes ...argv` in the sandbox and answers its status, stderr, events, and calls. */
async function run(box: Sandbox, argv: readonly string[], scenario: Scenario = {}) {
  const events: LogEvent[] = [];
  const calls: string[] = [];
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      events.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [observer, verbose(), service({ label, run: ['serve'] })],
  }).command(new Command('serve').action(() => {}));
  const programs: Record<string, Program> = {};
  const controller = new AbortController();
  for (const name of ['systemctl', 'loginctl', 'launchctl']) {
    if (scenario.missing?.includes(name) !== true) {
      programs[name] = (call) => {
        const words = [name, ...call.args].join(' ');
        calls.push(words);
        if (words === scenario.cancelOn) {
          controller.abort(new Error('The test cancelled the run.'));
        }
        return scenario.answers?.[words] ?? {};
      };
    }
  }
  const result = await runOnMock(
    app,
    {
      argv,
      env: {
        API_TOKEN: secret,
        HOME: box.home,
        XDG_CONFIG_HOME: box.config,
        XDG_RUNTIME_DIR: '/run/user/501',
        XDG_STATE_HOME: box.state,
      },
      home: box.home,
      platform: scenario.platform ?? 'linux',
      program: ['/opt/notes/bin/notes'],
      programs,
      release: { build: 'distributed' },
      uid,
    },
    { signal: controller.signal },
  );
  return { calls, events, status: result.status, stderr: result.stderr };
}

/** The `Ran` log lines, their glyph removed. */
function ran(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('› Ran '))
    .map((line) => line.slice('› '.length));
}

/** One `Program run.` event of the service plugin. */
function programRun(program: string, words: readonly string[], code = 0) {
  return {
    fields: { arguments: words, code, program },
    level: 'info',
    message: 'Program run.',
    plugin: identity,
  };
}

/** One file event of the service plugin. */
function fileEvent(message: 'File written.' | 'File removed.', path: string) {
  return { fields: { path }, level: 'info', message, plugin: identity };
}

/** The change events, which are info, as the assertions read them. */
function changes(events: readonly LogEvent[]) {
  return events
    .filter(({ level }) => level === 'info')
    .map(({ fields, level, message, plugin: from }) => ({
      fields,
      level,
      message,
      plugin: from,
    }));
}

/** The systemd unit's path in the sandbox. */
function unit(box: Sandbox): string {
  return join(box.config, 'systemd', 'user', unitName);
}

/** The plugin's record file on Linux. */
function record(box: Sandbox): string {
  return join(box.state, 'notes', 'installation', 'service.json');
}

/** The launchd plist's path in the sandbox. */
function plist(box: Sandbox): string {
  return join(box.home, 'Library', 'LaunchAgents', `${label}.plist`);
}

/** The plugin's record file on macOS. */
function darwinRecord(box: Sandbox): string {
  return join(box.home, 'Library', 'Application Support', 'notes', 'installation', 'service.json');
}

describe('systemd', () => {
  it('install names each call at -v, adds nothing at the default level or at -vv', async () => {
    const box = sandbox();
    const quiet = await run(box, ['service', 'install']);
    expect(quiet.status).toBe(0);
    expect(ran(quiet.stderr)).toEqual([]);
    rmSync(box.config, { force: true, recursive: true });
    rmSync(box.state, { force: true, recursive: true });
    const verbosely = await run(box, ['-v', 'service', 'install']);
    const reload = '["--user","daemon-reload"]';
    expect(verbosely.stderr).toBe(
      [
        `› File written. path=${record(box)}`,
        `› File written. path=${unit(box)}`,
        `› File written. path=${record(box)}`,
        `ℹ Wrote ${unit(box)}.`,
        `› Program run. arguments=${reload} code=0 program=systemctl`,
        `› Program run. arguments=["--user","enable","${unitName}"] code=0 program=systemctl`,
        `› Program run. arguments=["--user","restart","${unitName}"] code=0 program=systemctl`,
        `✔ Started ${label}.`,
        '',
      ].join('\n'),
    );
    const again = await run(box, ['-vv', 'service', 'install']);
    expect(ran(again.stderr)).toEqual([]);
    expect(again.stderr).not.toContain('┆');
  });

  it('install records the unit, the record file, and each call that changes the unit', async () => {
    const box = sandbox();
    const { events } = await run(box, ['service', 'install']);
    expect(changes(events)).toEqual([
      fileEvent('File written.', record(box)),
      fileEvent('File written.', unit(box)),
      fileEvent('File written.', record(box)),
      programRun('systemctl', ['--user', 'daemon-reload']),
      programRun('systemctl', ['--user', 'enable', unitName]),
      programRun('systemctl', ['--user', 'restart', unitName]),
    ]);
  });

  it('uninstall records the accepted code of a stop for a unit that is not loaded', async () => {
    const box = sandbox();
    await run(box, ['service', 'install']);
    const removed = await run(box, ['-v', 'service', 'uninstall'], {
      answers: { [`systemctl --user stop ${unitName}`]: { code: 5 } },
    });
    expect(removed.status).toBe(0);
    expect(ran(removed.stderr)).toEqual([]);
    expect(changes(removed.events)).toEqual([
      programRun('systemctl', ['--user', 'stop', unitName], 5),
      programRun('systemctl', ['--user', 'disable', unitName]),
      fileEvent('File removed.', unit(box)),
      fileEvent('File removed.', record(box)),
      programRun('systemctl', ['--user', 'daemon-reload']),
    ]);
  });

  it('a control call is named and recorded, and status names its reads and records none', async () => {
    const box = sandbox();
    await run(box, ['service', 'install']);
    const stopped = await run(box, ['-v', 'service', 'stop']);
    expect(ran(stopped.stderr)).toEqual([]);
    expect(changes(stopped.events)).toEqual([
      programRun('systemctl', ['--user', 'stop', unitName]),
    ]);
    const status = await run(box, ['-v', 'service', 'status'], {
      answers: {
        [`systemctl --user show ${unitName} --property=ActiveState,MainPID`]: { code: 1 },
      },
    });
    expect(status.status).toBe(0);
    expect(ran(status.stderr)).toEqual([
      `Ran systemctl --user show ${unitName} --property=ActiveState,MainPID.`,
      `Ran loginctl show-user ${String(uid)} --property=Linger.`,
    ]);
    expect(changes(status.events)).toEqual([]);
  });

  it('a call that runs while the run is cancelled writes no Ran line', async () => {
    const box = sandbox();
    const reload = 'systemctl --user daemon-reload';
    const installed = await run(box, ['-v', 'service', 'install'], { cancelOn: reload });
    expect(installed.calls).toEqual([reload]);
    expect(ran(installed.stderr)).toEqual([]);
    const show = `systemctl --user show ${unitName} --property=ActiveState,MainPID`;
    const status = await run(box, ['-v', 'service', 'status'], { cancelOn: show });
    expect(status.calls).toEqual([show]);
    expect(ran(status.stderr)).toEqual([]);
  });

  it('a call that exits with a code the plugin refuses is named and records nothing', async () => {
    const box = sandbox();
    await run(box, ['service', 'install']);
    const failed = await run(box, ['-v', 'service', 'restart'], {
      answers: { [`systemctl --user restart ${unitName}`]: { code: 1 } },
    });
    expect(failed.status).toBe(1);
    expect(ran(failed.stderr)).toEqual([`Ran systemctl --user restart ${unitName}.`]);
    expect(failed.events.filter(({ message }) => message === 'Program run.')).toEqual([]);
  });

  it('a manager that cannot start writes no line and records no event', async () => {
    const box = sandbox();
    await run(box, ['service', 'install']);
    const missing = await run(box, ['-v', 'service', 'start'], { missing: ['systemctl'] });
    expect(missing.status).toBe(1);
    expect(missing.stderr).not.toContain('› ');
    expect(missing.events.filter(({ level }) => level === 'info')).toEqual([]);
  });
});

describe('launchd', () => {
  const notLoaded: Answers = { [`launchctl print ${target}`]: { code: 113 } };

  it('install names every launchctl call, the unload wait included', async () => {
    const box = sandbox();
    const installed = await run(box, ['-v', 'service', 'install'], {
      answers: { ...notLoaded, [`launchctl bootout ${target}`]: { code: 113 } },
      platform: 'darwin',
    });
    expect(installed.status).toBe(0);
    expect(ran(installed.stderr)).toEqual([`Ran launchctl print ${target}.`]);
    expect(changes(installed.events)).toEqual([
      fileEvent('File written.', darwinRecord(box)),
      fileEvent('File written.', plist(box)),
      fileEvent('File written.', darwinRecord(box)),
      programRun('launchctl', ['enable', target]),
      programRun('launchctl', ['bootout', target], 113),
      programRun('launchctl', ['bootstrap', `gui/${String(uid)}`, plist(box)]),
    ]);
  });

  it('restart names the print it reads and records only the kickstart', async () => {
    const box = sandbox();
    await run(box, ['service', 'install'], { answers: notLoaded, platform: 'darwin' });
    const restarted = await run(box, ['-v', 'service', 'restart'], { platform: 'darwin' });
    expect(ran(restarted.stderr)).toEqual([`Ran launchctl print ${target}.`]);
    expect(changes(restarted.events)).toEqual([
      programRun('launchctl', ['kickstart', '-k', target]),
    ]);
  });
});

test('no event carries a value of the environment', async () => {
  const box = sandbox();
  const installed = await run(box, ['service', 'install']);
  const removed = await run(box, ['service', 'uninstall']);
  const recorded = JSON.stringify([...installed.events, ...removed.events]);
  expect(recorded).toContain('Program run.');
  expect(recorded).not.toContain(secret);
});
