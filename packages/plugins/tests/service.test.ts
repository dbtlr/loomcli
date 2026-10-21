/*
 * Acceptance plan for the service plugin (docs/plugins/service.md#the-children).
 *
 * The plugin is proven when process tests under Node and Bun produce these results. Each fixture
 * sets `HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME` to temporary directories, puts fake
 * `systemctl`, `loginctl`, and `launchctl` programs first on `PATH` that answer from a scenario
 * file and record each call, and runs an application that installs `service()` through
 * `run({ host: { platform, program, release } })`, so both backends run on either CI platform:
 *
 * - Installing. A distributed run on `linux` writes the pinned unit, records it in `service.json`,
 *   and calls `daemon-reload`, `enable`, and `restart` in that order; a second install calls no
 *   `daemon-reload` and prints the unchanged line. On `darwin` it writes the pinned plist and calls
 *   `enable` and `bootstrap`; a second install with the agent loaded unloads it, polls until
 *   `print` exits 113, and calls `bootstrap`, and an install after an earlier one failed between
 *   its write and `bootstrap` prints the unchanged line and loads the plist on disk, and one whose
 *   text changed writes the plist, calls `enable`, unloads the agent, polls until `print` exits
 *   113, then calls `bootstrap`. A `program` of an interpreter and a script, a `run` word holding a
 *   space, `"`, `$`, and `%`, and a description holding `&` and `<` each render with the pinned
 *   quoting. An install after the label changed stops and disables the earlier unit and removes its
 *   file. An application with no description renders its name as the description. Every child but
 *   `status` leaves stdout empty. Under umask `002`, the unit and the plist are written with mode
 *   `644`.
 * - Refusing. A source build and a development build each exit 1 with the pinned sentence and call
 *   nothing. An unrecorded file, a recorded file changed since, a symbolic link, and a directory at
 *   the unit's path each exit 1, write nothing, and call nothing after the refusal. `win32` exits 1
 *   from every child, and a relative `HOME` exits 1 from every child. A file with the rendered text
 *   that `service.json` does not list refuses as unrecorded, and on `darwin` every refusal calls no
 *   `launchctl`. A `program` word holding a newline exits 1 with nothing written. A damaged and an
 *   unknown-format `service.json` each fail `install` and `uninstall` with the pinned sentence and
 *   call nothing.
 * - Children. `start`, `stop`, and `restart` call the pinned commands on each backend, and exit 1
 *   with the not-installed sentence when no file is at the path. On launchd, `stop` leaves the
 *   plist. `uninstall` disables, removes, and reloads on systemd, unloads and removes on launchd,
 *   keeps a changed unit with the kept line, refuses an unrecorded unit, and prints the
 *   nothing-to-remove line and exits 0 when nothing is installed. A recorded unit whose file is
 *   gone calls `stop` on systemd and `bootout` on launchd, prints the already-gone line, and clears
 *   the record. After the label changed with no reinstall, `uninstall` stops the earlier unit,
 *   removes its file, and clears the record.
 * - Managers. A fake `systemctl` that exits 1 fails `restart` with the pinned sentence and prints
 *   none of its output. A `PATH` with no `systemctl` fails with the cannot-find sentence. On
 *   launchd, a `bootout` that exits 3, 36, or 113 is no failure. On `linux`, an environment with no
 *   `XDG_RUNTIME_DIR` passes `/run/user/<uid>` to every call.
 * - Status. Each `ActiveState` of `active`, `inactive`, `failed`, and `activating`, and each
 *   launchd `print` of a running agent, a loaded agent with no process, and an agent that is not
 *   loaded, gives the pinned text and JSON. A unit with no file and no loaded job reads
 *   `not installed` and exits 0, and one with no file whose job the manager reports running reads
 *   that state and its pid. A `show` that exits 1 gives `unknown` with its note and exits 0.
 *   `Linger=no` and a `print gui/<uid>` that exits 113 add their notes. A probe's rows print under
 *   `unit`, and the probe receives the state and an `invoke` that runs the application's own
 *   Command; a probe that throws exits 1.
 * - Waiting. A run aborted while launchd's unload is polled, and one aborted during a manager call,
 *   exit 130 and leave the record as the module left it.
 * - Settings and the graph. Each settings fault throws its pinned diagnostic at the call. `run`
 *   words naming an unknown Command, a group, an unknown option, a misplaced option, an unexpected
 *   argument, and an option with no value each fail the build with `run-unrouted`, and `check()`
 *   reports it. `run` words that end in passthrough words after `--` pass.
 * - Packaging. `pnpm check:packed` resolves `@loomcli/plugins/service` from the packed tarball
 *   under Node and Bun.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { ruleParts } from '../../../scripts/test-rules.js';

const fixture = new URL('fixtures/service-run.mjs', import.meta.url);
const manager = fileURLToPath(new URL('fixtures/service-manager.mjs', import.meta.url));

/** The user id the plugin reads from the process, which the fixture shares with the test. */
const uid = process.getuid?.() ?? 0;
const domain = `gui/${uid}`;
const agent = `${domain}/com.acme.notes`;

