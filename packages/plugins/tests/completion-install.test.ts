import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { startupLine } from '../src/completion/shells.js';
import { deniesWrite, ownedByAnother } from '../src/completion/startup.js';
import { zshInstalledScript } from '../src/completion/zsh.js';

const fixture = new URL('fixtures/completion-install.mjs', import.meta.url);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodTree(root);
    rmSync(root, { force: true, recursive: true });
  }
});

/** Makes every folder under a root writable again, so a test that took write access away cleans up. */
function chmodTree(path: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined || stats.isSymbolicLink() || !stats.isDirectory()) {
    return;
  }
  chmodSync(path, 0o755);
  for (const name of readdirSync(path)) {
    chmodTree(join(path, name));
  }
}

/** A sandbox: a home, data, configuration, and state folders, and a working directory. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-completion-'));
  roots.push(root);
  const box = {
    config: join(root, 'config'),
    data: join(root, 'data'),
    home: join(root, 'home'),
    root,
    scenario: join(root, 'scenario.json'),
    state: join(root, 'state'),
    work: join(root, 'work'),
  };
  for (const directory of [box.home, box.data, box.config, box.state, box.work]) {
    mkdirSync(directory, { recursive: true });
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

interface Scenario {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: string;
  readonly umask?: number;
  /** The working directory of the process and its host, the sandbox's `work` folder when left out. */
  readonly cwd?: string;
  /** The file whose appearance aborts the run. */
  readonly abortMarker?: string;
}

