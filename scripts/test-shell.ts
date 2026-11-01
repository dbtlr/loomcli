import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll } from 'vite-plus/test';

import { childEnvironment } from './test-process.js';

/**
 * The shells the completion scripts support: Bash, Fish, and Zsh driven through a pseudo-terminal,
 * and PowerShell answering through `TabExpansion2`, the function its Tab calls.
 */
const shells = ['bash', 'fish', 'zsh', 'pwsh'] as const;
type Shell = (typeof shells)[number];

/** The shells the harness drives through a pseudo-terminal. */
type TerminalShell = Exclude<Shell, 'pwsh'>;

/**
 * What one Tab did: the command line after it, the words the shell listed, and the listing as the
 * shell showed it, descriptions included.
 */
interface Completed {
  line: string;
  listed: string[];
  listing: string;
}

/** An interactive shell with an application's completion script sourced. */
interface Session {
  /** Types the line, presses Tab, and reads the line back without running it. */
  complete: (line: string) => Promise<Completed>;
  close(): Promise<void>;
  /** What the shell printed before its first prompt, as plain text; empty for PowerShell. */
  startup: string;
}

interface SessionOptions {
  shell: Shell;
  /** The application name, which is also the wrapper executable's name on PATH. */
  name: string;
  /** The built application entry the wrapper runs with the test runtime. */
  main: URL;
  /** The session's working directory, which a test owns. */
  cwd: string;
  /**
   * What the program does once the script is printed: `exits nonzero` replaces it with one that
   * exits 1, `prints a bare colon` with one that answers `:` and no directive digits, and
   * `records its words` with one that writes each word it received on a line of `received` in the
   * working directory and offers nothing.
   */
  callback?: 'answers' | 'exits nonzero' | 'prints a bare colon' | 'records its words';
  /** Files the shell sources before the script, such as the bash-completion package. */
  sources?: readonly string[];
  /**
   * A Zsh file to load in place of the printed script, named `file` in a folder of its own, the
   * way the startup line `completion install` adds loads it: the folder put on `fpath` and the file
   * sourced, with no `compinit` run before it.
   */
  installed?: { file: string; text: string };
  /** Executables written beside the program on PATH, each name with the `sh` body it runs. */
  programs?: Readonly<Record<string, string>>;
  /** PowerShell statements run before the script is dot-sourced, such as a preference. */
  before?: readonly string[];
  /**
   * A home folder the test owns and keeps, whose startup files load the script in place of the
   * harness: the shell starts as an operator's does and reads them itself, Bash as a login shell on
   * `darwin` and an interactive one elsewhere, Zsh from `ZDOTDIR` set to the home without the
   * system's files, Fish with its configuration folder under the home, and PowerShell dot-sourcing
   * `$PROFILE`. The harness then sources only its prompt and read-back lines.
   */
  home?: string;
}

/** Whether a shell's cases run, and the suite title that says why they skip when they do not. */
interface ShellSuite {
  shell: Shell;
  installed: boolean;
  /** Files each session sources before the script, which the suite's cases pass to `useSession`. */
  sources: readonly string[];
  title: string;
}

/** Where Linux distributions install the bash-completion package's entry file. */
const bashCompletionFiles = ['/usr/share/bash-completion/bash_completion', '/etc/bash_completion'];

/** The Bash 3.2 macOS ships, which a Mac session prefers so the no-`compopt` path is proven. */
const systemBash = '/bin/bash';

const driver = fileURLToPath(new URL('zpty-driver.zsh', import.meta.url));

/** How long one step may take before the harness ends the session; the driver gives up at 15 s. */
const stepTimeout = 25_000;
const prompt = '@@PROMPT@@';
const readback = '@@LINE@@';

/** The runtime the wrapper runs, as an absolute path: `LOOM_TEST_RUNTIME`, Node by default. */
function runtimePath(): string {
  const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
  if (runtime === 'node' && !process.versions.bun) {
    return process.execPath;
  }
  const found = findOnPath(runtime);
  if (found === undefined) {
    throw new Error(`The test runtime ${runtime} is not on PATH.`);
  }
  return found;
}