const program = ['/opt/notes/bin/notes'];
const runWords = ['serve', '--port', '8080'];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: a home, a config and a state directory, and a directory of fake managers. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-service-'));
  roots.push(root);
  const box = {
    bin: join(root, 'bin'),
    calls: join(root, 'calls.jsonl'),
    config: join(root, 'config'),
    home: join(root, 'home'),
    marker: join(root, 'abort'),
    probeLog: join(root, 'probe.json'),
    root,
    state: join(root, 'state'),
  };
  for (const directory of [box.bin, box.config, box.home, box.state]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const name of ['systemctl', 'loginctl', 'launchctl']) {
    fakeManager(box, name);
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

/** Writes one fake manager program on the sandbox's `PATH`, which runs the shared fake. */
function fakeManager(box: Box, name: string): void {
  const path = join(box.bin, name);
  const scenario = join(box.root, 'scenario.json');
  writeFileSync(
    path,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(manager)} ${JSON.stringify(scenario)} ${name} "$@"\n`,
  );
  chmodSync(path, 0o755);
}

/** One rule of a fake manager: its exact words and the answers it gives in turn. */
interface Answer {
  readonly exit?: number;
  readonly stdout?: string;
  readonly abort?: boolean;
  readonly hang?: boolean;
}
type Answers = Record<string, Answer | readonly Answer[]>;

interface Scenario {
  readonly platform?: string;
  readonly program?: readonly string[];
  readonly release?: unknown;
  readonly label?: string;
  readonly run?: readonly string[];
  readonly description?: string | null;
  readonly probe?: 'rows' | 'throw';
  readonly answers?: Answers;
  readonly env?: Record<string, string | undefined>;
  readonly umask?: number;
  readonly terminal?: unknown;
}

/** Runs `notes service ...argv` in the sandbox against its fake managers. */
function run(box: Box, argv: string[], scenario: Scenario = {}) {
  const answers = Object.entries(scenario.answers ?? {}).map(([call, results]) => ({
    call,
    results: Array.isArray(results) ? results : [results],
  }));
  writeFileSync(
    join(box.root, 'scenario.json'),
    JSON.stringify({
      abortMarker: box.marker,
      answers,
      calls: box.calls,
      description: scenario.description,
      env: {
        HOME: box.home,
        PATH: box.bin,
        XDG_CONFIG_HOME: box.config,
        XDG_RUNTIME_DIR: '/run/user/given',
        XDG_STATE_HOME: box.state,
        ...scenario.env,
      },
      label: scenario.label,
      platform: scenario.platform ?? 'linux',
      probe: scenario.probe,
      probeLog: box.probeLog,
      program: scenario.program ?? program,
      release: scenario.release ?? { build: 'distributed' },
      run: scenario.run ?? runWords,
      terminal: scenario.terminal,
      umask: scenario.umask,
    }),
  );
  return invoke(fixture, [join(box.root, 'scenario.json'), 'service', ...argv]);
}

/** Every call the fake managers received, as their words. */
function calls(box: Box): string[] {
  return records(box).map((call) => call.words);
}

function records(box: Box): { words: string; runtime: string | null }[] {
  return existsSync(box.calls)
    ? readFileSync(box.calls, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

/** Forgets the calls so far and every rule's count. */
function clearCalls(box: Box): void {
  rmSync(box.calls, { force: true });
  rmSync(`${box.calls}.counts`, { force: true });
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function systemdPath(box: Box, label = 'com.acme.notes'): string {
  return join(box.config, 'systemd', 'user', `${label}.service`);
}

function launchdPath(box: Box, label = 'com.acme.notes'): string {
  return join(box.home, 'Library', 'LaunchAgents', `${label}.plist`);
}

function linuxRecord(box: Box): string {
  return join(box.state, 'notes', 'installation', 'service.json');
}

function darwinRecord(box: Box): string {
  return join(box.home, 'Library', 'Application Support', 'notes', 'installation', 'service.json');
}

/** The pinned systemd unit for the default settings in the sandbox. */
function pinnedUnit(box: Box): string {
  return `[Unit]
Description=Keep notes in sync.
StartLimitIntervalSec=0

[Service]
ExecStart="/opt/notes/bin/notes" "serve" "--port" "8080"
WorkingDirectory=${box.home}
Restart=always
RestartSec=10
SuccessExitStatus=130 143

[Install]
WantedBy=default.target
`;
}

/** The pinned launchd plist for the default settings in the sandbox. */
function pinnedPlist(box: Box): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.acme.notes</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/notes/bin/notes</string>
    <string>serve</string>
    <string>--port</string>
    <string>8080</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${box.home}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

/** The plugin's file as the installed-files module writes it once a unit is committed. */
function committedRecord(directories: readonly string[], path: string, text: string): string {
  const files = [{ path, digest: digestOf(text) }];
  return `${JSON.stringify({ format: 1, state: 'committed', directories, files })}\n`;
}

/** The answers that leave a launchd agent not loaded until it is bootstrapped. */
const notLoaded: Answers = { [`launchctl print ${agent}`]: { exit: 113 } };

/** The answers that report a loaded launchd agent. */
const loaded: Answers = { [`launchctl print ${agent}`]: { exit: 0 } };

describe('installing', () => {
  it('a distributed install on linux writes the pinned unit, records it, and reloads, enables, and restarts; a second is unchanged', () => {
    const box = sandbox();
    const result = run(box, ['install']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    const unit = systemdPath(box);
    expect(lines(result.stderr)).toEqual([`Wrote ${unit}.`, 'Started com.acme.notes.']);
    expect(readFileSync(unit, 'utf8')).toBe(pinnedUnit(box));
    expect(readFileSync(linuxRecord(box), 'utf8')).toBe(
      committedRecord(
        [join(box.config, 'systemd'), join(box.config, 'systemd', 'user')],
        unit,
        pinnedUnit(box),
      ),
    );
    expect(calls(box)).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable com.acme.notes.service',
      'systemctl --user restart com.acme.notes.service',
    ]);
    clearCalls(box);
    const second = run(box, ['install']);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe('');
    expect(lines(second.stderr)).toEqual([`${unit} is unchanged.`, 'Started com.acme.notes.']);
    expect(calls(box)).toEqual([
      'systemctl --user enable com.acme.notes.service',
      'systemctl --user restart com.acme.notes.service',
    ]);
  });

  it('a distributed install on darwin writes the pinned plist, enables, and bootstraps; a second install unloads a loaded agent, waits, and bootstraps, changed or not', () => {
    const box = sandbox();
    const plist = launchdPath(box);
    const result = run(box, ['install'], { answers: notLoaded, platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toEqual([`Wrote ${plist}.`, 'Started com.acme.notes.']);
    expect(readFileSync(plist, 'utf8')).toBe(pinnedPlist(box));
    expect(JSON.parse(readFileSync(darwinRecord(box), 'utf8')).files).toEqual([
      { digest: digestOf(pinnedPlist(box)), path: plist },
    ]);
    expect(calls(box)).toEqual([
      `launchctl enable ${agent}`,
      `launchctl bootout ${agent}`,
      `launchctl print ${agent}`,
      `launchctl bootstrap ${domain} ${plist}`,
    ]);

    clearCalls(box);
    const again = run(box, ['install'], {
      answers: { [`launchctl print ${agent}`]: [{ exit: 0 }, { exit: 113 }] },
      platform: 'darwin',
    });
    expect(again.status).toBe(0);
    expect(lines(again.stderr)).toEqual([`${plist} is unchanged.`, 'Started com.acme.notes.']);
    expect(calls(box)).toEqual([
      `launchctl enable ${agent}`,
      `launchctl bootout ${agent}`,
      `launchctl print ${agent}`,
      `launchctl print ${agent}`,
      `launchctl bootstrap ${domain} ${plist}`,
    ]);

    clearCalls(box);
    const changed = run(box, ['install'], {
      answers: { [`launchctl print ${agent}`]: [{ exit: 0 }, { exit: 0 }, { exit: 113 }] },
      platform: 'darwin',
      run: ['serve'],
    });
    expect(changed.status).toBe(0);
    expect(changed.stdout).toBe('');
    expect(calls(box)).toEqual([
      `launchctl enable ${agent}`,
      `launchctl bootout ${agent}`,
      `launchctl print ${agent}`,
      `launchctl print ${agent}`,
      `launchctl print ${agent}`,
      `launchctl bootstrap ${domain} ${plist}`,
    ]);
    expect(readFileSync(plist, 'utf8')).toContain(
      '<string>/opt/notes/bin/notes</string>\n    <string>serve</string>\n  </array>',
    );
  });

  it('an interpreter and a script, a run word with a space, ", $, and %, and a description with & and < render with the pinned quoting', () => {
    const scenario: Scenario = {
      description: 'Notes & <more> at 100%',
      program: ['/usr/bin/node', '/srv/my notes/main.js'],
      run: ['serve', '--port', 'a b"c$d%e'],
    };
    const linux = sandbox();
    expect(run(linux, ['install'], scenario).status).toBe(0);
    expect(readFileSync(systemdPath(linux), 'utf8')).toBe(`[Unit]
Description=Notes & <more> at 100%%
StartLimitIntervalSec=0

[Service]
ExecStart="/usr/bin/node" "/srv/my notes/main.js" "serve" "--port" "a b\\"c$$d%%e"
WorkingDirectory=${linux.home}
Restart=always
RestartSec=10
SuccessExitStatus=130 143

[Install]
WantedBy=default.target
`);
    const darwin = sandbox();
    expect(
      run(darwin, ['install'], { ...scenario, answers: notLoaded, platform: 'darwin' }).status,
    ).toBe(0);
    expect(readFileSync(launchdPath(darwin), 'utf8')).toContain(`  <array>
    <string>/usr/bin/node</string>
    <string>/srv/my notes/main.js</string>
    <string>serve</string>
    <string>--port</string>
    <string>a b&quot;c$d%e</string>
  </array>`);
  });

  it('an install after the label changed stops and disables the earlier unit and removes its file', () => {
    const box = sandbox();
    expect(run(box, ['install'], { label: 'com.acme.old' }).status).toBe(0);
    clearCalls(box);
    const result = run(box, ['install']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    const old = systemdPath(box, 'com.acme.old');
    expect(lines(result.stderr)).toEqual([
      `Wrote ${systemdPath(box)}.`,
      `Removed ${old}.`,
      'Started com.acme.notes.',
    ]);
    expect(existsSync(old)).toBe(false);
    expect(calls(box)).toEqual([
      'systemctl --user stop com.acme.old.service',
      'systemctl --user disable com.acme.old.service',
      'systemctl --user daemon-reload',
      'systemctl --user enable com.acme.notes.service',
      'systemctl --user restart com.acme.notes.service',
    ]);
    expect(JSON.parse(readFileSync(linuxRecord(box), 'utf8')).files).toEqual([
      { digest: digestOf(pinnedUnit(box)), path: systemdPath(box) },
    ]);
  });

  it('an install after an earlier one failed between its write and bootstrap prints the unchanged line and loads the plist on disk', () => {
    const box = sandbox();
    const plist = launchdPath(box);
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    clearCalls(box);
    const failed = run(box, ['install'], {
      answers: { ...loaded, [`launchctl enable ${agent}`]: { exit: 1 } },
      platform: 'darwin',
      run: ['serve'],
    });
    expect(failed.status).toBe(1);
    expect(lines(failed.stderr)[0]).toBe(`Wrote ${plist}.`);
    expect(calls(box)).toEqual([`launchctl enable ${agent}`]);
    clearCalls(box);
    const rerun = run(box, ['install'], {
      answers: { [`launchctl print ${agent}`]: [{ exit: 0 }, { exit: 113 }] },
      platform: 'darwin',
      run: ['serve'],
    });
    expect(rerun.status).toBe(0);
    expect(lines(rerun.stderr)).toEqual([`${plist} is unchanged.`, 'Started com.acme.notes.']);
    expect(calls(box)).toEqual([
      `launchctl enable ${agent}`,
      `launchctl bootout ${agent}`,
      `launchctl print ${agent}`,
      `launchctl print ${agent}`,
      `launchctl bootstrap ${domain} ${plist}`,
    ]);
    expect(calls(box).some((words) => words.includes('kickstart'))).toBe(false);
  });

  it('an install on darwin after the label changed unloads the earlier agent and removes its plist', () => {
    const box = sandbox();
    const old = `${domain}/com.acme.old`;
    const answers = { ...notLoaded, [`launchctl print ${old}`]: { exit: 113 } };
    expect(
      run(box, ['install'], { answers, label: 'com.acme.old', platform: 'darwin' }).status,
    ).toBe(0);
    clearCalls(box);
    const result = run(box, ['install'], { answers, platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(existsSync(launchdPath(box, 'com.acme.old'))).toBe(false);
    expect(calls(box).slice(0, 2)).toEqual([`launchctl bootout ${old}`, `launchctl print ${old}`]);
  });

  it('under umask 002 the unit and the plist are written with mode 644', () => {
    const linux = sandbox();
    expect(run(linux, ['install'], { umask: 0o002 }).status).toBe(0);
    expect(statSync(systemdPath(linux)).mode & 0o777).toBe(0o644);
    const darwin = sandbox();
    expect(
      run(darwin, ['install'], { answers: notLoaded, platform: 'darwin', umask: 0o002 }).status,
    ).toBe(0);
    expect(statSync(launchdPath(darwin)).mode & 0o777).toBe(0o644);
  });

  it('an application with no description renders its name as the description', () => {
    const box = sandbox();
    expect(run(box, ['install'], { description: null }).status).toBe(0);
    expect(readFileSync(systemdPath(box), 'utf8')).toContain('\nDescription=notes\n');
  });

  it.each(['\n', '\r\n'])(
    'a description with the line break %j installs with a space in its place',
    (lineBreak) => {
      const box = sandbox();
      expect(run(box, ['install'], { description: `Keep notes${lineBreak}in sync.` }).status).toBe(
        0,
      );
      expect(readFileSync(systemdPath(box), 'utf8')).toContain(
        '\nDescription=Keep notes in sync.\n',
      );
    },
  );
});

describe('refusing', () => {
  it.each([
    ['source', 'a source build'],
    ['development', 'a development build'],
  ])('a %s build exits 1 with the pinned sentence and calls nothing', (build, phrase) => {
    const box = sandbox();
    const result = run(box, ['install'], { release: { build } });
    expect(result).toEqual({
      status: 1,
      stderr: `notes is ${phrase}, so it cannot install a service that would outlive it. Build it with loom build, then run the built notes service install.\n`,
      stdout: '',
    });
    expect(calls(box)).toEqual([]);
    expect(existsSync(systemdPath(box))).toBe(false);
  });

  /** Puts something at the unit's path that the plugin's file does not list as it is. */
  const occupants: [string, (box: Box, path: string) => void, (path: string) => string][] = [
    [
      'an unrecorded file',
      (_box, path) => writeFileSync(path, 'hand written\n'),
      (path) =>
        `${path} was not written by notes service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run notes service install again.`,
    ],
    [
      'a symbolic link',
      (box, path) => symlinkSync(join(box.root, 'elsewhere'), path),
      (path) =>
        `${path} is not a regular file, so install leaves it alone. Remove it, then run notes service install again.`,
    ],
    [
      'a directory',
      (_box, path) => mkdirSync(path),
      (path) =>
        `${path} is not a regular file, so install leaves it alone. Remove it, then run notes service install again.`,
    ],
  ];

  describe.each([
    ['linux', systemdPath],
    ['darwin', launchdPath],
  ])('on %s', (platform, pathOf) => {
    it.each(occupants)(
      '%s at the unit path exits 1, writes nothing, and calls nothing',
      (_name, occupy, sentence) => {
        const box = sandbox();
        const path = pathOf(box);
        mkdirSync(join(path, '..'), { recursive: true });
        occupy(box, path);
        const result = run(box, ['install'], { answers: notLoaded, platform });
        expect(result).toEqual({ status: 1, stderr: `${sentence(path)}\n`, stdout: '' });
        expect(calls(box)).toEqual([]);
        expect(existsSync(platform === 'linux' ? linuxRecord(box) : darwinRecord(box))).toBe(false);
      },
    );

    it('a recorded file changed since exits 1, keeps the change, and calls nothing', () => {
      const box = sandbox();
      expect(run(box, ['install'], { answers: notLoaded, platform }).status).toBe(0);
      const path = pathOf(box);
      writeFileSync(path, 'changed by hand\n');
      clearCalls(box);
      const result = run(box, ['install'], { answers: notLoaded, platform });
      expect(result).toEqual({
        status: 1,
        stderr: `${path} changed since notes service install wrote it, so install leaves it alone. Remove it, then run notes service install again.\n`,
        stdout: '',
      });
      expect(readFileSync(path, 'utf8')).toBe('changed by hand\n');
      expect(calls(box)).toEqual([]);
    });

    it('a file with the rendered text that service.json does not list refuses as unrecorded', () => {
      const box = sandbox();
      const path = pathOf(box);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, platform === 'linux' ? pinnedUnit(box) : pinnedPlist(box));
      const result = run(box, ['install'], { answers: notLoaded, platform });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${path} was not written by notes service install`);
      expect(calls(box)).toEqual([]);
    });
  });

  it('win32 and a relative HOME exit 1 from every child', () => {
    const box = sandbox();
    for (const child of ['install', 'uninstall', 'start', 'stop', 'restart', 'status']) {
      expect(run(box, [child], { platform: 'win32' })).toEqual({
        status: 1,
        stderr:
          'notes cannot run a service on win32. Run it on Linux with systemd or macOS with launchd.\n',
        stdout: '',
      });
      for (const platform of ['linux', 'darwin']) {
        expect(run(box, [child], { env: { HOME: 'home' }, platform })).toEqual({
          status: 1,
          stderr:
            'notes cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n',
          stdout: '',
        });
      }
    }
    expect(calls(box)).toEqual([]);
  });

  it('a program word holding a newline exits 1 with nothing written', () => {
    const box = sandbox();
    const result = run(box, ['install'], { program: ['/opt/notes\n/bin/notes'] });
    expect(result).toEqual({
      status: 1,
      stderr:
        'notes cannot write its service unit because a path or its description holds a control character. Install notes where its path has none.\n',
      stdout: '',
    });
    expect(existsSync(systemdPath(box))).toBe(false);
    expect(existsSync(linuxRecord(box))).toBe(false);
    expect(calls(box)).toEqual([]);
  });

  it.each([
    ['damaged', 'not json'],
    ['unknown-format', '{"format":2,"state":"committed","directories":[],"files":[]}\n'],
  ])(
    'a %s service.json fails install and uninstall with the pinned sentence and calls nothing',
    (_reason, text) => {
      const box = sandbox();
      const record = linuxRecord(box);
      mkdirSync(join(record, '..'), { recursive: true });
      writeFileSync(record, text);
      for (const child of ['install', 'uninstall']) {
        expect(run(box, [child])).toEqual({
          status: 1,
          stderr: `${record} cannot be read, so notes will not change the files it lists. Remove it and the files it lists, then run notes service ${child} again.\n`,
          stdout: '',
        });
      }
      expect(calls(box)).toEqual([]);
      expect(readFileSync(record, 'utf8')).toBe(text);
    },
  );
});