/** Runs `jsonkit ...argv` in the sandbox, with the temporary folders and the scenario's variables. */
function run(box: Box, argv: string[], scenario: Scenario = {}) {
  const cwd = scenario.cwd ?? box.work;
  writeFileSync(
    box.scenario,
    JSON.stringify({
      abortMarker: scenario.abortMarker,
      cwd,
      env: {
        HOME: box.home,
        XDG_CONFIG_HOME: box.config,
        XDG_DATA_HOME: box.data,
        XDG_STATE_HOME: box.state,
        ...scenario.env,
      },
      platform: scenario.platform,
      umask: scenario.umask,
    }),
  );
  return invoke(fixture, argv, { cwd, env: { COMPLETION_SCENARIO: box.scenario } });
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

/** The printed script of a shell, read from the print child. */
function printed(box: Box, shell: string): string {
  return run(box, ['completion', shell]).stdout;
}

const scripts = {
  bash: (box: Box) => join(box.data, 'jsonkit', 'completion', 'jsonkit.bash'),
  fish: (box: Box) => join(box.config, 'fish', 'completions', 'jsonkit.fish'),
  pwsh: (box: Box) => join(box.data, 'jsonkit', 'completion', 'jsonkit.pwsh.ps1'),
  zsh: (box: Box) => join(box.data, 'jsonkit', 'completion', 'zsh', '_loom_jsonkit'),
};

const marker = '# added by jsonkit completion install';

function bashLine(script: string): string {
  return `if [ -n "\${BASH_VERSION-}" ] && [ -f '${script}' ]; then . '${script}'; fi ${marker}`;
}

function zshLine(script: string): string {
  return `fpath=('${dirname(script)}' $fpath); if [ -f '${script}' ]; then . '${script}'; fi ${marker}`;
}

function powershellLine(script: string): string {
  return `if (Test-Path -LiteralPath '${script}') { . '${script}' } ${marker}`;
}

function recordPath(box: Box, shell: string): string {
  return join(box.state, 'jsonkit', 'installation', `completion.${shell}.json`);
}

/** What a shell's plugin's file records. */
function recorded(box: Box, shell: string) {
  const file: {
    state: string;
    directories: string[];
    files: { path: string; digest: string }[];
    lines?: { path: string; line: string }[];
  } = JSON.parse(readFileSync(recordPath(box, shell), 'utf8'));
  return { ...file, lines: file.lines ?? [] };
}

/** Rewrites a shell's plugin's file with the change applied. */
function editRecord(box: Box, shell: string, change: (file: Record<string, unknown>) => void) {
  const file: Record<string, unknown> = JSON.parse(readFileSync(recordPath(box, shell), 'utf8'));
  change(file);
  writeFileSync(recordPath(box, shell), `${JSON.stringify(file)}\n`);
}

function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** The permission bits of a path. */
function modeOf(path: string): number {
  return lstatSync(path).mode & 0o777;
}

/** Every entry under a path with its kind, permission bits, and content, without following a link. */
function tree(path: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (current: string, key: string) => {
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (stats === undefined) {
      entries[key] = 'absent';
    } else if (stats.isSymbolicLink()) {
      entries[key] = `link ${readlinkSync(current)}`;
    } else if (stats.isDirectory()) {
      entries[key] = `directory ${(stats.mode & 0o777).toString(8)}`;
      for (const name of readdirSync(current)) {
        walk(join(current, name), `${key}/${name}`);
      }
    } else {
      entries[key] =
        `file ${(stats.mode & 0o777).toString(8)} ${readFileSync(current).toString('latin1')}`;
    }
  };
  walk(path, '.');
  return entries;
}

/** An error the runtime throws for a system call, carrying its code. */
function systemError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('installing Bash and Zsh', () => {
  it.each([0o002, 0o077])(
    'writes the pinned script, line, and record under umask %o, and a second install changes nothing',
    (umask) => {
      const box = sandbox();
      const script = scripts.bash(box);
      const startup = join(box.home, '.bashrc');
      const result = run(box, ['completion', 'install', 'bash'], { umask });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(lines(result.stderr)).toEqual([
        `Installed the bash completion script in ${script}.`,
        `Added a line to ${startup} that loads it.`,
        'Open a new shell to use it.',
      ]);
      expect(readFileSync(script, 'utf8')).toBe(printed(box, 'bash'));
      expect(modeOf(script)).toBe(0o644);
      expect(modeOf(dirname(script))).toBe(0o755);
      expect(modeOf(join(box.data, 'jsonkit'))).toBe(0o755);
      expect(readFileSync(startup, 'utf8')).toBe(`${bashLine(script)}\n`);
      expect(modeOf(startup)).toBe(0o644);
      expect(recorded(box, 'bash')).toMatchObject({
        directories: [join(box.data, 'jsonkit'), dirname(script)],
        files: [{ path: script }],
        lines: [{ line: bashLine(script), path: startup }],
        state: 'committed',
      });
      const before = { ...tree(box.home), ...tree(box.data), ...tree(box.state) };
      const again = run(box, ['completion', 'install', 'bash'], { umask });
      expect(again.status).toBe(0);
      expect(lines(again.stderr)).toEqual([
        `${script} is unchanged.`,
        `${startup} already loads it.`,
      ]);
      expect({ ...tree(box.home), ...tree(box.data), ...tree(box.state) }).toEqual(before);
    },
  );

  it.each([0o002, 0o077])(
    'writes the installed Zsh file and its fpath line at the end of .zshrc under umask %o',
    (umask) => {
      const box = sandbox();
      const script = scripts.zsh(box);
      const startup = join(box.home, '.zshrc');
      writeFileSync(startup, 'autoload -Uz compinit\ncompinit');
      const result = run(box, ['completion', 'install', 'zsh'], { umask });
      expect(result.status).toBe(0);
      expect(lines(result.stderr)).toEqual([
        `Installed the zsh completion script in ${script}.`,
        `Added a line to ${startup} that loads it.`,
        'Open a new shell to use it.',
      ]);
      expect(readFileSync(script, 'utf8')).toBe(zshInstalledScript('jsonkit'));
      expect(modeOf(script)).toBe(0o644);
      expect(modeOf(dirname(script))).toBe(0o755);
      expect(modeOf(dirname(dirname(script)))).toBe(0o755);
      expect(readFileSync(startup, 'utf8')).toBe(
        `autoload -Uz compinit\ncompinit\n${zshLine(script)}\n`,
      );
      expect(recorded(box, 'zsh').lines).toEqual([{ line: zshLine(script), path: startup }]);
      const before = { ...tree(box.home), ...tree(box.data) };
      const again = run(box, ['completion', 'install', 'zsh'], { umask });
      expect(lines(again.stderr)).toEqual([
        `${script} is unchanged.`,
        `${startup} already loads it.`,
      ]);
      expect({ ...tree(box.home), ...tree(box.data) }).toEqual(before);
    },
  );

  it('writes Fish’s script under the configuration folder, touches no startup file, and reports it unchanged next time', () => {
    const box = sandbox();
    const script = scripts.fish(box);
    const result = run(box, ['completion', 'install', 'fish']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the fish completion script in ${script}.`,
      'Open a new shell to use it.',
    ]);
    expect(readFileSync(script, 'utf8')).toBe(printed(box, 'fish'));
    expect(recorded(box, 'fish')).toMatchObject({ files: [{ path: script }], lines: [] });
    expect(readdirSync(box.home)).toEqual([]);
    const again = run(box, ['completion', 'install', 'fish']);
    expect(lines(again.stderr)).toEqual([`${script} is unchanged.`]);
  });

  it('follows SHELL when the shell is left out', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install'], { env: { SHELL: '/usr/bin/zsh' } });
    expect(result.status).toBe(0);
    expect(existsSync(scripts.zsh(box))).toBe(true);
    expect(existsSync(recordPath(box, 'zsh'))).toBe(true);
  });

  it.each([
    ['/bin/sh', '/bin/sh'],
    [undefined, '(unset)'],
    ['', '(unset)'],
  ])('exits 2 for SHELL %j with the pinned sentence and writes nothing', (shell, shown) => {
    const box = sandbox();
    const result = run(box, ['completion', 'install'], { env: { SHELL: shell } });
    expect(result.status).toBe(2);
    expect(lines(result.stderr)[0]).toBe(
      `jsonkit: jsonkit cannot tell your shell from SHELL (${shown}). Name it: jsonkit completion install bash, zsh, fish, powershell, or pwsh.`,
    );
    expect(readdirSync(box.data)).toEqual([]);
    expect(readdirSync(box.state)).toEqual([]);
  });

  it('exits 2 for a shell argument outside the five', () => {
    const box = sandbox();
    expect(run(box, ['completion', 'install', 'tcsh']).status).toBe(2);
    expect(run(box, ['completion', 'uninstall', 'tcsh']).status).toBe(2);
  });

  it('puts Bash’s line in an existing .profile on darwin when neither .bash_profile nor .bash_login exists', () => {
    const box = sandbox();
    const profile = join(box.home, '.profile');
    writeFileSync(profile, 'export PATH\n');
    const result = run(box, ['completion', 'install', 'bash'], { platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(readFileSync(profile, 'utf8')).toBe(`export PATH\n${bashLine(scripts.bash(box))}\n`);
    expect(existsSync(join(box.home, '.bash_profile'))).toBe(false);
    expect(existsSync(join(box.home, '.bashrc'))).toBe(false);
  });

  it('puts Bash’s line in .bash_login on darwin before .profile when .bash_profile does not exist', () => {
    const box = sandbox();
    const login = join(box.home, '.bash_login');
    writeFileSync(login, '');
    writeFileSync(join(box.home, '.profile'), 'export PATH\n');
    const result = run(box, ['completion', 'install', 'bash'], { platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(readFileSync(login, 'utf8')).toBe(`${bashLine(scripts.bash(box))}\n`);
    expect(readFileSync(join(box.home, '.profile'), 'utf8')).toBe('export PATH\n');
  });

  it('creates .bash_profile on darwin when no login file exists', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install', 'bash'], { platform: 'darwin' });
    expect(result.status).toBe(0);
    expect(readFileSync(join(box.home, '.bash_profile'), 'utf8')).toBe(
      `${bashLine(scripts.bash(box))}\n`,
    );
  });

  it('moves the Zsh line under an absolute ZDOTDIR, creating the folder', () => {
    const box = sandbox();
    const zdotdir = join(box.root, 'zdot', 'inner');
    const result = run(box, ['completion', 'install', 'zsh'], { env: { ZDOTDIR: zdotdir } });
    expect(result.status).toBe(0);
    expect(readFileSync(join(zdotdir, '.zshrc'), 'utf8')).toBe(`${zshLine(scripts.zsh(box))}\n`);
    expect(modeOf(zdotdir)).toBe(0o755);
    expect(existsSync(join(box.home, '.zshrc'))).toBe(false);
    run(box, ['completion', 'uninstall', 'zsh'], { env: { ZDOTDIR: zdotdir } });
    expect(existsSync(join(zdotdir, '.zshrc'))).toBe(true);
  });

  it('leaves an unchanged script in place when only the line moves', () => {
    const box = sandbox();
    const script = scripts.zsh(box);
    run(box, ['completion', 'install', 'zsh']);
    const before = lstatSync(script).ino;
    const zdotdir = join(box.root, 'zdot');
    const result = run(box, ['completion', 'install', 'zsh'], { env: { ZDOTDIR: zdotdir } });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${script} is unchanged.`,
      `Removed the line from ${join(box.home, '.zshrc')}.`,
      `Added a line to ${join(zdotdir, '.zshrc')} that loads it.`,
      'Open a new shell to use it.',
    ]);
    expect(lstatSync(script).ino).toBe(before);
  });

  it('moves the script and its line after XDG_DATA_HOME changes', () => {
    const box = sandbox();
    const old = scripts.zsh(box);
    const startup = join(box.home, '.zshrc');
    run(box, ['completion', 'install', 'zsh']);
    const moved = join(box.root, 'data2');
    const script = join(moved, 'jsonkit', 'completion', 'zsh', '_loom_jsonkit');
    const result = run(box, ['completion', 'install', 'zsh'], { env: { XDG_DATA_HOME: moved } });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the zsh completion script in ${script}.`,
      `Removed ${old}.`,
      `Updated the line in ${startup}.`,
      'Open a new shell to use it.',
    ]);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(script, 'utf8')).toBe(zshInstalledScript('jsonkit'));
    expect(readFileSync(startup, 'utf8')).toBe(`${zshLine(script)}\n`);
    expect(recorded(box, 'zsh').files.map(({ path }) => path)).toEqual([script]);
  });
});

describe('the record against the disk', () => {
  it('rewrites a recorded script someone deleted', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    run(box, ['completion', 'install', 'bash']);
    rmSync(script);
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the bash completion script in ${script}.`,
      `${join(box.home, '.bashrc')} already loads it.`,
      'Open a new shell to use it.',
    ]);
    expect(readFileSync(script, 'utf8')).toBe(printed(box, 'bash'));
  });

  it('resolves a pending plugin’s file whose script and line are in place through the module', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    editRecord(box, 'bash', (file) => {
      file.state = 'pending';
      file.files = [{ intended: digestOf(printed(box, 'bash')), path: script, prior: null }];
      file.lines = [{ intended: bashLine(script), path: startup, prior: null }];
    });
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${script} is unchanged.`,
      `${startup} already loads it.`,
    ]);
    expect(recorded(box, 'bash')).toMatchObject({
      files: [{ path: script }],
      lines: [{ line: bashLine(script), path: startup }],
      state: 'committed',
    });
  });

  it('warns that a moved script someone changed was left in place', () => {
    const box = sandbox();
    const old = scripts.bash(box);
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(old, 'edited\n');
    const moved = join(box.root, 'data2');
    const result = run(box, ['completion', 'install', 'bash'], { env: { XDG_DATA_HOME: moved } });
    expect(result.status).toBe(0);
    const left = `${old} changed since jsonkit completion install wrote it, so it was left in place.`;
    expect(lines(result.stderr)).toContain(left);
    expect(result.stderr.split('\n').find((line) => line.endsWith(left))).toMatch(/^[⚠‼] /u);
    expect(readFileSync(old, 'utf8')).toBe('edited\n');
  });
});

describe('the startup line', () => {
  it('quotes a script path holding single quotes in each shell’s single quotes', () => {
    const curly = [8216, 8217, 8218, 8219].map((code) => String.fromCodePoint(code));
    const doubled = curly.map((quote) => `${quote}${quote}`).join('');
    const script = `/home/o'neil/${curly.join('')}/jsonkit.ps1`;
    const quoted = `'/home/o''neil/${doubled}/jsonkit.ps1'`;
    expect(startupLine({ name: 'jsonkit', platform: 'linux', script, shell: 'pwsh' })).toBe(
      `if (Test-Path -LiteralPath ${quoted}) { . ${quoted} } ${marker}`,
    );
    expect(
      startupLine({ name: 'jsonkit', platform: 'linux', script: "/o'n/x.bash", shell: 'bash' }),
    ).toBe(
      String.raw`if [ -n "${'$'}{BASH_VERSION-}" ] && [ -f '/o'\''n/x.bash' ]; then . '/o'\''n/x.bash'; fi ` +
        marker,
    );
    expect(
      startupLine({ name: 'jsonkit', platform: 'linux', script: "/o'n/z/_x", shell: 'zsh' }),
    ).toBe(
      String.raw`fpath=('/o'\''n/z' $fpath); if [ -f '/o'\''n/z/_x' ]; then . '/o'\''n/z/_x'; fi ` +
        marker,
    );
  });

  it('names the script through LOCALAPPDATA on win32, so the line is ASCII', () => {
    const script = `C:/Users/${String.fromCodePoint(1046)}/AppData/Local/jsonkit/completion/jsonkit.pwsh.ps1`;
    const path = String.raw`"$env:LOCALAPPDATA\jsonkit\completion\jsonkit.pwsh.ps1"`;
    expect(startupLine({ name: 'jsonkit', platform: 'win32', script, shell: 'pwsh' })).toBe(
      `if (Test-Path -LiteralPath ${path}) { . ${path} } ${marker}`,
    );
  });
});