/** A string single-quoted for sh, Bash, Zsh, and Fish alike when it holds no `'` or `\`. */
function quoted(text: string): string {
  if (/['\\]/u.test(text)) {
    throw new Error(`The test path ${text} holds a quote or a backslash.`);
  }
  return `'${text}'`;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** The script a harness setup file loads, which a session started from a real home leaves out. */
interface Load {
  script: string;
  installed: SessionOptions['installed'];
}

/** The lines that load the script: an installed Zsh file the way its startup line loads it. */
function loadLines(shell: TerminalShell, load: Load | undefined): string[] {
  if (load === undefined) {
    return [];
  }
  const { installed, script } = load;
  if (shell !== 'zsh') {
    return [`source ${quoted(script)}`];
  }
  // An installed file starts the completion system itself, as its startup line loads it.
  return installed === undefined
    ? ['autoload -U compinit', 'compinit -u -D', `source ${quoted(script)}`]
    : [
        `fpath=(${quoted(dirname(script))} $fpath)`,
        `if [ -f ${quoted(script)} ]; then . ${quoted(script)}; fi`,
      ];
}

/**
 * The lines a shell sources before the first Tab: a fixed prompt, a wide list, a read-back on
 * Ctrl-] that prints the line after `@@LINE@@` without running it, and the script's load lines.
 * Each read-back splits the marker in the text it echoes, so only its output matches.
 */
function setupLines(shell: TerminalShell, load: Load | undefined): string[] {
  switch (shell) {
    case 'bash': {
      return [
        `PS1=${quoted(prompt)}`,
        'stty cols 200',
        "bind 'set show-all-if-ambiguous on'",
        "bind 'set page-completions off'",
        "bind 'set completion-query-items -1'",
        "bind 'set bell-style none'",
        // Bash 3.2 exposes no line to a key binding.
        // The line is commented out, run, and read back from history.
        String.raw`__loom_readback() { printf '%s%s\n' '@@LI''NE@@' "$(fc -ln -1)"; }`,
        String.raw`bind '"\C-]": "\C-a#\C-m__loom_readback\C-m"'`,
        ...loadLines(shell, load),
      ];
    }
    case 'zsh': {
      return [
        `PS1=${quoted(prompt)}`,
        'unset zle_bracketed_paste',
        'setopt no_beep no_prompt_sp',
        'stty cols 200',
        "zstyle ':completion:*' menu no",
        // The replaced line expands the saved line when it runs, so nothing in it is parsed.
        `__loom_readback() { __loom_line=$BUFFER; BUFFER='print -r -- @@LI""NE@@$__loom_line'; zle accept-line; }`,
        'zle -N __loom_readback',
        "bindkey '^]' __loom_readback",
        ...loadLines(shell, load),
      ];
    }
    case 'fish': {
      return [
        "function fish_prompt; printf '%s' '@@PRO''MPT@@'; end",
        'function __loom_readback',
        String.raw`    commandline -r "printf '%s\n' @@LI''NE@@"(string escape -- (commandline | string collect))`,
        '    commandline -f execute',
        'end',
        String.raw`bind \x1d __loom_readback`,
        ...loadLines(shell, load),
      ];
    }
    default: {
      throw new Error('Unreachable.');
    }
  }
}

/** The shell's executable: on macOS the system Bash when it exists, else the first on PATH. */
function shellPath(shell: Shell): string | undefined {
  if (shell === 'bash' && process.platform === 'darwin' && existsSync(systemBash)) {
    return systemBash;
  }
  return findOnPath(shell);
}

/**
 * The command line that starts each shell interactively, without reading its startup files, or,
 * for a session started from a real home, reading the ones an operator's shell reads: Bash's login
 * files on `darwin`, where a terminal starts a login shell, and `.bashrc` elsewhere, Zsh's own
 * files without the system's, which may run `compinit` themselves, and Fish's whole configuration.
 */
function shellCommand(shell: TerminalShell, setup: string, ownStartup: boolean): string[] {
  const path = shellPath(shell) ?? shell;
  switch (shell) {
    case 'bash': {
      if (!ownStartup) {
        return [path, '--noprofile', '--norc', '-i'];
      }
      return process.platform === 'darwin' ? [path, '--login', '-i'] : [path, '-i'];
    }
    case 'zsh': {
      return [path, ownStartup ? '-d' : '-f', '-i'];
    }
    case 'fish': {
      const config = ownStartup ? [] : ['--no-config'];
      return [path, ...config, '-i', '-C', `source ${quoted(setup)}`];
    }
    default: {
      throw new Error('Unreachable.');
    }
  }
}

/**
 * One `send` step: the text with its backslashes doubled, so the driver's escape decoding restores
 * them, followed by keys written as the driver's escapes, such as `\t` for Tab.
 */
function send(text: string, keys = ''): string {
  if (/[\n\r]/u.test(text)) {
    throw new Error('A typed line holds no line break.');
  }
  return `send ${text.replaceAll('\\', String.raw`\\`)}${keys}`;
}

/** A terminal control sequence: escape, `[`, parameters, and a final letter. */
const controlSequence = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;?]*[A-Za-z]`, 'gu');

/** Removes terminal control sequences, backspaces, and carriage returns from captured output. */
function plain(text: string): string {
  return text.replaceAll(controlSequence, '').replaceAll(/[\b\r]/gu, '');
}

/**
 * The words a Bash or Zsh listing printed below the line: the lines between the typed line and
 * the redrawn prompt or the read-back. Columns are separated by two or more spaces; a Bash
 * `(description)` and a Zsh `-- description` are dropped.
 */
function listedWords(listing: string): string[] {
  return listing
    .split('\n')
    .map((line) => line.replace(/ -- .*$/u, '').trim())
    .flatMap((line) => line.split(/\s{2,}/u))
    .filter((word) => word !== '' && !/^\(.*\)$/u.test(word));
}

/** The lines a Bash or Zsh listing printed below the line, as plain text. */
function listingLines(block: string): string {
  const lines = block.split('\n').slice(1);
  const end = lines.findIndex((line) => line.includes(prompt) || line.includes(readback));
  return (end === -1 ? lines : lines.slice(0, end)).map((line) => plain(line)).join('\n');
}

/** The line the read-back printed after the marker; Bash's comes back from history behind a `#`. */
function readLine(shell: TerminalShell, block: string): string {
  const line = [...block.matchAll(/@@LINE@@(?<line>[^\n\r]*)/gu)].at(-1)?.groups?.line;
  if (line === undefined) {
    throw new Error(`The read-back printed no line:\n${block}`);
  }
  return shell === 'bash' ? line.replace(/^\s*#/u, '') : line;
}

/**
 * What Fish would list for the line, from `complete -C` in a separate Fish: word, tab, text. That
 * Fish sources the script, or, with no script, reads its configuration and finds the script in its
 * completions folder itself, as the session's Fish does.
 */
function fishListing(
  line: string,
  script: string | undefined,
  cwd: string,
  env: Record<string, string | undefined>,
): string {
  const words =
    script === undefined
      ? ['-c', 'complete -C $argv[1]', line]
      : ['--no-config', '-c', 'source $argv[1]; complete -C $argv[2]', script, line];
  const result = spawnSync('fish', words, { cwd, encoding: 'utf8', env, timeout: stepTimeout });
  if (result.status !== 0) {
    throw new Error(`fish complete -C failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

/** The words of a Fish listing: each line up to its tab. */
function fishWords(listing: string): string[] {
  return listing
    .split('\n')
    .filter((entry) => entry !== '')
    .map((entry) => entry.split('\t')[0] ?? entry);
}

/**
 * Whether a shell's cases can run: the shell is installed, and so is zsh, which runs the driver for
 * every shell but PowerShell. A missing shell skips its cases, unless `LOOM_REQUIRE_SHELLS` is set,
 * when it fails the suite.
 */
function shellSuite(shell: Shell): ShellSuite {
  const needed: Shell[] = shell === 'pwsh' ? [shell] : [shell, 'zsh'];
  const missing = [...new Set(needed)].filter((command) => shellPath(command) === undefined);
  if (missing.length === 0) {
    return { installed: true, shell, sources: [], title: shell };
  }
  return skipped(shell, shell, `${missing.join(' and ')} not installed`);
}

/** A suite whose cases skip, or a failure when `LOOM_REQUIRE_SHELLS` requires them. */
function skipped(shell: Shell, title: string, reason: string): ShellSuite {
  if (process.env.LOOM_REQUIRE_SHELLS) {
    throw new Error(`LOOM_REQUIRE_SHELLS is set, but ${reason}.`);
  }
  console.warn(`Skipping the ${title} completion cases: ${reason}.`);
  return { installed: false, shell, sources: [], title: `${title} (skipped: ${reason})` };
}

/**
 * The Bash suite with the bash-completion package sourced first, so the script's
 * `_init_completion` and `_filedir` paths run. Linux CI installs the package, so there
 * `LOOM_REQUIRE_SHELLS` requires it; elsewhere a missing package skips the suite.
 */
function bashCompletionSuite(bash: ShellSuite): ShellSuite {
  const title = 'bash with bash-completion';
  const file = bashCompletionFiles.find((candidate) => existsSync(candidate));
  if (!bash.installed || file === undefined) {
    const reason = bash.installed ? 'bash-completion not installed' : 'bash not installed';
    return process.platform === 'linux'
      ? skipped('bash', title, reason)
      : { installed: false, shell: 'bash', sources: [], title: `${title} (skipped: ${reason})` };
  }
  return { installed: true, shell: 'bash', sources: [file], title };
}

/** Every shell's suite, in the order `shells` lists them, the bash-completion variant after Bash. */
function shellSuites(): ShellSuite[] {
  return shells.flatMap((shell) => {
    const suite = shellSuite(shell);
    return shell === 'bash' ? [suite, bashCompletionSuite(suite)] : [suite];
  });
}

/** The program a session completes, and the script the shell loads for it. */
interface Prepared {
  /** The session's temporary folder, which `close` removes. */
  root: string;
  env: Record<string, string | undefined>;
  /** The path of the file holding the script the harness loads, none when the home's files load it. */
  script: string | undefined;
}

/** The print child each shell's script comes from; both PowerShell editions run `powershell`'s. */
const printChild: Record<Shell, string> = {
  bash: 'bash',
  fish: 'fish',
  pwsh: 'powershell',
  zsh: 'zsh',
};

/** Zsh's own `fpath` without its insecure folders, once read, and whether it has been read. */
const auditedFpath: { read: boolean; value: string | undefined } = {
  read: false,
  value: undefined,
};

/**
 * Zsh's own `fpath` without each folder `compaudit` judges insecure, joined as `FPATH` spells it, or
 * none when zsh is not installed.
 * It is read once per run from a bare `zsh -f` under a temporary home, which it removes.
 * A runner's zsh may hold a system folder `compaudit` judges insecure, which makes an operator's
 * plain `compinit` ask before any line runs.
 * A session started from a real home starts Zsh with this `fpath`, so the case models an operator
 * whose system folders are secure, and only a folder Loom or the case adds can make `compinit` ask.
 */
function secureFpath(): string | undefined {
  if (auditedFpath.read) {
    return auditedFpath.value;
  }
  const home = mkdtempSync(join(tmpdir(), 'loom-compaudit-'));
  try {
    const audit = spawnSync(
      'zsh',
      [
        '-f',
        '-c',
        'autoload -Uz +X compaudit || exit 1; for folder in $fpath; do compaudit $folder >/dev/null 2>&1 && print -r -- $folder; done; exit 0',
      ],
      {
        encoding: 'utf8',
        env: childEnvironment({
          HOME: home,
          XDG_CACHE_HOME: join(home, '.cache'),
          XDG_CONFIG_HOME: join(home, '.config'),
          XDG_DATA_HOME: join(home, '.local', 'share'),
          XDG_STATE_HOME: join(home, '.local', 'state'),
          ZDOTDIR: home,
        }),
        timeout: stepTimeout,
      },
    );
    auditedFpath.read = true;
    auditedFpath.value =
      audit.status === 0
        ? audit.stdout
            .split('\n')
            .filter((folder) => folder !== '')
            .join(':')
        : undefined;
    return auditedFpath.value;
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}

/**
 * The environment a session's shell and program run in: the home and every XDG folder under it,
 * `bin` first on PATH when given, and a fixed prompt. A real home is also `ZDOTDIR`, so Zsh reads
 * the home's `.zshrc`, and a Bash prompt command restores the prompt the system's startup files set.
 * Zsh started from a real home also starts with only the secure folders of its own `fpath`.
 */
function sessionEnvironment(
  home: string,
  bin: string | undefined,
  realHome: boolean,
): Record<string, string | undefined> {
  const path = process.env.PATH ?? '';
  const fpath = realHome ? secureFpath() : undefined;
  return childEnvironment({
    ...(fpath === undefined ? {} : { FPATH: fpath }),
    BASH_COMP_DEBUG_FILE: undefined,
    BASH_ENV: undefined,
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    COLUMNS: '200',
    ENV: undefined,
    // Fish's detached man-page completion generator can write into the home after teardown starts.
    FISH_UNIT_TESTS_RUNNING: '1',
    HISTFILE: '',
    HOME: home,
    PATH: bin === undefined ? path : `${bin}${delimiter}${path}`,
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    POWERSHELL_UPDATECHECK: 'Off',
    PROMPT_COMMAND: realHome ? `PS1=${prompt}` : undefined,
    PS1: prompt,
    SHELL: undefined,
    TERM: 'dumb',
    TERM_PROGRAM: undefined,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    ZDOTDIR: realHome ? home : undefined,
  });
}

/**
 * Writes the script the harness loads into the session's folder: the one the program prints, or
 * the given installed file in a folder of its own. Answers its path, and removes the folder when
 * the program fails to print the script.
 */
function writeScript(options: SessionOptions, prepared: Omit<Prepared, 'script'>): string {
  const { cwd, installed, name, shell } = options;
  const { env, root } = prepared;
  if (installed !== undefined) {
    mkdirSync(join(root, 'completion'));
    const script = join(root, 'completion', installed.file);
    writeFileSync(script, installed.text);
    return script;
  }
  // PowerShell dot-sources only a file named .ps1 and hands any other to the desktop's opener.
  const script = join(root, shell === 'pwsh' ? 'script.ps1' : `script.${shell}`);
  const printed = spawnSync(join(root, 'bin', name), ['completion', printChild[shell]], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: stepTimeout,
  });
  if (printed.status !== 0) {
    rmSync(root, { force: true, recursive: true });
    throw new Error(`${name} completion ${shell} failed:\n${printed.stdout}${printed.stderr}`);
  }
  writeFileSync(script, printed.stdout);
  return script;
}

/**
 * Writes the program's wrapper on PATH, which runs `main` with the test runtime, under a temporary
 * home or the test's real one, and, without a real home, the script the harness loads. Then it
 * replaces the program as `callback` asks.
 */
function prepareProgram(options: SessionOptions): Prepared {
  const { name, main } = options;
  const root = mkdtempSync(join(tmpdir(), 'loom-shell-'));
  const bin = join(root, 'bin');
  const home = options.home ?? join(root, 'home');
  mkdirSync(bin);
  mkdirSync(home, { recursive: true });
  const program = join(bin, name);
  writeExecutable(program, `exec ${quoted(runtimePath())} ${quoted(fileURLToPath(main))} "$@"`);
  for (const [file, body] of Object.entries(options.programs ?? {})) {
    writeExecutable(join(bin, file), body);
  }
  const env = sessionEnvironment(home, bin, options.home !== undefined);
  const script = options.home === undefined ? writeScript(options, { env, root }) : undefined;
  if (options.callback === 'exits nonzero') {
    writeExecutable(program, 'exit 1');
  } else if (options.callback === 'prints a bare colon') {
    writeExecutable(program, String.raw`printf ':\n'`);
  } else if (options.callback === 'records its words') {
    writeExecutable(program, String.raw`printf '%s\n' "$@" > received; printf ':4\n'`);
  }
  return { env, root, script };
}

/** The environment a session started from a real home runs in, with the parent's PATH. */
function homeEnvironment(home: string): Record<string, string | undefined> {
  return sessionEnvironment(home, undefined, true);
}

/** What `runInHome` runs: the program's entry and words, from a working directory, under a umask. */
interface HomeRun {
  /** The home folder the test owns, which a session later starts from. */
  home: string;
  /** The built application entry, run with the test runtime. */
  main: URL;
  args: readonly string[];
  cwd: string;
  /** The umask the program runs under, as octal digits such as `002`; the parent's by default. */
  umask?: string;
}

/**
 * Runs the program as an operator does before starting a shell, such as `completion install`,
 * with the environment a session started from the same home runs in.
 */
function runInHome(run: HomeRun): SpawnSyncReturns<string> {
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: run.cwd,
    encoding: 'utf8',
    env: homeEnvironment(run.home),
    timeout: stepTimeout,
  };
  const words = [fileURLToPath(run.main), ...run.args];
  if (run.umask === undefined) {
    return spawnSync(runtimePath(), words, options);
  }
  const umasked = ['-c', 'umask "$1" && shift && exec "$@"', 'sh', run.umask, runtimePath()];
  return spawnSync('/bin/sh', [...umasked, ...words], options);
}

/** One `CompletionResult` as the PowerShell session reports it. */
interface PowerShellMatch {
  text: string;
  tip: string;
}

/** What `TabExpansion2` answered: the span of the line its matches replace, and the matches. */
interface PowerShellCompletion {
  index: number;
  length: number;
  matches: PowerShellMatch[];
}

/**
 * The statements a PowerShell session runs for one Tab: the `before` statements, the script
 * dot-sourced, or with no script the profile, as PowerShell loads it at its start, and
 * `TabExpansion2` for the line with the cursor at its end, reported as JSON. The line and the
 * script's path arrive through the environment, so neither is read as source.
 */
function powershellCommand(before: readonly string[], script: string | undefined): string {
  return [
    ...before,
    script === undefined ? '. $PROFILE' : '. $env:LOOM_TEST_SCRIPT',
    '$Line = $env:LOOM_TEST_LINE',
    // The script declines with an empty string, as Cobra's does, so no file names are listed.
    // CompleteInput throws for that empty text, which PSReadLine swallows and inserts nothing.
    // So the session reads that one exception as no matches.
    'try { $Completion = TabExpansion2 -inputScript $Line -cursorColumn $Line.Length }',
    'catch {',
    '  $Inner = $_.Exception.InnerException',
    "  if (-not ($Inner -is [System.ArgumentNullException] -and $Inner.ParamName -eq 'completionText')) { throw }",
    '  $Completion = $null',
    '}',
    'if ($null -eq $Completion) { $Report = @{ index = $Line.Length; length = 0; matches = @() } }',
    'else {',
    '  $Found = @($Completion.CompletionMatches | ForEach-Object { @{ text = $_.CompletionText; tip = $_.ToolTip } })',
    '  $Report = @{ index = $Completion.ReplacementIndex; length = $Completion.ReplacementLength; matches = $Found }',
    '}',
    '[Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 -EscapeHandling EscapeNonAscii -InputObject $Report))',
  ].join('\n');
}

/** One string member of a parsed JSON object, or a failure naming the whole report. */
function reportString(value: unknown, key: string, report: string): string {
  const member: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  if (typeof member !== 'string') {
    throw new Error(`pwsh reported ${report}`);
  }
  return member;
}

/** Reads the session's JSON report through one typed accessor, so a malformed one fails the case. */
function powershellCompletion(report: string): PowerShellCompletion {
  const parsed: unknown = JSON.parse(report);
  const member = (key: string): unknown =>
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, key) : undefined;
  const index = member('index');
  const length = member('length');
  const matches = member('matches');
  if (typeof index !== 'number' || typeof length !== 'number' || !Array.isArray(matches)) {
    throw new Error(`pwsh reported ${report}`);
  }
  return {
    index,
    length,
    matches: matches.map((match: unknown) => ({
      text: reportString(match, 'text', report),
      tip: reportString(match, 'tip', report),
    })),
  };
}

/**
 * Runs one `pwsh` completion. A pwsh start that stalls under load is killed by the timeout with
 * no output and no status (CI run 41002731816 failed that way after the full step timeout). A
 * normal run takes well under a second, so a stalled start is retried once, with two attempts
 * fitting inside one test's timeout; any other failure is the program's answer and is not retried.
 */
function runPowershell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  const attempt = (): SpawnSyncReturns<string> =>
    spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      encoding: 'utf8',
      env,
      timeout: stepTimeout / 2,
    });
  const first = attempt();
  // A timeout of spawnSync reports ETIMEDOUT however the child ended, by a signal or a status.
  const timedOut =
    first.error !== undefined && 'code' in first.error && first.error.code === 'ETIMEDOUT';
  return timedOut ? attempt() : first;
}

/**
 * A PowerShell session: each Tab starts `pwsh -NoProfile -NonInteractive -Command`, which
 * dot-sources the printed script, or the real home's profile, and asks `TabExpansion2` for the
 * line. A sole match replaces the span it names, as Tab inserts it; with none or several, the line
 * stays as it was typed.
 */
function openPowerShellSession(options: SessionOptions): Session {
  const { cwd } = options;
  const { env, root, script } = prepareProgram(options);
  const command = powershellCommand(options.before ?? [], script);
  const complete = async (line: string): Promise<Completed> => {
    const result = runPowershell(command, cwd, {
      ...env,
      LOOM_TEST_LINE: line,
      LOOM_TEST_SCRIPT: script,
    });
    if (result.status !== 0 || result.stderr !== '') {
      const ended = `status ${String(result.status)}, signal ${String(result.signal)}, error ${String(result.error?.message)}`;
      throw new Error(`pwsh TabExpansion2 failed (${ended}):\n${result.stdout}${result.stderr}`);
    }
    const { index, length, matches } = powershellCompletion(result.stdout);
    const [sole] = matches;
    const completed =
      matches.length === 1 && sole !== undefined
        ? `${line.slice(0, index)}${sole.text}${line.slice(index + length)}`
        : line;
    return await Promise.resolve({
      line: completed,
      listed: matches.map((match) => match.text),
      listing: matches.map((match) => `${match.text}\t${match.tip}`).join('\n'),
    });
  };
  const close = async (): Promise<void> => {
    rmSync(root, { force: true, recursive: true });
    await Promise.resolve();
  };
  return { close, complete, startup: '' };
}

/**
 * Starts the program's completion session: a wrapper on PATH that runs `main` with the test
 * runtime, and the script it prints sourced into an interactive shell under the driver, or, for
 * PowerShell, dot-sourced by each Tab's `pwsh`. A session started from a real home loads nothing
 * itself and leaves the home in place when it closes.
 */
async function openSession(options: SessionOptions): Promise<Session> {
  const { cwd, shell } = options;
  if (shell === 'pwsh') {
    return openPowerShellSession(options);
  }
  const { env, root, script } = prepareProgram(options);
  const setup = join(root, `setup.${shell}`);
  const sourced = (options.sources ?? []).map((file) => `source ${quoted(file)}`);
  const load = script === undefined ? undefined : { installed: options.installed, script };
  writeFileSync(setup, `${[...sourced, ...setupLines(shell, load)].join('\n')}\n`);

  const ownStartup = options.home !== undefined;
  const child = spawn('zsh', [driver, ...shellCommand(shell, setup, ownStartup)], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let exited = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });
  const exit = new Promise<void>((resolve) => {
    child.on('close', () => {
      exited = true;
      resolve();
    });
  });

  /** Sends the steps and resolves with the output through the expected pattern. */
  const step = async (steps: string[], pattern: string): Promise<string> => {
    child.stdin.write(`${[...steps, `expect ${pattern}`].join('\n')}\n`);
    const deadline = Date.now() + stepTimeout;
    for (;;) {
      const begin = output.indexOf('@@BEGIN@@\n');
      const end = output.indexOf('@@END@@\n', begin);
      if (begin !== -1 && end !== -1) {
        const block = output.slice(begin + '@@BEGIN@@\n'.length, end);
        output = output.slice(end + '@@END@@\n'.length);
        return block;
      }
      if (exited || Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error(
          `The ${shell} session stopped before it printed ${pattern}. It wrote:\n${output}`,
        );
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  };

  const close = async (): Promise<void> => {
    if (!exited) {
      child.stdin.end('quit\n');
      const timer = setTimeout(() => child.kill('SIGKILL'), stepTimeout);
      await exit;
      clearTimeout(timer);
    }
    rmSync(root, { force: true, recursive: true });
  };

  let startup = '';
  try {
    // Bash and Zsh read PS1 from the environment; Fish sources its setup through -C.
    startup = plain(await step([], prompt));
    if (shell !== 'fish') {
      await step([send(`source ${quoted(setup)}`, String.raw`\n`)], prompt);
    }
  } catch (error) {
    await close();
    throw error;
  }

  const complete = async (line: string): Promise<Completed> => {
    const block = await step(
      [send(line, String.raw`\t`), send('', String.raw`\x1d`)],
      `${readback}*${prompt}`,
    );
    const listing = shell === 'fish' ? fishListing(line, script, cwd, env) : listingLines(block);
    const listed = shell === 'fish' ? fishWords(listing) : listedWords(listing);
    return { line: readLine(shell, block), listed, listing };
  };

  return { close, complete, startup };
}

/** A suite's session: its Tab, and the directory it runs in. */
interface SuiteSession {
  complete: (line: string) => Promise<Completed>;
  cwd: () => string;
}

/**
 * Opens a session before the suite's cases and closes it after them, in a fresh temporary
 * directory holding the given files, each written as `{}`.
 */
function useSession(
  options: Omit<SessionOptions, 'cwd'> & { files?: readonly string[] },
): SuiteSession {
  const { files = [], ...rest } = options;
  const state: { cwd: string; session: Session | undefined } = { cwd: '', session: undefined };
  beforeAll(async () => {
    state.cwd = mkdtempSync(join(tmpdir(), 'loom-completion-'));
    for (const file of files) {
      writeFileSync(join(state.cwd, file), '{}');
    }
    state.session = await openSession({ ...rest, cwd: state.cwd });
  });
  afterAll(async () => {
    await state.session?.close();
    rmSync(state.cwd, { force: true, recursive: true });
  });
  return {
    complete: async (line) => {
      if (state.session === undefined) {
        throw new Error('The session did not start.');
      }
      return await state.session.complete(line);
    },
    cwd: () => state.cwd,
  };
}

/**
 * The whole environment of a bare shell a test starts outside a session: `PATH`, a home the test
 * owns with every XDG folder under it, and Fish's flag that keeps its detached man-page completion
 * generator from writing. Nothing else of the test's environment reaches it, so no shell a test
 * starts reads or writes the developer's home.
 */
function sealedShellEnvironment(
  home: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    FISH_UNIT_TESTS_RUNNING: '1',
    HOME: home,
    PATH: process.env.PATH,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    ...extra,
  };
}

export {
  homeEnvironment,
  openSession,
  runInHome,
  sealedShellEnvironment,
  shellSuite,
  shellSuites,
  shells,
  useSession,
};
export type {
  Completed,
  HomeRun,
  Session,
  SessionOptions,
  Shell,
  ShellSuite,
  SuiteSession,
  TerminalShell,
};

/** The absolute path of an executable found on PATH, or undefined. */
export function findOnPath(command: string): string | undefined {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((directory) => directory !== '')
    .map((directory) => join(directory, command))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * The absolute path of an external program a test runs, or undefined, when the cases that need it
 * skip. CI installs every program a test runs and sets `LOOM_REQUIRE_SHELLS`, so there a missing
 * program fails the suite instead of skipping it.
 */
export function requiredProgram(program: string): string | undefined {
  const path = findOnPath(program);
  if (path === undefined && process.env.LOOM_REQUIRE_SHELLS) {
    throw new Error(`LOOM_REQUIRE_SHELLS is set, but ${program} is not installed.`);
  }
  return path;
}
