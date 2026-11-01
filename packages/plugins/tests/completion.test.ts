/*
 * Acceptance plan for the completion plugin (docs/plugins/completion.md#installing-completion).
 *
 * The plan is proven by four suites in this folder: this file reads the answer, the Commands, and
 * the scripts as text; completion-shells.test.ts drives real shells; completion-install.test.ts
 * installs; completion-refresh.test.ts refreshes. Each suite names the fixture application it runs.
 *
 * Completion is proven when the completion fixture application `kit` (fixtures/completion-app.ts)
 * installs `completion()` and real Bash, Zsh, and Fish shells, driven through a pseudo-terminal,
 * with Bash run as the system Bash 3.2 on macOS and again with the bash-completion package sourced
 * where it is installed, complete against the scripts `kit completion bash`, `zsh`, and `fish`
 * print, under Node and Bun. The line each Tab leaves is read back from the shell; the words Bash
 * and Zsh list are read from the terminal, and the words Fish lists from `complete -C` in a
 * separate Fish that sources the same script. The completion Commands declare no content input, so
 * a completion request at a terminal never requires a document source.
 *
 * - Commands. `kit <Tab>` offers the root's visible children, and never `fetch`, which is
 *   deprecated, `debug`, which is hidden, or `ls`, which is an alias. `kit keys --<Tab>` offers the
 *   options in scope at `keys`, its own and every global option, and `kit completion <Tab>` offers
 *   `bash`, `fish`, `install`, `powershell`, `uninstall`, `update`, and `zsh` and never
 *   `__complete`. `kit stats depth m<Tab>` and `kit stats depth max --fi<Tab>` complete a path
 *   three levels below the root. In Zsh, Fish, and PowerShell, a quoted program word, `'kit' ca<Tab>`
 *   or `& 'kit' ca<Tab>`, is read without its quotes.
 * - Options. `kit paths -<Tab>` offers long and short spellings, `--<Tab>` long spellings alone,
 *   and an option already given is not offered again, while a multiple `--field` is.
 * - Counted options. The fixture's own unmarked counted `--verbose` is offered again after it was
 *   given, as a multiple `--field` is. The verbose plugin's marked `--verbose` is no longer
 *   offered after `-vv`, and its quiet-marked `-q` no longer after `-q`, because a further
 *   occurrence of either adds nothing to the verbosity.
 * - Implied values. With `backup` implying `simple` and a closed set of values, `--backup=<Tab>`
 *   offers the values as whole words that begin `--backup=`, and `--backup <Tab>` offers what the
 *   next word may be and no value.
 * - Values. `kit paths --format <Tab>` and `--format=<Tab>` offer the view names, the second as
 *   whole words that begin `--format=`, `kit --file <Tab>` falls back to file names, and
 *   `kit paths --format a<Tab>`, which matches no view, offers no file name either.
 * - Injection. A closed-set value `$(touch sentinel)`, one holding a backtick command, and one
 *   holding `;touch sentinel` are each inserted as text, two values that share the prefix
 *   `$(touch sentinel)` or `a b` insert that prefix as quoted text, values holding `\` and `\:`
 *   insert as they are, a value holding a newline is not offered, a typed word
 *   `$(touch sentinel)` before the cursor is passed as text, in Bash a typed
 *   `$((x[$(touch sentinel)]))/` or `$HOME/` under the file fallback runs and rewrites nothing, and
 *   no sentinel file ever exists. A unit test shows that the script printed for each portable name
 *   sources without running anything.
 * - Failing closed. An unknown command earlier in the line, an unclosed quote under the cursor, a
 *   callback that exits nonzero, and an answer whose directive line is a bare `:` each offer
 *   nothing, file names included.
 * - Framing. A unit test reads `__complete` answers for every position kind, descriptions with tabs
 *   and line breaks, and directive lines, byte for byte.
 * - PowerShell. A real `pwsh` on Linux and macOS, under Node and Bun, dot-sources the script
 *   `kit completion powershell` prints and answers through `TabExpansion2`, the function
 *   PowerShell's Tab calls, the Commands, Options, and Values cases above, and the Injection cases
 *   with a typed `$(New-Item sentinel)` and an offered value holding it, with no sentinel file ever
 *   existing. An offered value holding `’` is inserted single-quoted with the `’` doubled, and a
 *   program that resolves to a `.cmd` file is never called. A unit test reads the startup line and
 *   the quoted script path for a path holding `'` and each of U+2018 through U+201B.
 * - Installing. Tests under the installation fixture (fixtures/completion-install-app.ts, an
 *   application named `jsonkit`) set `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`,
 *   and the working directory to temporary directories and clear `ZDOTDIR` and `SHELL` unless a
 *   case sets them, in process, or as a process under Node and Bun where the case needs a real
 *   umask:
 *   - `install bash` and `install zsh` write the pinned script files with mode `644` under umask
 *     `002` and `077`, add the pinned startup line at the end of the pinned startup file, creating
 *     it when it is missing and adding a line break first when it does not end with one, record
 *     both in `completion.<shell>.json`, and print the pinned lines. A second install prints the
 *     unchanged and already-loads lines and changes no byte. `install fish` writes
 *     `<config>/fish/completions/jsonkit.fish`, records it, touches no startup file, and prints the
 *     unchanged line on a second install. `install` with no shell follows `SHELL`, `/usr/bin/zsh`
 *     selecting `zsh`, and an unknown or unset `SHELL` exits 2 with the pinned sentence. On
 *     `darwin`, Bash's line goes to an existing `.profile` when neither `.bash_profile` nor
 *     `.bash_login` exists. An absolute `ZDOTDIR` moves the Zsh line under it, including to a
 *     folder that does not exist yet, which install creates. After `XDG_DATA_HOME` changes, a
 *     second install writes the script at the new path, removes the recorded one, and replaces its
 *     line where it stands, printing `Updated the line in <startup>.`
 *   - A real interactive Bash, Zsh, Fish, and PowerShell, driven through a pseudo-terminal with a
 *     temporary home and the startup files `kit completion install` wrote, complete `kit <Tab>`
 *     after `install` alone, Bash run as a login shell on `darwin` and as an interactive shell
 *     elsewhere, and PowerShell after it loads the profile `install pwsh` wrote. Zsh completes
 *     with a `.zshrc` that runs `compinit` before the line and again after it, with one whose only
 *     `compinit` runs after the line, on a second shell start, and with an insecure folder on
 *     `fpath`, never asking a question; under umask `002`, a `compinit` after the line never asks
 *     either. Applications named `files` and `describe` complete their Commands, and Zsh's own file
 *     completion still works after them.
 *   - An unrecorded file at a script's path, and a recorded script changed since, each fail
 *     `install` and `update` with exit 1, print the refused line, and change no byte of the script
 *     or the startup file. With Bash and Zsh installed and the Zsh script edited, `update` fails
 *     and changes no byte of either shell. A startup file that is a directory fails with the pinned
 *     sentence and writes nothing. A startup file the process may not write, one in a folder it may
 *     not write, one owned by another user, and one in UTF-16BE each install the script, print the
 *     line to add, record no line, and exit 0. After a recorded startup file changes to UTF-16,
 *     `update` drops its line from the record and prints nothing for it, `install` prints the line
 *     to add and records none, and `uninstall` leaves the file. After a startup file that holds the
 *     recorded line becomes one the process may not write, `install` prints the already-loads line
 *     and drops the line from the record. A line the operator added by hand to a file the process
 *     may not write is never recorded, and `uninstall` leaves it. With Bash and Zsh installed and
 *     Bash's plugin's file damaged, `uninstall` with no shell fails and changes no byte of either
 *     shell. After a startup file becomes one the process may not write, `uninstall` removes the
 *     script, prints the line to remove, deletes the plugin's file, and exits 0, and a second
 *     `uninstall` prints the nothing-to-remove line.
 *   - After the fixture's script changes, `update` rewrites each recorded script at its recorded
 *     path, even with `XDG_DATA_HOME` changed since, and prints the updated lines, and after the
 *     line's text changes, it replaces the line where it stands. After the operator removed the
 *     line, `update` adds none. After the line's text changes and the startup file becomes one the
 *     process may not write, `update` rewrites the script, prints the line to remove and the line
 *     to add in its place, records no line, and exits 0. With a `.zshrc` the process may not write
 *     and then an absolute `ZDOTDIR` set, `install` adds the new line under `ZDOTDIR`, prints the
 *     old line to remove, and exits 0. With nothing recorded, `update` and `uninstall` print their
 *     nothing-to lines and exit 0. After a first install killed before its script was written,
 *     `update` prints the nothing-to-update line and leaves the pending file, which the next
 *     `install` recovers.
 *   - `uninstall` removes the script, the line, and each created directory then empty, deletes the
 *     plugin's file, and leaves a startup file that ended with a line break before `install` byte
 *     for byte as it was. A startup line the operator edited stays and prints the left-as-it-is
 *     line, and a script the operator edited stays and prints the left-in-place line. `uninstall`
 *     with no shell removes every installed shell, and `uninstall zsh` leaves Bash's script and
 *     line.
 *   - `install pwsh` against a fixture `pwsh` on `PATH` that answers a Base64 profile path holding
 *     non-ASCII characters writes the line there. Fixtures that cannot start, exit 1, or answer a
 *     relative path each fail with the pinned sentence and write nothing. A fixture `pwsh` in the
 *     working directory and one under a relative `PATH` entry are never run.
 *   - On a `win32` fixture host, `install`, `update`, and `uninstall` each exit 1 with the pinned
 *     sentence, naming the print child of the shell asked for, and write nothing, while
 *     `completion powershell` prints its script.
 * - Refreshing. `refreshCompletion`, given a fixture binary path, runs it with `completion update`,
 *   pipes its output into the host's streams, and resolves; a child that exits 1, and a path that
 *   cannot start, each add the pinned `warn` log event and resolve. Installed as
 *   `selfUpdate({ afterReplace: refreshCompletion })` under the self-update fixture, an update
 *   rewrites a recorded script to the replaced binary's version.
 * - Packed consumers. A consumer installs the packed pack, imports `@loomcli/plugins/completion`,
 *   compiles against its declaration, and prints a script.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, locate } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { sealedShellEnvironment } from '../../../scripts/test-shell.js';
import { answer } from '../src/completion/answer.js';
import { bashScript } from '../src/completion/bash.js';
import { fishScript } from '../src/completion/fish.js';
import { identifier, powershellQuoted } from '../src/completion/name.js';
import { powershellScript } from '../src/completion/powershell.js';
import { zshInstalledScript, zshScript } from '../src/completion/zsh.js';
import { format } from '../src/format/plugin.js';
import { help } from '../src/help/plugin.js';
import { verbose } from '../src/verbose/plugin.js';
import { run as fixtureRun } from './fixtures/completion-app.js';

/** The answer `__complete` writes for the words after the application name. */
async function complete(...words: string[]) {
  const result = await fixtureRun(['completion', '__complete', '--', ...words]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

/** The options in scope on every Command of the fixture, as `--` offers them. */
const globalLines = [
  '--file\tThe document.',
  '--color\tColor output.',
  '--no-color\tColor output.',
  '--help\tShow this help.',
];

/** A validator that accepts any value and publishes exactly the given input-side JSON Schema. */
function shaped(json: Record<string, unknown>): StandardSchemaV1 & StandardJSONSchemaV1 {
  return {
    '~standard': {
      jsonSchema: { input: () => json, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** Lines joined as the answer frames them: each ends with a newline, the directive last. */
function framed(lines: readonly string[], directive: number): string {
  return [...lines, `:${directive}`].map((line) => `${line}\n`).join('');
}

describe('the answer', () => {
  it('a Command position offers visible canonical children with descriptions reduced to display text', async () => {
    await expect(complete('')).resolves.toBe(
      framed(
        [
          'completion\tPrint or install a shell completion script.',
          'paths\tWalkall paths.',
          'keys\tList keys.',
          'cache',
        ],
        4,
      ),
    );
    await expect(complete('cache', '')).resolves.toBe(framed(['clear', 'list\tList entries.'], 4));
    await expect(complete('p')).resolves.toBe(framed(['paths\tWalkall paths.'], 4));
  });

  it('the completion group offers its shells and installing children, and never __complete', async () => {
    await expect(complete('completion', '')).resolves.toBe(
      framed(
        [
          'bash\tPrint the Bash completion script.',
          'zsh\tPrint the Zsh completion script.',
          'fish\tPrint the Fish completion script.',
          'powershell\tPrint the PowerShell completion script.',
          'install\tInstall completion for your shell.',
          'update\tBring installed completion up to date with this version.',
          'uninstall\tRemove completion from your shell.',
        ],
        4,
      ),
    );
    await expect(complete('completion', 'install', '')).resolves.toBe(
      framed(['bash', 'zsh', 'fish', 'pwsh'], 4),
    );
    await expect(complete('completion', '_')).resolves.toBe(framed([], 4));
  });

  it('an alias, a hidden Command, and a deprecated Command are never offered, and each still routes', async () => {
    await expect(complete('l')).resolves.toBe(framed([], 4));
    await expect(complete('d')).resolves.toBe(framed([], 4));
    await expect(complete('f')).resolves.toBe(framed([], 4));
    await expect(complete('ls', '--')).resolves.toBe(framed(globalLines, 4));
    await expect(complete('debug', '--d')).resolves.toBe(framed(['--dump'], 4));
    await expect(complete('fetch', '--d')).resolves.toBe(framed(['--deep'], 4));
  });

  it("an option's alias is never offered, and a typed one completes its option's value", () => {
    const graph = new Application('kit')
      .option('metric', {
        aliases: ['measure'],
        type: 'string',
        validate: shaped({ enum: ['bytes', 'words'] }),
      })
      .option('color', { aliases: ['colour'], polarity: 'both', type: 'boolean' })
      .action(() => {})
      .inspect();
    expect(answer(graph, locate(graph, ['--']))).toBe(
      framed(['--metric', '--color', '--no-color'], 4),
    );
    expect(answer(graph, locate(graph, ['--measure', 'w']))).toBe(framed(['words'], 4));
    expect(answer(graph, locate(graph, ['--measure=b']))).toBe(framed(['--measure=bytes'], 4));
  });

  it('an option position offers long spellings, and short ones too when the word is exactly a hyphen', async () => {
    await expect(complete('paths', '--')).resolves.toBe(
      framed([...globalLines, '--format\tThe view.', '--field\tA field.', '--quiet\tSay less.'], 4),
    );
    await expect(complete('paths', '-')).resolves.toBe(
      framed(
        [
          '--file\tThe document.',
          '--color\tColor output.',
          '--no-color\tColor output.',
          '--help\tShow this help.',
          '-h\tShow this help.',
          '--format\tThe view.',
          '-f\tThe view.',
          '--field\tA field.',
          '--quiet\tSay less.',
          '-q\tSay less.',
        ],
        4,
      ),
    );
    await expect(complete('paths', '--n')).resolves.toBe(framed(['--no-color\tColor output.'], 4));
    await expect(complete('paths', '-q')).resolves.toBe(framed([], 4));
  });

  it("a root's own --format before a group's name leaves routing open, so the group's children are offered", () => {
    const table = { render: () => 'table\n' };
    const graph = new Application('store', { plugins: [format()] })
      .command(new Command('cache').command(new Command('list').action(() => {})))
      .result({ views: { table } })
      .action(() => {})
      .inspect();
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '']))).toBe(
      answer(graph, locate(graph, ['cache', ''])),
    );
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '']))).toBe(
      framed(['list'], 4),
    );
  });

  it("a root's own --format before a group's name leaves routing open for a hyphen word too", () => {
    const table = { render: () => 'table\n' };
    const graph = new Application('store', { plugins: [format(), help()] })
      .command(new Command('cache').command(new Command('list').action(() => {})))
      .result({ views: { table } })
      .action(() => {})
      .inspect();
    const offered = answer(graph, locate(graph, ['cache', '--h']));
    expect(offered).toBe(framed(['--help\tShow this help.'], 4));
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '--h']))).toBe(offered);
  });

  it('a value is never offered empty, and never as a word whose first character is a tilde', () => {
    const graph = new Application('kit')
      .command(
        new Command('one')
          .option('v', { type: 'string', validate: shaped({ enum: ['', '~', '~root', 'a~b'] }) })
          .argument('value', { validate: shaped({ enum: ['~root', 'b~c'] }) })
          .action(() => {}),
      )
      .inspect();
    // After a lead the word starts with a hyphen, and no shell expands a tilde after `--v=`.
    expect(answer(graph, locate(graph, ['one', '--v=']))).toBe(
      framed(['--v=~', '--v=~root', '--v=a~b'], 4),
    );
    expect(answer(graph, locate(graph, ['one', '--v', '']))).toBe(framed(['a~b'], 4));
    expect(answer(graph, locate(graph, ['one', '']))).toBe(framed(['b~c'], 4));
  });

  it('a supplied option is not offered again unless it is a multiple string option', async () => {
    await expect(complete('paths', '--format', 'json', '-q', '--f')).resolves.toBe(
      framed(['--file\tThe document.', '--field\tA field.'], 4),
    );
    await expect(complete('paths', '--field', 'a', '--fi')).resolves.toBe(
      framed(['--file\tThe document.', '--field\tA field.'], 4),
    );
    await expect(complete('--file', 'x', 'paths', '--fi')).resolves.toBe(
      framed(['--field\tA field.'], 4),
    );
  });

  it('a counted option is offered again, because another occurrence adds to its count', async () => {
    await expect(complete('backups', '-v', '--v')).resolves.toBe(
      framed(['--verbose\tSay more.'], 4),
    );
    await expect(complete('backups', '-vv', '--verbose', '--v')).resolves.toBe(
      framed(['--verbose\tSay more.'], 4),
    );
  });

  it('the quiet-marked option is not offered again once given, because a further -q adds nothing', () => {
    const graph = new Application('kit', { plugins: [verbose()] }).action(() => {}).inspect();
    expect(answer(graph, locate(graph, ['--q']))).toBe(
      framed(['--quiet\tHide info and success messages.'], 4),
    );
    expect(answer(graph, locate(graph, ['-q', '--q']))).toBe(framed([], 4));
  });

  it('the verbose-marked option is offered until it is given twice, because the verbosity stops at 2', () => {
    const graph = new Application('kit', { plugins: [verbose()] }).action(() => {}).inspect();
    const offered = framed(['--verbose\tShow more detail. Repeat it for more.'], 4);
    expect(answer(graph, locate(graph, ['-v', '--v']))).toBe(offered);
    expect(answer(graph, locate(graph, ['-vv', '--v']))).toBe(framed([], 4));
    expect(answer(graph, locate(graph, ['-v', '--verbose', '--v']))).toBe(framed([], 4));
  });

  it('a string option with an implied value offers its values only when they are attached', async () => {
    await expect(complete('backups', '--backup=')).resolves.toBe(
      framed(['--backup=none', '--backup=simple', '--backup=numbered'], 4),
    );
    await expect(complete('backups', '--backup=n')).resolves.toBe(
      framed(['--backup=none', '--backup=numbered'], 4),
    );
    await expect(complete('backups', '-bn')).resolves.toBe(framed(['-bnone', '-bnumbered'], 4));
    // A bare spelling is complete, so the next word offers what follows it and no value.
    await expect(complete('backups', '--backup', '')).resolves.toBe(framed(['disk', 'tape'], 4));
    await expect(complete('backups', '-b', '')).resolves.toBe(framed(['disk', 'tape'], 4));
  });

  it('a value position offers the closed set after its lead, filtered by the typed value', async () => {
    await expect(complete('paths', '--format', '')).resolves.toBe(
      framed(['json', 'jsonl', 'table'], 4),
    );
    await expect(complete('paths', '-f', 't')).resolves.toBe(framed(['table'], 4));
    await expect(complete('paths', '--format=')).resolves.toBe(
      framed(['--format=json', '--format=jsonl', '--format=table'], 4),
    );
    await expect(complete('paths', '--format=j')).resolves.toBe(
      framed(['--format=json', '--format=jsonl'], 4),
    );
    await expect(complete('paths', '--format=x')).resolves.toBe(framed([], 4));
  });

  it('an argument offers exact values once, leaving out every value a shell cannot hold', async () => {
    await expect(complete('keys', '')).resolves.toBe(
      framed(['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'], 4),
    );
    await expect(complete('ls', '$')).resolves.toBe(framed(['$(touch sentinel)'], 4));
  });

  it('an input with no closed set and the passthrough tail leave the shell its files', async () => {
    await expect(complete('--file', '')).resolves.toBe(framed([], 0));
    await expect(complete('--old', '')).resolves.toBe(framed([], 0));
    await expect(complete('paths', '--', 'x')).resolves.toBe(framed([], 0));
  });

  it('a structural fault offers nothing and reports an error', async () => {
    await expect(complete('nope', '')).resolves.toBe(framed([], 1));
    await expect(complete('paths', '--bogus', '')).resolves.toBe(framed([], 1));
  });

  it('a typed --help or a hostile word is read as a word and never activates anything', async () => {
    await expect(complete('--help', '')).resolves.toBe(
      framed(
        [
          'completion\tPrint or install a shell completion script.',
          'paths\tWalkall paths.',
          'keys\tList keys.',
          'cache',
        ],
        4,
      ),
    );
    await expect(complete('$(touch sentinel)', '')).resolves.toBe(framed([], 1));
  });

  it('a description reads each line break as a space, with every control character removed', () => {
    const graph = new Application('kit')
      .command(new Command('one', { description: 'First.' }).action(() => {}))
      .inspect();
    const [one] = graph.root.children;
    if (one === undefined) {
      throw new Error('The graph holds no child.');
    }
    const root = {
      ...graph.root,
      children: [
        { ...one, description: `Line${String.fromCodePoint(7)} one.\r\nLine two.` },
        { ...one, description: `\tTwo.${String.fromCodePoint(8233)}More.`, name: 'two' },
        { ...one, description: undefined, name: 'three' },
        { ...one, description: 'Four.\nFour more.', name: 'four' },
        { ...one, description: '\t', name: 'five' },
      ],
    };
    expect(answer(graph, { command: root, kind: 'command', prefix: '' })).toBe(
      framed(
        ['one\tLine one. Line two.', 'two\tTwo. More.', 'three', 'four\tFour. Four more.', 'five'],
        4,
      ),
    );
  });
});