describe('checks', () => {
  it('names HOME when the paths need it and it is not absolute', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install', 'bash'], { env: { HOME: 'relative' } });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'jsonkit cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.',
    ]);
  });

  it('names HOME before the installation record when both need it', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install', 'bash'], {
      env: { HOME: 'relative', XDG_STATE_HOME: undefined },
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'jsonkit cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.',
    ]);
  });

  it('refuses a file in the way before it asks PowerShell for its profile', () => {
    const box = sandbox();
    const script = scripts.pwsh(box);
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, 'mine\n');
    const empty = join(box.root, 'empty');
    mkdirSync(empty);
    const result = run(box, ['completion', 'install', 'pwsh'], { env: { PATH: empty } });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${script} was not installed by jsonkit completion install.`,
      'jsonkit completion install changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install pwsh again.',
    ]);
  });

  it('refuses a file in the way before it judges the startup file', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, 'mine\n');
    mkdirSync(join(box.home, '.bashrc'));
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${script} was not installed by jsonkit completion install.`,
      'jsonkit completion install changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install bash again.',
    ]);
  });

  it('needs no home when absolute variables name every path', () => {
    const box = sandbox();
    const zdotdir = join(box.root, 'zdot');
    const result = run(box, ['completion', 'install', 'zsh'], {
      env: { HOME: 'relative', ZDOTDIR: zdotdir },
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(zdotdir, '.zshrc'))).toBe(true);
  });

  it('refuses a script path holding a control character', () => {
    const box = sandbox();
    const data = join(box.root, 'da\u0007ta');
    const result = run(box, ['completion', 'install', 'bash'], { env: { XDG_DATA_HOME: data } });
    expect(result.status).toBe(1);
    const shown = join(box.root, String.raw`da\u0007ta`, 'jsonkit', 'completion', 'jsonkit.bash');
    expect(lines(result.stderr)).toEqual([
      `The path ${shown} holds a control character, so jsonkit cannot write it into a startup line. Choose a data folder without one.`,
    ]);
    expect(existsSync(data)).toBe(false);
  });

  it('refuses every shell but PowerShell on win32', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install', 'zsh'], {
      env: { LOCALAPPDATA: box.data, USERPROFILE: box.home },
      platform: 'win32',
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'jsonkit completion install installs bash, zsh, and fish completion on Linux and macOS. Print the script with jsonkit completion zsh and load it yourself.',
    ]);
  });

  it('refuses a damaged plugin’s file on install, naming install', () => {
    const box = sandbox();
    mkdirSync(dirname(recordPath(box, 'bash')), { recursive: true });
    writeFileSync(recordPath(box, 'bash'), 'not json');
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${recordPath(box, 'bash')} cannot be read, so jsonkit will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run jsonkit completion install again.`,
    ]);
    expect(readdirSync(box.data)).toEqual([]);
  });
});

describe('files the record does not list', () => {
  it('refuses an unrecorded file at the script’s path for install and changes nothing', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, 'mine\n');
    writeFileSync(join(box.home, '.bashrc'), 'set -o vi\n');
    const before = { ...tree(box.home), ...tree(box.data) };
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${script} was not installed by jsonkit completion install.`,
      'jsonkit completion install changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install bash again.',
    ]);
    expect({ ...tree(box.home), ...tree(box.data) }).toEqual(before);
  });

  it('refuses a recorded script changed since for install and update, and changes nothing', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(script, 'edited\n');
    const before = { ...tree(box.home), ...tree(box.data), ...tree(box.state) };
    const installing = run(box, ['completion', 'install', 'bash']);
    expect(installing.status).toBe(1);
    expect(lines(installing.stderr)).toEqual([
      `${script} changed since jsonkit completion install wrote it.`,
      'jsonkit completion install changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install bash again.',
    ]);
    const updating = run(box, ['completion', 'update']);
    expect(updating.status).toBe(1);
    expect(lines(updating.stderr)).toEqual([
      `${script} changed since jsonkit completion install wrote it.`,
      'jsonkit completion update changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install bash again.',
    ]);
    expect({ ...tree(box.home), ...tree(box.data), ...tree(box.state) }).toEqual(before);
  });

  it('fails update for every shell when one shell’s script was edited', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'bash']);
    run(box, ['completion', 'install', 'zsh']);
    writeFileSync(scripts.zsh(box), 'edited\n');
    // An older script in Bash's file, so an update would otherwise rewrite it.
    writeFileSync(scripts.bash(box), 'old bash\n');
    editRecord(box, 'bash', (file) => {
      file.files = [{ digest: digestOf('old bash\n'), path: scripts.bash(box) }];
    });
    const before = { ...tree(box.home), ...tree(box.data), ...tree(box.state) };
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${scripts.zsh(box)} changed since jsonkit completion install wrote it.`,
      'jsonkit completion update changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install zsh again.',
    ]);
    expect({ ...tree(box.home), ...tree(box.data), ...tree(box.state) }).toEqual(before);
  });
});

describe('a startup file the plugin cannot change', () => {
  it('fails install for a startup file that is a directory and writes nothing', () => {
    const box = sandbox();
    const startup = join(box.home, '.bashrc');
    mkdirSync(startup);
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${startup} is not a file, so jsonkit cannot add its startup line. Remove it, then run jsonkit completion install again.`,
    ]);
    expect(readdirSync(box.data)).toEqual([]);
    expect(readdirSync(box.state)).toEqual([]);
  });

  /** Each way a startup file is one the process may not change, set up before the install. */
  const unchangeable: [string, (box: Box) => string][] = [
    [
      'a file the process may not write',
      (box) => {
        const startup = join(box.home, '.bashrc');
        writeFileSync(startup, 'set -o vi\n');
        chmodSync(startup, 0o444);
        return startup;
      },
    ],
    [
      'a file in a folder the process may not write',
      (box) => {
        const folder = join(box.root, 'locked');
        mkdirSync(folder);
        writeFileSync(join(folder, '.bashrc'), 'set -o vi\n');
        chmodSync(folder, 0o555);
        return join(folder, '.bashrc');
      },
    ],
    [
      'a file in UTF-16BE',
      (box) => {
        const startup = join(box.home, '.bashrc');
        writeFileSync(startup, Buffer.from('feff0073', 'hex'));
        return startup;
      },
    ],
  ];

  it.each(unchangeable)(
    'installs the script for %s, prints the line to add, and records no line',
    (_case, prepare) => {
      const box = sandbox();
      const startup = prepare(box);
      // Bash reads `.bashrc` from the home folder, so a locked folder is reached as the home.
      const home = dirname(startup).includes('locked') ? dirname(startup) : box.home;
      const before = readFileSync(startup).toString('latin1');
      const script = scripts.bash(box);
      const result = run(box, ['completion', 'install', 'bash'], { env: { HOME: home } });
      expect(result.status).toBe(0);
      expect(lines(result.stderr)).toEqual([
        `Installed the bash completion script in ${script}.`,
        `jsonkit cannot change ${startup}, so add this line to it yourself:`,
        'Open a new shell to use it.',
      ]);
      expect(result.stdout).toBe(`${bashLine(script)}\n`);
      expect(readFileSync(startup).toString('latin1')).toBe(before);
      expect(recorded(box, 'bash').lines).toEqual([]);
      expect(existsSync(script)).toBe(true);
    },
  );

  it('installs the script for a startup file the process may not read, prints the line to add, and records no line', () => {
    const box = sandbox();
    const startup = join(box.home, '.bashrc');
    writeFileSync(startup, 'set -o vi\n');
    chmodSync(startup, 0o000);
    const script = scripts.bash(box);
    const result = run(box, ['completion', 'install', 'bash']);
    chmodSync(startup, 0o644);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the bash completion script in ${script}.`,
      `jsonkit cannot change ${startup}, so add this line to it yourself:`,
      'Open a new shell to use it.',
    ]);
    expect(result.stdout).toBe(`${bashLine(script)}\n`);
    expect(readFileSync(startup, 'utf8')).toBe('set -o vi\n');
    expect(recorded(box, 'bash').lines).toEqual([]);
  });

  it('installs the script for a missing startup file below a folder it may not write', () => {
    const box = sandbox();
    const locked = join(box.root, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    const zdotdir = join(locked, 'zdot');
    const result = run(box, ['completion', 'install', 'zsh'], { env: { ZDOTDIR: zdotdir } });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)[1]).toBe(
      `jsonkit cannot change ${join(zdotdir, '.zshrc')}, so add this line to it yourself:`,
    );
    expect(result.stdout).toBe(`${zshLine(scripts.zsh(box))}\n`);
    expect(existsSync(zdotdir)).toBe(false);
  });

  it('judges the folder of the real file a linked startup file names', () => {
    const box = sandbox();
    const dotfiles = join(box.root, 'dotfiles');
    mkdirSync(dotfiles);
    const real = join(dotfiles, 'bashrc');
    writeFileSync(real, 'set -o vi\n');
    chmodSync(dotfiles, 0o555);
    const startup = join(box.home, '.bashrc');
    symlinkSync(real, startup);
    const script = scripts.bash(box);
    const result = run(box, ['completion', 'install', 'bash']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)[1]).toBe(
      `jsonkit cannot change ${startup}, so add this line to it yourself:`,
    );
    expect(result.stdout).toBe(`${bashLine(script)}\n`);
    expect(readFileSync(real, 'utf8')).toBe('set -o vi\n');
  });

  it('reports a line no longer held in a startup file it cannot change, printing nothing to remove', () => {
    const box = sandbox();
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(startup, 'mine\n');
    chmodSync(startup, 0o444);
    const result = run(box, ['completion', 'uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed ${scripts.bash(box)}.`,
      `${startup} no longer holds the line jsonkit completion install added, so it was left as it is.`,
    ]);
    expect(result.stdout).toBe('');
  });

  it('reads a missing permission, a forbidden operation, and a read-only file system as a startup file it cannot change', () => {
    expect(
      ['EACCES', 'EPERM', 'EROFS', 'EIO'].map((code) => deniesWrite(systemError(code))),
    ).toEqual([true, true, true, false]);
  });

  it('judges a file owned by another user off win32 only', () => {
    expect(ownedByAnother({ owner: 0, platform: 'linux', user: 501 })).toBe(true);
    expect(ownedByAnother({ owner: 501, platform: 'linux', user: 501 })).toBe(false);
    expect(ownedByAnother({ owner: 0, platform: 'darwin', user: 501 })).toBe(true);
    expect(ownedByAnother({ owner: 0, platform: 'win32', user: 501 })).toBe(false);
    expect(ownedByAnother({ owner: 0, platform: 'linux', user: undefined })).toBe(false);
  });

  it('uninstalls after the startup file becomes read-only, printing the line to remove', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    chmodSync(startup, 0o444);
    const result = run(box, ['completion', 'uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed ${script}.`,
      `jsonkit cannot change ${startup}, so remove this line from it yourself:`,
    ]);
    expect(result.stdout).toBe(`${bashLine(script)}\n`);
    expect(readFileSync(startup, 'utf8')).toBe(`${bashLine(script)}\n`);
    expect(existsSync(recordPath(box, 'bash'))).toBe(false);
    const again = run(box, ['completion', 'uninstall']);
    expect(again.status).toBe(0);
    expect(lines(again.stderr)).toEqual([
      'jsonkit has no completion installed, so there is nothing to remove.',
    ]);
  });

  it('adds the new line under a new ZDOTDIR and prints the old line to remove from a read-only .zshrc', () => {
    const box = sandbox();
    const script = scripts.zsh(box);
    const old = join(box.home, '.zshrc');
    run(box, ['completion', 'install', 'zsh']);
    chmodSync(old, 0o444);
    const zdotdir = join(box.root, 'zdot');
    const result = run(box, ['completion', 'install', 'zsh'], { env: { ZDOTDIR: zdotdir } });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${script} is unchanged.`,
      `Added a line to ${join(zdotdir, '.zshrc')} that loads it.`,
      `jsonkit cannot change ${old}, so remove this line from it yourself:`,
      'Open a new shell to use it.',
    ]);
    expect(result.stdout).toBe(`${zshLine(script)}\n`);
    expect(readFileSync(join(zdotdir, '.zshrc'), 'utf8')).toBe(`${zshLine(script)}\n`);
    expect(recorded(box, 'zsh').lines).toEqual([
      { line: zshLine(script), path: join(zdotdir, '.zshrc') },
    ]);
  });
});

describe('a recorded line in a startup file the plugin cannot change', () => {
  it('releases the old line and prints the new one in its place when install moves the script', () => {
    const box = sandbox();
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    chmodSync(startup, 0o444);
    const moved = join(box.root, 'data2');
    const script = join(moved, 'jsonkit', 'completion', 'jsonkit.bash');
    const result = run(box, ['completion', 'install', 'bash'], { env: { XDG_DATA_HOME: moved } });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the bash completion script in ${script}.`,
      `Removed ${scripts.bash(box)}.`,
      `jsonkit cannot change ${startup}, so remove this line from it yourself:`,
      `Add this line to ${startup} in its place:`,
      'Open a new shell to use it.',
    ]);
    expect(result.stdout).toBe(`${bashLine(scripts.bash(box))}\n${bashLine(script)}\n`);
    expect(readFileSync(startup, 'utf8')).toBe(`${bashLine(scripts.bash(box))}\n`);
    expect(recorded(box, 'bash').lines).toEqual([]);
  });

  it('keeps a line in a file whose encoding changed for update and install, and releases it on uninstall', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    const bytes = Buffer.concat([
      Buffer.from('feff', 'hex'),
      Buffer.from(bashLine(script), 'utf16le'),
    ]);
    writeFileSync(startup, bytes);
    const updating = run(box, ['completion', 'update']);
    expect(updating.status).toBe(0);
    expect(lines(updating.stderr)).toEqual([`${script} is unchanged.`]);
    expect(updating.stdout).toBe('');
    expect(recorded(box, 'bash').lines).toEqual([{ line: bashLine(script), path: startup }]);
    const installing = run(box, ['completion', 'install', 'bash']);
    expect(installing.status).toBe(0);
    expect(lines(installing.stderr)).toEqual([`${script} is unchanged.`]);
    expect(installing.stdout).toBe('');
    expect(recorded(box, 'bash').lines).toEqual([{ line: bashLine(script), path: startup }]);
    expect(readFileSync(startup)).toEqual(bytes);
    const removing = run(box, ['completion', 'uninstall']);
    expect(removing.status).toBe(0);
    expect(lines(removing.stderr)).toEqual([
      `Removed ${script}.`,
      `jsonkit cannot change ${startup}, so remove this line from it yourself:`,
    ]);
    expect(removing.stdout).toBe(`${bashLine(script)}\n`);
    expect(readFileSync(startup)).toEqual(bytes);
  });

  it('keeps the line in a file it cannot read when update rewrites the script', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(script, 'old bash\n');
    editRecord(box, 'bash', (file) => {
      file.files = [{ digest: digestOf('old bash\n'), path: script }];
    });
    const bytes = Buffer.concat([Buffer.from('# caf', 'latin1'), Buffer.from([0xe9, 0x0a])]);
    writeFileSync(startup, Buffer.concat([Buffer.from(`${bashLine(script)}\n`), bytes]));
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([`Updated the bash completion script in ${script}.`]);
    expect(result.stdout).toBe('');
    expect(recorded(box, 'bash')).toMatchObject({
      lines: [{ line: bashLine(script), path: startup }],
      state: 'committed',
    });
  });
});