describe('children', () => {
  it('start, stop, and restart call the pinned systemd commands', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    for (const [child, line] of [
      ['start', 'Started'],
      ['stop', 'Stopped'],
      ['restart', 'Restarted'],
    ]) {
      clearCalls(box);
      const result = run(box, [child ?? '']);
      expect(result).toEqual({ status: 0, stderr: expect.any(String), stdout: '' });
      expect(lines(result.stderr)).toEqual([`${line} com.acme.notes.`]);
      expect(calls(box)).toEqual([`systemctl --user ${child} com.acme.notes.service`]);
    }
  });

  it('start, stop, and restart call the pinned launchd commands, and stop leaves the plist', () => {
    const box = sandbox();
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    const cases: [string, Answers, string[]][] = [
      ['start', loaded, [`launchctl print ${agent}`, `launchctl kickstart ${agent}`]],
      [
        'start',
        notLoaded,
        [`launchctl print ${agent}`, `launchctl bootstrap ${domain} ${launchdPath(box)}`],
      ],
      [
        'stop',
        { [`launchctl print ${agent}`]: [{ exit: 0 }, { exit: 113 }] },
        [`launchctl bootout ${agent}`, `launchctl print ${agent}`, `launchctl print ${agent}`],
      ],
      ['restart', loaded, [`launchctl print ${agent}`, `launchctl kickstart -k ${agent}`]],
      [
        'restart',
        notLoaded,
        [`launchctl print ${agent}`, `launchctl bootstrap ${domain} ${launchdPath(box)}`],
      ],
    ];
    for (const [child, answers, expected] of cases) {
      clearCalls(box);
      const result = run(box, [child], { answers, platform: 'darwin' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(calls(box)).toEqual(expected);
    }
    expect(readFileSync(launchdPath(box), 'utf8')).toBe(pinnedPlist(box));
  });

  it.each(['linux', 'darwin'])(
    'start, stop, and restart on %s exit 1 with the not-installed sentence when no file is at the path',
    (platform) => {
      const box = sandbox();
      for (const child of ['start', 'stop', 'restart']) {
        expect(run(box, [child], { platform })).toEqual({
          status: 1,
          stderr: 'com.acme.notes is not installed. Run notes service install first.\n',
          stdout: '',
        });
      }
      expect(calls(box)).toEqual([]);
    },
  );

  it('uninstall on systemd stops, disables, removes, reloads, and clears the record', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    clearCalls(box);
    const result = run(box, ['uninstall']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toEqual([`Removed ${systemdPath(box)}.`]);
    expect(calls(box)).toEqual([
      'systemctl --user stop com.acme.notes.service',
      'systemctl --user disable com.acme.notes.service',
      'systemctl --user daemon-reload',
    ]);
    expect(existsSync(systemdPath(box))).toBe(false);
    expect(existsSync(linuxRecord(box))).toBe(false);
  });

  it('uninstall on launchd unloads the agent and removes the plist', () => {
    const box = sandbox();
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    clearCalls(box);
    const result = run(box, ['uninstall'], { answers: notLoaded, platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toEqual([`Removed ${launchdPath(box)}.`]);
    expect(calls(box)).toEqual([`launchctl bootout ${agent}`, `launchctl print ${agent}`]);
    expect(existsSync(launchdPath(box))).toBe(false);
    expect(existsSync(darwinRecord(box))).toBe(false);
  });

  it('uninstall keeps a changed unit with the kept line', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    writeFileSync(systemdPath(box), 'changed by hand\n');
    const result = run(box, ['uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Kept ${systemdPath(box)} because it changed since notes service install wrote it. Remove it yourself when it is no longer needed.`,
    ]);
    expect(readFileSync(systemdPath(box), 'utf8')).toBe('changed by hand\n');
  });

  it('uninstall refuses an unrecorded unit and runs nothing', () => {
    const box = sandbox();
    mkdirSync(join(systemdPath(box), '..'), { recursive: true });
    writeFileSync(systemdPath(box), 'hand written\n');
    expect(run(box, ['uninstall'])).toEqual({
      status: 1,
      stderr: `${systemdPath(box)} was not written by notes service install, so uninstall leaves it alone. Remove it with whatever installed it.\n`,
      stdout: '',
    });
    expect(calls(box)).toEqual([]);
    expect(readFileSync(systemdPath(box), 'utf8')).toBe('hand written\n');
  });

  it('uninstall with nothing installed prints the nothing-to-remove line and exits 0', () => {
    const box = sandbox();
    const result = run(box, ['uninstall']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toEqual([
      'com.acme.notes is not installed, so there is nothing to remove.',
    ]);
    expect(calls(box)).toEqual([]);
  });

  it('a recorded unit whose file is gone is stopped, reads as already gone, and the record clears', () => {
    const linux = sandbox();
    expect(run(linux, ['install']).status).toBe(0);
    rmSync(systemdPath(linux));
    clearCalls(linux);
    const systemd = run(linux, ['uninstall']);
    expect(systemd.status).toBe(0);
    expect(lines(systemd.stderr)).toEqual([`${systemdPath(linux)} was already gone.`]);
    expect(calls(linux)).toEqual([
      'systemctl --user stop com.acme.notes.service',
      'systemctl --user daemon-reload',
    ]);
    expect(existsSync(linuxRecord(linux))).toBe(false);

    const darwin = sandbox();
    expect(run(darwin, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    rmSync(launchdPath(darwin));
    clearCalls(darwin);
    const launchd = run(darwin, ['uninstall'], { answers: notLoaded, platform: 'darwin' });
    expect(launchd.status).toBe(0);
    expect(lines(launchd.stderr)).toEqual([`${launchdPath(darwin)} was already gone.`]);
    expect(calls(darwin)[0]).toBe(`launchctl bootout ${agent}`);
    expect(existsSync(darwinRecord(darwin))).toBe(false);
  });

  it('after the label changed with no reinstall, uninstall stops the earlier unit, removes its file, and clears the record', () => {
    const box = sandbox();
    expect(run(box, ['install'], { label: 'com.acme.old' }).status).toBe(0);
    clearCalls(box);
    const result = run(box, ['uninstall']);
    expect(result.status).toBe(0);
    const old = systemdPath(box, 'com.acme.old');
    expect(lines(result.stderr)).toEqual([`Removed ${old}.`]);
    expect(calls(box)).toEqual([
      'systemctl --user stop com.acme.old.service',
      'systemctl --user disable com.acme.old.service',
      'systemctl --user daemon-reload',
    ]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(linuxRecord(box))).toBe(false);
  });
});

describe('managers', () => {
  it('a systemctl that exits 1 fails restart with the pinned sentence and prints none of its output', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const result = run(box, ['restart'], {
      answers: {
        'systemctl --user restart com.acme.notes.service': {
          exit: 1,
          stdout: 'secret output\n',
        },
      },
    });
    expect(result).toEqual({
      status: 1,
      stderr:
        'systemctl --user restart com.acme.notes.service exited with 1. Run systemctl --user status com.acme.notes.service to see why.\n',
      stdout: '',
    });
  });

  it('a launchctl call that exits with an unnamed code names the call and points at print', () => {
    const box = sandbox();
    const result = run(box, ['install'], {
      answers: { ...notLoaded, [`launchctl bootstrap ${domain} ${launchdPath(box)}`]: { exit: 5 } },
      platform: 'darwin',
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr).at(-1)).toBe(
      `launchctl bootstrap ${domain} ${launchdPath(box)} exited with 5. Run launchctl print ${agent} to see why.`,
    );
  });

  it('a PATH with no systemctl fails with the cannot-find sentence', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    rmSync(join(box.bin, 'systemctl'));
    expect(run(box, ['stop'])).toEqual({
      status: 1,
      stderr:
        'notes cannot find systemctl. Install systemd, or run the command where it is available.\n',
      stdout: '',
    });
  });

  it.each([3, 36, 113])('a launchd bootout that exits %i is no failure', (code) => {
    const box = sandbox();
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    const result = run(box, ['stop'], {
      answers: { ...notLoaded, [`launchctl bootout ${agent}`]: { exit: code } },
      platform: 'darwin',
    });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual(['Stopped com.acme.notes.']);
  });

  it('on linux, an environment with no XDG_RUNTIME_DIR passes /run/user/<uid> to every call, and a given one passes as it is', () => {
    const box = sandbox();
    expect(run(box, ['install'], { env: { XDG_RUNTIME_DIR: undefined } }).status).toBe(0);
    expect(run(box, ['status'], { env: { XDG_RUNTIME_DIR: undefined } }).status).toBe(0);
    const absent = records(box);
    expect(absent.length).toBeGreaterThan(4);
    expect(absent.every((call) => call.runtime === `/run/user/${uid}`)).toBe(true);
    clearCalls(box);
    expect(run(box, ['restart']).status).toBe(0);
    expect(records(box)).toEqual([
      { runtime: '/run/user/given', words: 'systemctl --user restart com.acme.notes.service' },
    ]);
  });
});

/** The members of a status that differ between cases. */
interface StatusMembers {
  readonly pid?: number;
  readonly running: boolean;
  readonly state: string;
}

/** The status JSON of an installed unit, its members in the type's order. */
function statusJson(unit: string, { pid, running, state }: StatusMembers): string {
  const document = {
    label: 'com.acme.notes',
    unit,
    installed: true,
    running,
    state,
    ...(pid === undefined ? {} : { pid }),
    notes: [],
    details: [],
  };
  return `${JSON.stringify(document, undefined, 2)}\n`;
}

/** The answers of one systemd show and a lingering user. */
function shown(active: string, pid: number): Answers {
  return {
    'systemctl --user show com.acme.notes.service --property=ActiveState,MainPID': {
      stdout: `ActiveState=${active}\nMainPID=${pid}\n`,
    },
    [`loginctl show-user ${uid} --property=Linger`]: { stdout: 'Linger=yes\n' },
  };
}

describe('status', () => {
  it('prints the same bytes on a narrow terminal as on a pipe, its unit path whole', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const narrow = { columns: 20, isTTY: true, rows: 24 };
    const terminal = { stderr: narrow, stdin: { isTTY: false }, stdout: narrow };
    const text = run(box, ['status'], { answers: shown('active', 4120), terminal });
    expect(text).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: running (pid 4120)\n  unit  ${systemdPath(box)}\n`,
    });
  });

  it.each<[string, number, string, StatusMembers]>([
    ['active', 4120, 'running (pid 4120)', { pid: 4120, running: true, state: 'active' }],
    ['inactive', 0, 'inactive', { running: false, state: 'inactive' }],
    ['failed', 0, 'failed', { running: false, state: 'failed' }],
    ['activating', 77, 'activating', { pid: 77, running: false, state: 'activating' }],
  ])('ActiveState %s gives the pinned text and JSON', (active, pid, summary, members) => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const text = run(box, ['status'], { answers: shown(active, pid) });
    expect(text).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: ${summary}\n  unit  ${systemdPath(box)}\n`,
    });
    const json = run(box, ['status', '--format', 'json'], { answers: shown(active, pid) });
    expect(json.status).toBe(0);
    expect(json.stdout).toBe(statusJson(systemdPath(box), members));
  });

  it.each<[string, Answer, string, StatusMembers]>([
    [
      'a running agent',
      {
        exit: 0,
        stdout: `${agent} = {\n\tstate = running\n\tpid = 4120\n\tendpoints = {\n\t\tstate = other\n\t}\n}\n`,
      },
      'running (pid 4120)',
      { pid: 4120, running: true, state: 'running' },
    ],
    [
      'a loaded agent with no process',
      { exit: 0, stdout: `${agent} = {\n\tstate = not running\n\t\tpid = 9\n}\n` },
      'not running',
      { running: false, state: 'not running' },
    ],
    [
      'an agent that is not loaded',
      { exit: 113 },
      'not loaded',
      { running: false, state: 'not loaded' },
    ],
  ])('a launchd print of %s gives the pinned text and JSON', (_name, answer, summary, members) => {
    const box = sandbox();
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    const answers = {
      [`launchctl print ${agent}`]: answer,
      [`launchctl print ${domain}`]: { exit: 0 },
    };
    const text = run(box, ['status'], { answers, platform: 'darwin' });
    expect(text).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: ${summary}\n  unit  ${launchdPath(box)}\n`,
    });
    const json = run(box, ['status', '--format', 'json'], { answers, platform: 'darwin' });
    expect(json.stdout).toBe(statusJson(launchdPath(box), members));
  });

  it('a unit with no file and no loaded job reads not installed and exits 0, and one whose job runs reads its state and pid', () => {
    const box = sandbox();
    const missing = run(box, ['status', '--format', 'json'], { answers: shown('inactive', 0) });
    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout)).toEqual({
      details: [],
      installed: false,
      label: 'com.acme.notes',
      notes: [],
      running: false,
      state: 'not installed',
      unit: systemdPath(box),
    });
    const darwin = run(box, ['status'], { answers: notLoaded, platform: 'darwin' });
    expect(darwin).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: not installed\n  unit  ${launchdPath(box)}\n`,
    });
    const orphan = run(box, ['status'], { answers: shown('active', 31) });
    expect(orphan.stdout).toBe(`com.acme.notes: running (pid 31)\n  unit  ${systemdPath(box)}\n`);
    // Status asks no session question of a unit that is not installed.
    expect(calls(box).filter((words) => words.startsWith('loginctl'))).toEqual([]);
  });

  it('a show that exits 1 gives unknown with its note and exits 0', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const result = run(box, ['status'], {
      answers: {
        ...shown('active', 1),
        'systemctl --user show com.acme.notes.service --property=ActiveState,MainPID': { exit: 1 },
      },
    });
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: unknown\n  unit  ${systemdPath(box)}\n  note  systemctl --user could not report com.acme.notes.service (exit 1). Run systemctl --user status com.acme.notes.service to see why.\n`,
    });
    const darwin = run(box, ['status'], {
      answers: { [`launchctl print ${agent}`]: { exit: 5 } },
      platform: 'darwin',
    });
    expect(darwin.status).toBe(0);
    expect(darwin.stdout).toContain(
      `  note  launchctl could not report ${agent} (exit 5). Run launchctl print ${agent} to see why.\n`,
    );
    rmSync(join(box.bin, 'systemctl'));
    const missing = run(box, ['status']);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain(
      '  note  notes cannot find systemctl. Install systemd, or run the command where it is available.\n',
    );
  });

  it('Linger=no and a print of the domain that exits 113 add their notes', () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const linger = run(box, ['status'], {
      answers: {
        ...shown('active', 4120),
        [`loginctl show-user ${uid} --property=Linger`]: { stdout: 'Linger=no\n' },
      },
    });
    expect(linger.stdout).toBe(
      `com.acme.notes: running (pid 4120)\n  unit  ${systemdPath(box)}\n  note  Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.\n`,
    );
    const darwin = sandbox();
    expect(run(darwin, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    const session = run(darwin, ['status'], {
      answers: { ...notLoaded, [`launchctl print ${domain}`]: { exit: 113 } },
      platform: 'darwin',
    });
    expect(session.stdout).toBe(
      `com.acme.notes: not loaded\n  unit  ${launchdPath(darwin)}\n  note  There is no login session, so com.acme.notes starts when you log in.\n`,
    );
  });

  it("a probe's rows print under unit, and the probe receives the state and an invoke that runs the application's own Command", () => {
    const box = sandbox();
    expect(run(box, ['install']).status).toBe(0);
    const answers = {
      ...shown('active', 4120),
      [`loginctl show-user ${uid} --property=Linger`]: { stdout: 'Linger=no\n' },
    };
    const result = run(box, ['status'], { answers, probe: 'rows' });
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: `com.acme.notes: running (pid 4120)\n  unit    ${systemdPath(box)}\n  health  ok, v1.5.0\n  note    Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.\n`,
    });
    expect(JSON.parse(readFileSync(box.probeLog, 'utf8'))).toEqual({
      aborted: false,
      log: 'function',
      platform: 'linux',
      state: {
        installed: true,
        label: 'com.acme.notes',
        notes: [
          'Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.',
        ],
        pid: 4120,
        running: true,
        state: 'active',
        unit: systemdPath(box),
      },
    });
    const json = run(box, ['status', '--format', 'json'], { answers, probe: 'rows' });
    expect(JSON.parse(json.stdout).details).toEqual([{ name: 'health', value: 'ok, v1.5.0' }]);
  });

  it('a probe is not called for a unit that is not installed, and a probe that throws exits 1', () => {
    const box = sandbox();
    const missing = run(box, ['status'], { answers: shown('inactive', 0), probe: 'throw' });
    expect(missing.status).toBe(0);
    expect(existsSync(box.probeLog)).toBe(false);
    expect(run(box, ['install']).status).toBe(0);
    const thrown = run(box, ['status'], { answers: shown('active', 1), probe: 'throw' });
    expect(thrown.status).toBe(1);
    expect(thrown.stdout).toBe('');
    expect(existsSync(box.probeLog)).toBe(true);
  });
});

describe('waiting', () => {
  it('a run aborted while the launchd unload is polled exits 130 and leaves the record', () => {
    const box = sandbox();
    expect(run(box, ['install'], { answers: notLoaded, platform: 'darwin' }).status).toBe(0);
    const before = readFileSync(darwinRecord(box), 'utf8');
    const result = run(box, ['stop'], {
      answers: { [`launchctl print ${agent}`]: [{ exit: 0 }, { abort: true, exit: 0 }] },
      platform: 'darwin',
    });
    expect(result.status).toBe(130);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr).join('\n')).not.toContain('Stopped');
    expect(readFileSync(darwinRecord(box), 'utf8')).toBe(before);
    expect(readFileSync(launchdPath(box), 'utf8')).toBe(pinnedPlist(box));
  });

  it('a run aborted during a manager call ends the call and exits 130 with the record the module left', () => {
    const box = sandbox();
    const result = run(box, ['install'], {
      answers: { 'systemctl --user restart com.acme.notes.service': { abort: true, hang: true } },
    });
    expect(result.status).toBe(130);
    expect(result.stdout).toBe('');
    expect(readFileSync(linuxRecord(box), 'utf8')).toBe(
      committedRecord(
        [join(box.config, 'systemd'), join(box.config, 'systemd', 'user')],
        systemdPath(box),
        pinnedUnit(box),
      ),
    );
  });
});

/** The run-unrouted fault's line for the words as the sentence joins them. */
function unrouted(words: string): string {
  return `@loomcli/plugins/service/run-unrouted: Plugin "@loomcli/plugins/service" setting "run" does not route to a Command with an action: ${words}. Name the words of a Command that has an action, as the application's command line takes them.\n`;
}