describe('the Commands', () => {
  it('each shell Command prints its script for the application name in one exact write', async () => {
    const shells = {
      bash: bashScript,
      fish: fishScript,
      powershell: powershellScript,
      zsh: zshScript,
    };
    for (const [shell, script] of Object.entries(shells)) {
      await expect(fixtureRun(['completion', shell])).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout: script('kit'),
      });
    }
  });

  it('the completion group lists its visible shells when the subcommand is missing', async () => {
    const result = await fixtureRun(['completion']);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bash, zsh, fish, powershell');
    expect(result.stderr).not.toContain('__complete');
  });

  it('a shell Command reaches help when help is installed', async () => {
    const result = await fixtureRun(['completion', 'bash', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Print the Bash completion script.');
  });
});

describe('the name', () => {
  it('an identifier keeps ASCII letters and digits and encodes every other code point', () => {
    expect(identifier('jsonkit')).toBe('jsonkit');
    expect(identifier('git-lfs')).toBe('git_2d_lfs');
    expect(identifier('a_b.c')).toBe('a_5f_b_2e_c');
    expect(identifier(`x${String.fromCodePoint(128_512)}`)).toBe('x_1f600_');
    expect(identifier('a-b')).not.toBe(identifier('a_2d_b'));
  });

  it("a PowerShell single-quoted string writes ' and each of U+2018 through U+201B twice", () => {
    const quotes = [8216, 8217, 8218, 8219].map((code) => String.fromCodePoint(code));
    expect(powershellQuoted("/home/o'neil/.local/share")).toBe("'/home/o''neil/.local/share'");
    for (const quote of quotes) {
      expect(powershellQuoted(`/home/a${quote}b/x`)).toBe(`'/home/a${quote}${quote}b/x'`);
      expect(powershellQuoted(`it${quote}s`)).toBe(`'it${quote}${quote}s'`);
    }
    expect(powershellQuoted(quotes.join("'"))).toBe(
      `'${quotes.map((quote) => quote + quote).join("''")}'`,
    );
  });

  it('a PowerShell single-quoted string keeps every other character as it is', () => {
    const others = [
      'jsonkit',
      'git-lfs',
      String.raw`C:\Users\me`,
      '"$(New-Item sentinel)"',
      '`n $HOME @a {b} (c) ;|&<>#,',
      `x${String.fromCodePoint(8220)}y${String.fromCodePoint(8221)}z`,
      `x${String.fromCodePoint(128_512)}`,
      '',
    ];
    for (const text of others) {
      expect(powershellQuoted(text)).toBe(`'${text}'`);
    }
  });
});