describe('update', () => {
  it('rewrites each recorded script at its recorded path, even with XDG_DATA_HOME changed', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'bash']);
    run(box, ['completion', 'install', 'fish']);
    // An earlier version wrote other scripts, which its record lists.
    for (const shell of ['bash', 'fish'] as const) {
      writeFileSync(scripts[shell](box), `old ${shell}\n`);
      editRecord(box, shell, (file) => {
        file.files = [{ digest: digestOf(`old ${shell}\n`), path: scripts[shell](box) }];
      });
    }
    const elsewhere = join(box.root, 'elsewhere');
    const result = run(box, ['completion', 'update'], {
      env: { XDG_CONFIG_HOME: elsewhere, XDG_DATA_HOME: elsewhere },
    });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Updated the bash completion script in ${scripts.bash(box)}.`,
      `Updated the fish completion script in ${scripts.fish(box)}.`,
    ]);
    expect(readFileSync(scripts.bash(box), 'utf8')).toBe(printed(box, 'bash'));
    expect(readFileSync(scripts.fish(box), 'utf8')).toBe(printed(box, 'fish'));
    expect(existsSync(elsewhere)).toBe(false);
  });

  it('reports an up-to-date script unchanged', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'zsh']);
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([`${scripts.zsh(box)} is unchanged.`]);
  });

  it('replaces a line whose text changed where it stands', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    writeFileSync(startup, 'first\n');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(startup, `first\nold line ${marker}\nlast\n`);
    editRecord(box, 'bash', (file) => {
      file.lines = [{ line: `old line ${marker}`, path: startup }];
    });
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${script} is unchanged.`,
      `Updated the line in ${startup}.`,
    ]);
    expect(readFileSync(startup, 'utf8')).toBe(`first\n${bashLine(script)}\nlast\n`);
    expect(recorded(box, 'bash').lines).toEqual([{ line: bashLine(script), path: startup }]);
  });

  it('adds no line the operator removed', () => {
    const box = sandbox();
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(startup, 'mine\n');
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${scripts.bash(box)} is unchanged.`,
      `${startup} no longer holds the line jsonkit completion install added, so it was left as it is.`,
    ]);
    expect(readFileSync(startup, 'utf8')).toBe('mine\n');
    expect(recorded(box, 'bash').lines).toEqual([]);
  });

  it('releases a changed line in a read-only startup file, printing the line to remove and the one to add', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(script, 'old bash\n');
    writeFileSync(startup, `old line ${marker}\n`);
    editRecord(box, 'bash', (file) => {
      file.files = [{ digest: digestOf('old bash\n'), path: script }];
      file.lines = [{ line: `old line ${marker}`, path: startup }];
    });
    chmodSync(startup, 0o444);
    const result = run(box, ['completion', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Updated the bash completion script in ${script}.`,
      `jsonkit cannot change ${startup}, so remove this line from it yourself:`,
      `Add this line to ${startup} in its place:`,
    ]);
    expect(result.stdout).toBe(`old line ${marker}\n${bashLine(script)}\n`);
    expect(readFileSync(script, 'utf8')).toBe(printed(box, 'bash'));
    expect(readFileSync(startup, 'utf8')).toBe(`old line ${marker}\n`);
    expect(recorded(box, 'bash').lines).toEqual([]);
  });

  it('prints the nothing-to lines with nothing recorded', () => {
    const box = sandbox();
    const updating = run(box, ['completion', 'update']);
    expect(updating.status).toBe(0);
    expect(lines(updating.stderr)).toEqual([
      'jsonkit has no completion installed, so there is nothing to update. Run jsonkit completion install to install it.',
    ]);
    const removing = run(box, ['completion', 'uninstall']);
    expect(removing.status).toBe(0);
    expect(lines(removing.stderr)).toEqual([
      'jsonkit has no completion installed, so there is nothing to remove.',
    ]);
    expect(lines(run(box, ['completion', 'uninstall', 'zsh']).stderr)).toEqual([
      'jsonkit has no completion installed, so there is nothing to remove.',
    ]);
  });

  it('leaves a pending file from a first install killed before its script was written for the next install', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const record = recordPath(box, 'bash');
    mkdirSync(dirname(record), { recursive: true });
    const pending = `${JSON.stringify({
      directories: [],
      files: [{ intended: digestOf(printed(box, 'bash')), path: script, prior: null }],
      format: 1,
      lines: [],
      state: 'pending',
    })}\n`;
    writeFileSync(record, pending);
    const updating = run(box, ['completion', 'update']);
    expect(updating.status).toBe(0);
    expect(lines(updating.stderr)).toEqual([
      'jsonkit has no completion installed, so there is nothing to update. Run jsonkit completion install to install it.',
    ]);
    expect(readFileSync(record, 'utf8')).toBe(pending);
    const installing = run(box, ['completion', 'install', 'bash']);
    expect(installing.status).toBe(0);
    expect(recorded(box, 'bash')).toMatchObject({ files: [{ path: script }], state: 'committed' });
  });
});

