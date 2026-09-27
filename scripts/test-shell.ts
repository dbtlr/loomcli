import { spawn, spawnSync } from 'node:child_process';
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
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll } from 'vite-plus/test';

import { childEnvironment } from './test-process.js';

/** The shells the completion scripts support, each driven through a pseudo-terminal. */
const shells = ['bash', 'fish', 'zsh'] as const;
type Shell = (typeof shells)[number];

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
   * exits 1, and `prints a bare colon` with one that answers `:` and no directive digits.
   */
  callback?: 'answers' | 'exits nonzero' | 'prints a bare colon';
  /** Files the shell sources before the script, such as the bash-completion package. */
  sources?: readonly string[];
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

/** The absolute path of an executable found on PATH, or undefined. */
function findOnPath(command: string): string | undefined {
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

/**
 * The lines a shell sources before the first Tab: a fixed prompt, a wide list, and a read-back
 * on Ctrl-] that prints the line after `@@LINE@@` without running it. Each read-back splits the
 * marker in the text it echoes, so only its output matches.
 */
function setupLines(shell: Shell, script: string): string[] {
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
        `source ${quoted(script)}`,
      ];
    }
    case 'zsh': {
      return [
        `PS1=${quoted(prompt)}`,
        'unset zle_bracketed_paste',
        'setopt no_beep no_prompt_sp',
        'stty cols 200',
        'autoload -U compinit',
        'compinit -u -D',
        "zstyle ':completion:*' menu no",
        // The replaced line expands the saved line when it runs, so nothing in it is parsed.
        `__loom_readback() { __loom_line=$BUFFER; BUFFER='print -r -- @@LI""NE@@$__loom_line'; zle accept-line; }`,
        'zle -N __loom_readback',
        "bindkey '^]' __loom_readback",
        `source ${quoted(script)}`,
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
        `source ${quoted(script)}`,
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

/** The command line that starts each shell interactively without reading its startup files. */
function shellCommand(shell: Shell, setup: string): string[] {
  const path = shellPath(shell) ?? shell;
  switch (shell) {
    case 'bash': {
      return [path, '--noprofile', '--norc', '-i'];
    }
    case 'zsh': {
      return [path, '-f', '-i'];
    }
    case 'fish': {
      return [path, '--no-config', '-i', '-C', `source ${quoted(setup)}`];
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
function readLine(shell: Shell, block: string): string {
  const line = [...block.matchAll(/@@LINE@@(?<line>[^\n\r]*)/gu)].at(-1)?.groups?.line;
  if (line === undefined) {
    throw new Error(`The read-back printed no line:\n${block}`);
  }
  return shell === 'bash' ? line.replace(/^\s*#/u, '') : line;
}

/** What Fish would list for the line, from `complete -C` in a separate Fish: word, tab, text. */
function fishListing(
  line: string,
  script: string,
  cwd: string,
  env: Record<string, string | undefined>,
): string {
  const result = spawnSync(
    'fish',
    ['--no-config', '-c', 'source $argv[1]; complete -C $argv[2]', script, line],
    { cwd, encoding: 'utf8', env, timeout: stepTimeout },
  );
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
 * Whether a shell's cases can run: the shell and zsh, which runs the driver, are installed. A
 * missing shell skips its cases, unless `LOOM_REQUIRE_SHELLS` is set, when it fails the suite.
 */
function shellSuite(shell: Shell): ShellSuite {
  const needed: Shell[] = [shell, 'zsh'];
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

/**
 * Starts the program's completion session: a wrapper on PATH that runs `main` with the test
 * runtime, and the script it prints sourced into an interactive shell under the driver.
 */
async function openSession(options: SessionOptions): Promise<Session> {
  const { shell, name, main, cwd } = options;
  const root = mkdtempSync(join(tmpdir(), 'loom-shell-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  const program = join(bin, name);
  writeExecutable(program, `exec ${quoted(runtimePath())} ${quoted(fileURLToPath(main))} "$@"`);
  const env = childEnvironment({
    BASH_COMP_DEBUG_FILE: undefined,
    BASH_ENV: undefined,
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    COLUMNS: '200',
    ENV: undefined,
    HISTFILE: '',
    HOME: home,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    PS1: prompt,
    TERM: 'dumb',
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    ZDOTDIR: undefined,
  });
  const printed = spawnSync(program, ['completion', shell], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: stepTimeout,
  });
  if (printed.status !== 0) {
    rmSync(root, { force: true, recursive: true });
    throw new Error(`${name} completion ${shell} failed:\n${printed.stdout}${printed.stderr}`);
  }
  const script = join(root, `script.${shell}`);
  writeFileSync(script, printed.stdout);
  const setup = join(root, `setup.${shell}`);
  const sourced = (options.sources ?? []).map((file) => `source ${quoted(file)}`);
  writeFileSync(setup, `${[...sourced, ...setupLines(shell, script)].join('\n')}\n`);
  if (options.callback === 'exits nonzero') {
    writeExecutable(program, 'exit 1');
  } else if (options.callback === 'prints a bare colon') {
    writeExecutable(program, String.raw`printf ':\n'`);
  }

  const child = spawn('zsh', [driver, ...shellCommand(shell, setup)], {
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

  try {
    // Bash and Zsh read PS1 from the environment; Fish sources its setup through -C.
    await step([], prompt);
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

  return { close, complete };
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

export { shellSuites, shells, useSession };
export type { Completed, Session, SessionOptions, Shell, ShellSuite, SuiteSession };