/** Portable names, including ones that match a Zsh completion system function's suffix. */
const portableNames = ['kit', 'git-lfs', 'a.b_c', '9', 'describe', 'files', 'arguments'];

/** One shell's script, and the command line a bare shell sources a script file with. */
interface ScriptShell {
  flags: string[];
  script: (name: string) => string;
  shell: string;
  source: string;
  title: string;
}

/**
 * Whether the shell runs here. A missing shell skips its case, unless `LOOM_REQUIRE_SHELLS` is
 * set, when it fails the case, as it fails the conformance suites.
 */
function shellRuns(shell: string): boolean {
  const home = mkdtempSync(join(tmpdir(), 'loom-shell-home-'));
  try {
    // The probe starts the shell under a home of its own, so its first launch writes nothing real.
    const probe = spawnSync(shell, ['-c', 'true'], { env: sealedShellEnvironment(home) });
    if (probe.error === undefined) {
      return true;
    }
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
  if (process.env.LOOM_REQUIRE_SHELLS) {
    throw new Error(`LOOM_REQUIRE_SHELLS is set, but ${shell} not installed.`);
  }
  return false;
}

/**
 * Sources the script text from a file in a fresh directory, then runs `after`, and reports the
 * run and whether a `pwned` file appeared. A file, because a spawned stdin is a socket on Linux,
 * which `/dev/stdin` cannot open.
 */
function sourceScript({ flags, shell, source }: ScriptShell, text: string, after = '') {
  const directory = mkdtempSync(join(tmpdir(), 'loom-completion-'));
  try {
    // PowerShell dot-sources only a file named .ps1 and hands any other to the desktop's opener.
    const file = join(directory, shell === 'pwsh' ? 'script.ps1' : 'script');
    writeFileSync(file, text);
    const result = spawnSync(shell, [...flags, '-c', `${source} '${file}'${after}`], {
      cwd: directory,
      encoding: 'utf8',
      env: sealedShellEnvironment(directory),
    });
    return { pwned: existsSync(join(directory, 'pwned')), result };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('the scripts', () => {
  const bash: ScriptShell = {
    flags: ['--noprofile', '--norc'],
    script: bashScript,
    shell: 'bash',
    source: 'source',
    title: 'Bash',
  };
  const scripts: ScriptShell[] = [
    bash,
    {
      flags: ['-f'],
      script: zshScript,
      shell: 'zsh',
      source: 'autoload -U compinit; compinit -u -D; source',
      title: 'Zsh',
    },
    // The installed file starts the completion system itself when compdef is not defined.
    {
      flags: ['-f'],
      script: zshInstalledScript,
      shell: 'zsh',
      source: 'source',
      title: 'installed Zsh',
    },
    { flags: ['--no-config'], script: fishScript, shell: 'fish', source: 'source', title: 'Fish' },
    {
      flags: ['-NoProfile', '-NonInteractive'],
      script: powershellScript,
      shell: 'pwsh',
      source: '.',
      title: 'PowerShell',
    },
  ];

  it.each(scripts)('the $title script evaluates nothing', ({ script }) => {
    const text = script('kit');
    expect(text).not.toMatch(/\beval\b/u);
    expect(text).not.toMatch(/compgen\s+-[WfdG]/u);
    expect(text).not.toContain('_activeHelp_');
  });

  it('the PowerShell script registers a native completer and runs no string as a command', () => {
    const text = powershellScript('kit');
    expect(text).not.toMatch(/Invoke-Expression|\biex\b|ScriptBlock\]::Create|NewScriptBlock/iu);
    expect(text).toMatch(/^Register-ArgumentCompleter -Native -CommandName 'kit' /mu);
  });

  it('the PowerShell script starts an application with an argument list off Windows, and calls & on Windows', () => {
    const text = powershellScript('kit');
    expect(text).toContain(
      "$Unix = $PSVersionTable.PSEdition -eq 'Core' -and ($IsLinux -or $IsMacOS)",
    );
    expect(text).toMatch(
      /if \(\$Unix\) \{\n\s+\$Resolved = Get-Command -Name \$Pattern -CommandType Application /u,
    );
    const unix = text.slice(text.lastIndexOf('if ($Unix) {'), text.indexOf('$Out = @(& $Resolved'));
    expect(unix).toContain('$Start.ArgumentList.Add($Word)');
    expect(unix).toContain('$Start.UseShellExecute = $false');
    expect(unix).toContain('$Start.RedirectStandardError = $true');
    expect(unix).toContain('$Process.StandardError.ReadToEndAsync()');
    expect(unix).toMatch(/\} else \{\n[\s\S]*__kit_legacy/u);
    expect(text.match(/& \$Resolved/gu)).toHaveLength(1);
  });

  it('the PowerShell script inserts a space after a sole word unless directive 2 is set', () => {
    const text = powershellScript('kit');
    expect(text).toMatch(
      /\$Space = " "\n\s+if \(\(\$Directive -band \$ShellCompDirectiveNoSpace\) -ne 0 \) \{\n[^}]*\$Space = ""\n/u,
    );
    expect(text).toMatch(/if \(\$Values\.Count -eq 1\) \{\n\s+\$After = \$Space\n/u);
    expect(text).toContain(
      "__kit_result (($_.Name | __kit_quote) + $After) $_.Name 'ParameterValue'",
    );
  });

  it('the PowerShell script holds the name only in its registration, single-quoted', () => {
    // Each name holds a character the identifier encodes, so only the registration spells it.
    for (const name of ['git-lfs', 'a.b_c']) {
      const text = powershellScript(name);
      expect(text.split(name)).toHaveLength(2);
      expect(text).toContain(`-CommandName '${name}' `);
    }
  });

  it('the installed Zsh file differs from the printed script in its autoload check and compinit guard alone', () => {
    const guard = [
      '# Start the completion system when no compdef is defined, and register nothing without it.',
      '(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -i }',
      '(( $+functions[compdef] )) || return 0',
    ];
    const printed = zshScript('git-lfs');
    expect(printed).toContain('"_git-lfs"');
    expect(zshInstalledScript('git-lfs')).toBe(
      printed
        .replace('#compdef git-lfs\n', `#compdef git-lfs\n${guard.join('\n')}\n`)
        .replaceAll('_git-lfs', '_loom_git_2d_lfs'),
    );
  });

  it('the Bash script escapes every tilde in a word it inserts, which printf %q may leave bare', () => {
    if (!shellRuns('bash')) {
      return;
    }
    const { result } = sourceScript(
      bash,
      bashScript('kit'),
      String.raw`; for word in "~root" "a b" "a~b" "a=~root" "~~"; do __kit_quote "$word"; printf '%s\n' "$quoted"; done`,
    );
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(result.stdout).toBe(String.raw`\~root
a\ b
a\~b
a=\~root
\~\~
`);
  });

  it('the Zsh script for describe, files, or arguments defines none of the completion system functions', () => {
    for (const name of ['describe', 'files', 'arguments']) {
      const text = zshScript(name);
      expect(text).not.toMatch(/^_(?:describe|files|arguments)\s*\(\)/mu);
      expect(text).toMatch(new RegExp(String.raw`^_loom_${name}\(\)$`, 'mu'));
      expect(text).toContain(`compdef _loom_${name} '${name}'`);
    }
  });

  it.each(scripts)(
    'the $title script sources without running anything for every portable name',
    (entry) => {
      if (!shellRuns(entry.shell)) {
        return;
      }
      for (const name of portableNames) {
        const { pwned, result } = sourceScript(entry, entry.script(name));
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(pwned).toBe(false);
      }
    },
  );
});