describe('uninstall', () => {
  it('removes the script, the line, and each created folder, leaving the startup file as it was', () => {
    const box = sandbox();
    const startup = join(box.home, '.zshrc');
    writeFileSync(startup, 'setopt autocd\n');
    run(box, ['completion', 'install', 'zsh']);
    const result = run(box, ['completion', 'uninstall', 'zsh']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed ${scripts.zsh(box)}.`,
      `Removed the line from ${startup}.`,
    ]);
    expect(readFileSync(startup, 'utf8')).toBe('setopt autocd\n');
    expect(readdirSync(box.data)).toEqual([]);
    expect(existsSync(recordPath(box, 'zsh'))).toBe(false);
  });

  it('leaves an edited line and an edited script, stating each', () => {
    const box = sandbox();
    const script = scripts.bash(box);
    const startup = join(box.home, '.bashrc');
    run(box, ['completion', 'install', 'bash']);
    writeFileSync(startup, `${bashLine(script)} # mine\n`);
    writeFileSync(script, 'edited\n');
    const result = run(box, ['completion', 'uninstall', 'bash']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `${script} changed since jsonkit completion install wrote it, so it was left in place.`,
      `${startup} no longer holds the line jsonkit completion install added, so it was left as it is.`,
    ]);
    expect(readFileSync(script, 'utf8')).toBe('edited\n');
    expect(readFileSync(startup, 'utf8')).toBe(`${bashLine(script)} # mine\n`);
  });

  it('states a script already gone', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'fish']);
    rmSync(scripts.fish(box));
    const result = run(box, ['completion', 'uninstall']);
    expect(lines(result.stderr)).toEqual([`${scripts.fish(box)} was already gone.`]);
  });

  it('removes every installed shell with no shell, and only the named one otherwise', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'bash']);
    run(box, ['completion', 'install', 'zsh']);
    const one = run(box, ['completion', 'uninstall', 'zsh']);
    expect(one.status).toBe(0);
    expect(existsSync(scripts.zsh(box))).toBe(false);
    expect(existsSync(scripts.bash(box))).toBe(true);
    expect(readFileSync(join(box.home, '.bashrc'), 'utf8')).toBe(
      `${bashLine(scripts.bash(box))}\n`,
    );
    run(box, ['completion', 'install', 'zsh']);
    const every = run(box, ['completion', 'uninstall']);
    expect(every.status).toBe(0);
    expect(lines(every.stderr)).toEqual([
      `Removed ${scripts.bash(box)}.`,
      `Removed the line from ${join(box.home, '.bashrc')}.`,
      `Removed ${scripts.zsh(box)}.`,
      `Removed the line from ${join(box.home, '.zshrc')}.`,
    ]);
    expect(readdirSync(box.data)).toEqual([]);
  });

  it.each([
    ['zsh', 'bash', 'zsh', 'bash'],
    ['zsh', 'bash', 'bash', 'zsh'],
    ['bash', 'zsh', 'bash', 'zsh'],
    ['bash', 'zsh', 'zsh', 'bash'],
    ['powershell', 'pwsh', 'powershell', 'pwsh'],
    ['powershell', 'pwsh', 'pwsh', 'powershell'],
    ['pwsh', 'powershell', 'pwsh', 'powershell'],
    ['pwsh', 'powershell', 'powershell', 'pwsh'],
  ])(
    'after installing %s then %s, uninstalling %s then %s leaves no folder either created',
    (...order) => {
      const box = sandbox();
      const bin = join(box.root, 'bin');
      for (const name of ['pwsh', 'powershell']) {
        fakePwsh(bin, answerOf(join(box.home, 'profile.ps1'), 'RemoteSigned'), '', name);
      }
      const env = pwshEnv(box, bin);
      for (const [index, shell] of order.entries()) {
        const verb = index < 2 ? 'install' : 'uninstall';
        expect(run(box, ['completion', verb, shell], { env }).status).toBe(0);
      }
      expect(readdirSync(box.data)).toEqual([]);
    },
  );

  it('hands a folder to a shell whose script reaches it through a symbolic link, so uninstalling both leaves no folder', () => {
    const box = sandbox();
    const alias = join(box.root, 'alias');
    symlinkSync(box.data, alias);
    expect(run(box, ['completion', 'install', 'zsh']).status).toBe(0);
    const throughLink = { env: { XDG_DATA_HOME: alias } };
    expect(run(box, ['completion', 'install', 'bash'], throughLink).status).toBe(0);
    expect(run(box, ['completion', 'uninstall', 'zsh']).status).toBe(0);
    expect(run(box, ['completion', 'uninstall', 'bash'], throughLink).status).toBe(0);
    expect(readdirSync(box.data)).toEqual([]);
  });

  it.each([[['completion', 'uninstall']], [['completion', 'uninstall', 'bash']]])(
    '%j deletes a pending file that records nothing and the empty folders it created',
    (argv) => {
      const box = sandbox();
      const script = scripts.bash(box);
      const record = recordPath(box, 'bash');
      const created = [join(box.data, 'jsonkit'), dirname(script)];
      for (const directory of created) {
        mkdirSync(directory);
      }
      mkdirSync(dirname(record), { recursive: true });
      writeFileSync(
        record,
        `${JSON.stringify({
          directories: created,
          files: [{ intended: digestOf(printed(box, 'bash')), path: script, prior: null }],
          format: 1,
          lines: [{ intended: bashLine(script), path: join(box.home, '.bashrc'), prior: null }],
          state: 'pending',
        })}\n`,
      );
      const result = run(box, argv);
      expect(result.status).toBe(0);
      expect(lines(result.stderr)).toEqual([
        'jsonkit has no completion installed, so there is nothing to remove.',
      ]);
      expect(existsSync(record)).toBe(false);
      expect(readdirSync(box.data)).toEqual([]);
    },
  );

  it('fails with no shell and changes nothing when one shell’s plugin’s file is damaged', () => {
    const box = sandbox();
    run(box, ['completion', 'install', 'bash']);
    run(box, ['completion', 'install', 'zsh']);
    writeFileSync(recordPath(box, 'bash'), '{"format":1');
    const before = { ...tree(box.home), ...tree(box.data), ...tree(box.state) };
    const result = run(box, ['completion', 'uninstall']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `${recordPath(box, 'bash')} cannot be read, so jsonkit will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run jsonkit completion uninstall again.`,
    ]);
    expect({ ...tree(box.home), ...tree(box.data), ...tree(box.state) }).toEqual(before);
  });
});