describe('settings and the graph', () => {
  const graphFixture = new URL('fixtures/service-graph.mjs', import.meta.url);

  it.each([
    ['an unknown Command', ['bogus']],
    ['a group', ['cache']],
    ['an unknown option', ['serve', '--bogus']],
    ['a misplaced option', ['--port', '8080', 'serve']],
    ['an unexpected argument', ['serve', 'extra']],
    ['an option with no value', ['serve', '--port']],
  ])(
    'run words naming %s fail the build with run-unrouted, and check() reports it',
    (_name, words) => {
      const json = JSON.stringify(words);
      expect(invoke(graphFixture, [json, 'check'])).toEqual({
        status: 0,
        stderr: '',
        stdout: unrouted(words.join(' ')),
      });
      expect(invoke(graphFixture, [json, 'inspect'])).toEqual({
        status: 0,
        stderr: '',
        stdout: `thrown:${unrouted(words.join(' '))}`,
      });
      expect(invoke(graphFixture, [json, 'run'])).toEqual({
        status: 1,
        stderr: 'notes: Something went wrong.\n',
        stdout: '',
      });
    },
  );

  it('a development build renders the run-unrouted Developer Diagnostic', () => {
    const result = invoke(graphFixture, ['["bogus"]', 'run'], {
      env: { FIXTURE_BUILD: 'development' },
    });
    expect(result).toMatchObject({ status: 1, stdout: '' });
    expect(ruleParts(result.stderr)).toEqual({
      correction:
        "Name the words of a Command that has an action, as the application's command line takes them.",
      identity: '@loomcli/plugins/service/run-unrouted',
      sentence:
        'Plugin "@loomcli/plugins/service" setting "run" does not route to a Command with an action: bogus.',
    });
  });

  it.each([
    [['serve', '--', 'a', 'b']],
    [['serve', '--']],
    [['serve', '--port', '8080']],
    [['serve', '--verbose', '--port=1']],
    [['cache', 'clear']],
  ])('run words %j route and pass', (words) => {
    expect(invoke(graphFixture, [JSON.stringify(words), 'check'])).toEqual({
      status: 0,
      stderr: '',
      stdout: 'clean\n',
    });
    expect(invoke(graphFixture, [JSON.stringify(words), 'run']).status).toBe(0);
  });
});