/** A fixture `pwsh`: a shell script that records how it ran and answers the given text. */
function fakePwsh(folder: string, answer: string, extra = '', name = 'pwsh'): string {
  mkdirSync(folder, { recursive: true });
  const program = join(folder, name);
  writeFileSync(
    program,
    `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "$PWSH_LOG"\n${extra}printf '%s\\n' '${answer}'\n`,
  );
  chmodSync(program, 0o755);
  return program;
}

/** The answer PowerShell gives: its profile's path in Base64 of its UTF-8 bytes, and the policy. */
function answerOf(profile: string, policy: string): string {
  return `${Buffer.from(profile, 'utf8').toString('base64')} ${policy}`;
}

/**
 * The variables a PowerShell case runs with: the fixture's folder alone on PATH, so a real pwsh on
 * the runner, such as /usr/bin/pwsh, is never found, and its log.
 */
function pwshEnv(box: Box, bin: string) {
  return { PATH: bin, PWSH_LOG: join(box.root, 'pwsh.log') };
}

/** A profile path under the home whose UTF-8 length leaves the remainder named after division by 3. */
function profileSized(box: Box, remainder: number): string {
  const base = join(box.home, '.ps1');
  const padding = (remainder - (Buffer.byteLength(base) % 3) + 3) % 3;
  return join(box.home, `${'p'.repeat(padding + 3)}.ps1`);
}

describe('PowerShell', () => {
  it('writes the line into the profile PowerShell reports, holding non-ASCII characters', () => {
    const box = sandbox();
    const profile = join(box.home, 'Документы', 'PowerShell', 'Profile.ps1');
    const bin = join(box.root, 'bin');
    fakePwsh(bin, answerOf(profile, 'RemoteSigned'));
    const script = scripts.pwsh(box);
    const result = run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed the pwsh completion script in ${script}.`,
      `Added a line to ${profile} that loads it.`,
      'Open a new shell to use it.',
    ]);
    expect(readFileSync(profile, 'utf8')).toBe(`${powershellLine(script)}\n`);
    expect(readFileSync(script, 'utf8')).toBe(printed(box, 'powershell'));
    expect(readFileSync(join(box.root, 'pwsh.log'), 'utf8')).toBe(
      `${realpathSync(box.home)}\n-NoLogo\n-NoProfile\n-NonInteractive\n-Command\n[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE)) + ' ' + (Get-ExecutionPolicy)\n`,
    );
  });

  it('asks a program named powershell for install powershell', () => {
    const box = sandbox();
    const profile = join(box.home, 'profile.ps1');
    const bin = join(box.root, 'bin');
    fakePwsh(bin, answerOf(profile, 'Unrestricted'), '', 'powershell');
    const script = join(box.data, 'jsonkit', 'completion', 'jsonkit.powershell.ps1');
    const result = run(box, ['completion', 'install', 'powershell'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(0);
    expect(readFileSync(profile, 'utf8')).toBe(`${powershellLine(script)}\n`);
    expect(readFileSync(script, 'utf8')).toBe(printed(box, 'powershell'));
    expect(existsSync(recordPath(box, 'powershell'))).toBe(true);
  });

  it.each([
    [
      'cannot start',
      (box: Box, bin: string) => {
        fakePwsh(bin, 'x');
        chmodSync(join(bin, 'pwsh'), 0o644);
      },
      'jsonkit cannot find the profile of pwsh, because pwsh could not start. Install pwsh, or name the shell you use.',
    ],
    [
      'exits 1',
      (box: Box, bin: string) => {
        fakePwsh(bin, 'x', 'exit 1\n');
      },
      'jsonkit cannot find the profile of pwsh, because pwsh exited with code 1. Install pwsh, or name the shell you use.',
    ],
    [
      'answers a relative path',
      (box: Box, bin: string) => {
        fakePwsh(bin, answerOf('profile.ps1', 'RemoteSigned'));
      },
      `jsonkit cannot find the profile of pwsh, because pwsh reported ${answerOf('profile.ps1', 'RemoteSigned')}. Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile.`,
    ],
  ])('fails when the fixture %s, and writes nothing', (_case, prepare, sentence) => {
    const box = sandbox();
    const bin = join(box.root, 'bin');
    prepare(box, bin);
    const result = run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([sentence]);
    expect(readdirSync(box.data)).toEqual([]);
    expect(readdirSync(box.state)).toEqual([]);
  });

  it.each([
    [
      'Base64 with its padding left off',
      (box: Box) => answerOf(profileSized(box, 1), 'RemoteSigned').replace('==', ''),
    ],
    [
      'Base64 with more than two padding characters',
      (box: Box) => {
        const [encoded = ''] = answerOf(profileSized(box, 0), 'RemoteSigned').split(' ');
        return `${encoded}==== RemoteSigned`;
      },
    ],
    [
      'Base64 of bytes that are not UTF-8',
      (box: Box) => {
        const bytes = Buffer.concat([Buffer.from(`${box.home}/`), Buffer.from([0xff, 0x70])]);
        return `${bytes.toString('base64')} RemoteSigned`;
      },
    ],
    [
      'a path holding a control character',
      (box: Box) => answerOf(join(box.home, `a${String.fromCodePoint(7)}.ps1`), 'RemoteSigned'),
    ],
    [
      'a policy holding a space',
      (box: Box) => answerOf(join(box.home, 'profile.ps1'), 'Remote Signed'),
    ],
  ])('fails when the fixture answers %s, and writes nothing', (_case, answer) => {
    const box = sandbox();
    const bin = join(box.root, 'bin');
    const text = answer(box);
    fakePwsh(bin, text);
    const result = run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `jsonkit cannot find the profile of pwsh, because pwsh reported ${text}. Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile.`,
    ]);
    expect(readdirSync(box.data)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);
  });

  it('reads an answer that ends with a carriage return and a line feed, as PowerShell on win32 writes one', () => {
    const box = sandbox();
    const profile = join(box.home, 'profile.ps1');
    const bin = join(box.root, 'bin');
    const answer = answerOf(profile, 'RemoteSigned');
    fakePwsh(bin, answer, `printf '%s\\r\\n' '${answer}'\nexit 0\n`);
    const result = run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(0);
    expect(readFileSync(profile, 'utf8')).toBe(`${powershellLine(scripts.pwsh(box))}\n`);
  });

  it('ends the query and the run when the run is aborted while PowerShell answers', () => {
    const box = sandbox();
    const bin = join(box.root, 'bin');
    const abortMarker = join(box.root, 'abort');
    fakePwsh(bin, 'x', `: > '${abortMarker}'\nexec /bin/sleep 30\n`);
    const result = run(box, ['completion', 'install', 'pwsh'], {
      abortMarker,
      env: pwshEnv(box, bin),
    });
    expect(result.status).toBe(130);
    expect(result.stderr).not.toContain('exited with code');
    expect(readdirSync(box.data)).toEqual([]);
  });

  it.each([
    ['holds no pwsh', (folder: string) => mkdirSync(folder)],
    [
      'holds a pwsh the process may not run',
      (folder: string) => {
        fakePwsh(folder, 'x');
        chmodSync(join(folder, 'pwsh'), 0o644);
      },
    ],
    [
      'is a folder the process may not search',
      (folder: string) => {
        mkdirSync(folder);
        chmodSync(folder, 0o000);
      },
    ],
  ])('runs the pwsh of a later PATH entry when an earlier one %s', (_case, prepare) => {
    const box = sandbox();
    const profile = join(box.home, 'profile.ps1');
    const earlier = join(box.root, 'earlier');
    prepare(earlier);
    const bin = join(box.root, 'bin');
    fakePwsh(bin, answerOf(profile, 'RemoteSigned'));
    const env = { ...pwshEnv(box, bin), PATH: `${earlier}:${bin}` };
    const result = run(box, ['completion', 'install', 'pwsh'], { env });
    expect(result.status).toBe(0);
    expect(readFileSync(profile, 'utf8')).toBe(`${powershellLine(scripts.pwsh(box))}\n`);
  });

  it.each(['Restricted', 'AllSigned'])(
    'installs the script under %s, prints the policy sentence and the line, and records no line',
    (policy) => {
      const box = sandbox();
      const profile = join(box.home, 'profile.ps1');
      const bin = join(box.root, 'bin');
      fakePwsh(bin, answerOf(profile, policy));
      const script = scripts.pwsh(box);
      const result = run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
      expect(result.status).toBe(0);
      expect(lines(result.stderr)).toEqual([
        `Installed the pwsh completion script in ${script}.`,
        `PowerShell's execution policy is ${policy}, so it runs no unsigned profile or script, and jsonkit did not add its startup line. To use completion, allow local scripts, such as with Set-ExecutionPolicy -Scope CurrentUser RemoteSigned where no Group Policy sets the policy, then add this line to ${profile}:`,
        'Open a new shell to use it.',
      ]);
      expect(result.stdout).toBe(`${powershellLine(script)}\n`);
      expect(existsSync(profile)).toBe(false);
      expect(recorded(box, 'pwsh').lines).toEqual([]);
    },
  );

  it('removes the line after the policy changes to Restricted, running no shell', () => {
    const box = sandbox();
    const profile = join(box.home, 'profile.ps1');
    const bin = join(box.root, 'bin');
    fakePwsh(bin, answerOf(profile, 'RemoteSigned'));
    run(box, ['completion', 'install', 'pwsh'], { env: pwshEnv(box, bin) });
    fakePwsh(bin, answerOf(profile, 'Restricted'));
    rmSync(join(box.root, 'pwsh.log'));
    const result = run(box, ['completion', 'uninstall'], { env: pwshEnv(box, bin) });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed ${scripts.pwsh(box)}.`,
      `Removed the line from ${profile}.`,
    ]);
    expect(readFileSync(profile, 'utf8')).toBe('');
    expect(existsSync(join(box.root, 'pwsh.log'))).toBe(false);
  });

  // The absolute entry is an empty folder, so a real pwsh on the runner, such as /usr/bin/pwsh, is never found.
  // The process and its host run from the home folder, where PowerShell's query runs too.
  // An empty PATH entry names the working directory, and a relative one a folder under it.
  it.each([
    [
      'in the working directory',
      (box: Box, empty: string) => ({ PATH: `${empty}${delimiter}`, folder: box.home }),
    ],
    [
      'under a relative PATH entry',
      (box: Box, empty: string) => ({
        PATH: `bin${delimiter}${empty}`,
        folder: join(box.home, 'bin'),
      }),
    ],
  ])('never runs a fixture pwsh %s', (_case, place) => {
    const box = sandbox();
    const empty = join(box.root, 'empty');
    mkdirSync(empty);
    const { PATH, folder } = place(box, empty);
    fakePwsh(folder, answerOf(join(box.home, 'profile.ps1'), 'RemoteSigned'));
    const log = join(box.root, 'pwsh.log');
    const result = run(box, ['completion', 'install', 'pwsh'], {
      cwd: box.home,
      env: { PATH, PWSH_LOG: log },
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'jsonkit cannot find the profile of pwsh, because pwsh could not start. Install pwsh, or name the shell you use.',
    ]);
    expect(existsSync(log)).toBe(false);
  });

  it.each([
    [
      String.raw`C:\Users\me\Documents\PowerShell\Modules;C:\Program Files\PowerShell\Modules`,
      'pwsh',
    ],
    [
      String.raw`C:\Users\me\Documents\WindowsPowerShell\Modules;C:\Windows\system32\WindowsPowerShell\v1.0\Modules`,
      'powershell',
    ],
    [String.raw`c:\program files\powershell\modules`, 'pwsh'],
    [String.raw`C:\Program Files\PowerShell\Modules\;C:\Windows\Modules`, 'pwsh'],
  ])('selects the shell on win32 with SHELL unset from PSModulePath %s', (modulePath, shell) => {
    const box = sandbox();
    const result = run(box, ['completion', 'install'], {
      env: { LOCALAPPDATA: box.data, PSModulePath: modulePath, USERPROFILE: box.home },
      platform: 'win32',
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      `jsonkit cannot find the profile of ${shell}, because ${shell} could not start. Install ${shell}, or name the shell you use.`,
    ]);
  });
});

describe('the shell SHELL names', () => {
  it('reads the last segment of a SHELL split at backslashes', () => {
    const box = sandbox();
    const result = run(box, ['completion', 'install'], {
      env: {
        LOCALAPPDATA: box.data,
        SHELL: String.raw`C:\Program Files\PowerShell\7\pwsh`,
        USERPROFILE: box.home,
      },
      platform: 'win32',
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'jsonkit cannot find the profile of pwsh, because pwsh could not start. Install pwsh, or name the shell you use.',
    ]);
  });
});
