/*
 * Acceptance plan for the completion plugin (docs/plugins/completion.md#installing-completion).
 *
 * Completion is proven when jsonkit installs `completion()` and real Bash, Zsh, and Fish shells,
 * driven through a pseudo-terminal, with Bash run as the system Bash 3.2 on macOS and again with
 * the bash-completion package sourced where it is installed, complete against the scripts
 * `jsonkit completion bash`, `zsh`, and `fish` print, under Node and Bun. The line each Tab leaves
 * is read back from the shell; the words Bash and Zsh list are read from the terminal, and the
 * words Fish lists from `complete -C` in a separate Fish that sources the same script. The
 * completion Commands declare no content input, so a completion request at a terminal never
 * requires a document source.
 *
 * - Commands. `jsonkit <Tab>` offers the root's visible children, and never `fetch`, which is
 *   deprecated, `debug`, which is hidden, or `ls`, which is an alias. `jsonkit ls --<Tab>` offers
 *   the options in scope at `keys`, its own and every global option, and `jsonkit completion <Tab>`
 *   offers `bash`, `fish`, `install`, `powershell`, `uninstall`, `update`, and `zsh` and never
 *   `__complete`. `jsonkit completion install <Tab>` offers the four shell names.
 * - Options. `jsonkit paths -<Tab>` offers long and short spellings, `--<Tab>` long spellings
 *   alone, and an option already given is not offered again, while `select`'s multiple `--field`
 *   is.
 * - Counted options. `jsonkit -v --<Tab>` offers `--verbose` again, as `select`'s `--field` is
 *   offered again, while `jsonkit -vv --<Tab>` no longer offers `--verbose` and
 *   `jsonkit -q --<Tab>` no longer offers `--quiet`, because a further occurrence of either adds
 *   nothing to the verbosity.
 * - Implied values. In a fixture with `backup` implying `simple` and a closed set of values,
 *   `--backup=<Tab>` offers the values as whole words that begin `--backup=`, and `--backup <Tab>`
 *   offers what the next word may be and no value.
 * - Values. `jsonkit paths --format <Tab>` and `--format=<Tab>` offer the view names, the second as
 *   whole words that begin `--format=`, `jsonkit get --file <Tab>` falls back to file names, and
 *   `jsonkit paths --format a<Tab>`, which matches no view, offers no file name either.
 * - Injection. In a fixture application, a closed-set value `$(touch sentinel)`, one holding a
 *   backtick command, and one holding `;touch sentinel` are each inserted as text, two values that
 *   share the prefix `$(touch sentinel)` or `a b` insert that prefix as quoted text, values holding
 *   `\` and `\:` insert as they are, a value holding a newline is not offered, a typed word
 *   `$(touch sentinel)` before the cursor is passed as text, in Bash a typed
 *   `$((x[$(touch sentinel)]))/` or `$HOME/` under the file fallback runs and rewrites nothing, and
 *   no sentinel file ever exists. A unit test shows that the script printed for each portable name
 *   sources without running anything.
 * - Failing closed. An unknown command earlier in the line, an unclosed quote under the cursor, a
 *   callback that exits nonzero, and an answer whose directive line is a bare `:` each offer
 *   nothing.
 * - Framing. A unit test reads `__complete` answers for every position kind, descriptions with tabs
 *   and line breaks, and directive lines, byte for byte.
 * - PowerShell. A real `pwsh` on Linux and macOS, under Node and Bun, dot-sources the script
 *   `jsonkit completion powershell` prints and answers through `TabExpansion2`, the function
 *   PowerShell's Tab calls, the Commands, Options, and Values cases above, and the Injection cases
 *   with a typed `$(New-Item sentinel)` and an offered value holding it, with no sentinel file ever
 *   existing. An offered value holding `’` is inserted single-quoted with the `’` doubled, and a
 *   program that resolves to a `.cmd` file is never called. A unit test reads the startup line and
 *   the quoted script path for a path holding `'` and each of U+2018 through U+201B.
 * - Installing. Process tests under Node and Bun set `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`,
 *   `XDG_STATE_HOME`, and the working directory to temporary directories and clear `ZDOTDIR` and
 *   `SHELL` unless a case sets them:
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
 *   - A real interactive Bash, Zsh, and Fish, driven through a pseudo-terminal with the temporary
 *     home and its startup files, complete `jsonkit <Tab>` after `install` alone, Bash run as a
 *     login shell on `darwin` and as an interactive shell elsewhere. Zsh completes with a `.zshrc`
 *     that never runs `compinit`, with one that runs it before the line, with one that runs it
 *     again after the line, with one whose only `compinit` runs after the line, on a second shell
 *     start, and with an insecure folder on `fpath`, never asking a question; under umask `002`, a
 *     `compinit` after the line never asks either. Applications named `files` and `describe`
 *     complete their Commands, and Zsh's own file completion still works after them. A real `pwsh`
 *     whose profile `install pwsh` wrote completes through `TabExpansion2` after it loads that
 *     profile.
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

import { describe, expect, it } from 'vite-plus/test';

import { shellSuites, useSession } from '../../../scripts/test-shell.js';
import type { SessionOptions, Shell } from '../../../scripts/test-shell.js';
import { counts, main } from './documents.js';

/** The program words each shell types before `sel`, a quoted one read without its quotes. */
const quotedPrograms: Record<Shell, string[]> = {
  bash: ['jsonkit'],
  fish: ['jsonkit', "'jsonkit'"],
  pwsh: ['jsonkit', "& 'jsonkit'"],
  zsh: ['jsonkit', "'jsonkit'"],
};

/** The documents in each session's directory: `d` completes to `doc-`, and `a` to `alp`. */
const files = ['alpha.json', 'alpine.json', 'doc-a.json', 'doc-b.json'];

/** The options in scope at every jsonkit Command: the global options, the application's and each plugin's. */
const options = [
  '--color',
  '--explain',
  '--file',
  '--help',
  '--manifest',
  '--no-color',
  '--quiet',
  '--verbose',
  '--version',
];

/** The view names of the `paths` rows. */
const views = ['json', 'jsonl', 'list', 'table'];

/** Programs that answer nothing a script may offer, each with the case title it proves. */
const failures: { callback: NonNullable<SessionOptions['callback']>; title: string }[] = [
  { callback: 'exits nonzero', title: 'a callback that exits nonzero' },
  { callback: 'prints a bare colon', title: 'an answer whose directive line is a bare colon' },
];

describe.each(shellSuites())('$title', ({ installed, shell, sources }) => {
  describe.skipIf(!installed)('jsonkit completes', () => {
    const { complete } = useSession({ files, main, name: 'jsonkit', shell, sources });

    describe('Commands', () => {
      it('jsonkit <Tab> lists the visible root children and never a deprecated, hidden, or alias name', async () => {
        const { listed } = await complete('jsonkit ');
        expect(counts(listed)).toEqual(
          counts(['completion', 'doctor', 'get', 'keys', 'manpage', 'mcp', 'select', 'stats']),
        );
      });

      it('jsonkit ls --<Tab> lists the options in scope at keys, global and plugin options included', async () => {
        const { listed } = await complete('jsonkit ls --');
        expect(counts(listed)).toEqual(counts(options));
      });

      it('jsonkit stats depth m<Tab> inserts max, three levels below the root', async () => {
        const { line } = await complete('jsonkit stats depth m');
        expect(line.trimEnd()).toBe('jsonkit stats depth max');
      });

      it('jsonkit stats depth max --fi<Tab> inserts the option of the Command three levels down', async () => {
        const { line } = await complete('jsonkit stats depth max --fi');
        expect(line.trimEnd()).toBe('jsonkit stats depth max --file');
      });

      it('jsonkit completion <Tab> lists its children and never __complete', async () => {
        const { listed } = await complete('jsonkit completion ');
        expect(counts(listed)).toEqual(
          counts(['bash', 'fish', 'install', 'powershell', 'uninstall', 'update', 'zsh']),
        );
      });

      // Bash finds no completion for a quoted program word, so only Zsh, Fish, and PowerShell type one.
      // PowerShell types it after its call operator, because a quoted word alone is a string.
      it.each(quotedPrograms[shell])(
        '%s sel<Tab> inserts select, the program word read without its quotes',
        async (program) => {
          const { line } = await complete(`${program} sel`);
          expect(line.trimEnd()).toBe(`${program} select`);
        },
      );
    });

    describe('Options', () => {
      it('jsonkit paths -<Tab> lists long and short spellings', async () => {
        const { listed } = await complete('jsonkit paths -');
        expect(counts(listed)).toEqual(
          counts([...options, '--format', '-e', '-f', '-h', '-M', '-o', '-q', '-v', '-V']),
        );
      });

      it('jsonkit paths --<Tab> lists long spellings alone', async () => {
        const { listed } = await complete('jsonkit paths --');
        expect(counts(listed)).toEqual(counts([...options, '--format']));
      });

      it('an option already given is not listed again', async () => {
        const { listed } = await complete('jsonkit paths --format json --');
        expect(counts(listed)).toEqual(counts(options));
      });

      it('the counted --verbose is listed again after it was given', async () => {
        const { listed } = await complete('jsonkit -v keys --');
        expect(counts(listed)).toEqual(counts(options));
      });

      it('--verbose is not listed once -vv is given, because the verbosity stops at 2', async () => {
        const { listed } = await complete('jsonkit -v keys -v --');
        expect(counts(listed)).toEqual(counts(options.filter((word) => word !== '--verbose')));
      });

      it('--quiet is not listed once -q is given, because a further -q adds nothing', async () => {
        const { listed } = await complete('jsonkit -q keys --');
        expect(counts(listed)).toEqual(counts(options.filter((word) => word !== '--quiet')));
      });

      it("select's multiple --field is listed again after it was given", async () => {
        const { listed } = await complete('jsonkit select --field name --');
        expect(counts(listed)).toEqual(counts([...options, '--field']));
      });
    });

    describe('Values', () => {
      it('jsonkit paths --format <Tab> lists the view names', async () => {
        const { listed } = await complete('jsonkit paths --format ');
        expect(counts(listed)).toEqual(counts(views));
      });

      it('jsonkit paths --format=<Tab> lists the view names after the lead', async () => {
        const { listed } = await complete('jsonkit paths --format=');
        // Bash lists the words after the last `=`, a word break; Zsh and Fish list whole words.
        const names = listed.map((word) => word.replace(/^--format=/u, ''));
        expect(counts(names)).toEqual(counts(views));
      });

      it('jsonkit paths --format=t<Tab> inserts the whole --format=table word', async () => {
        const { line } = await complete('jsonkit paths --format=t');
        expect(line.trimEnd()).toBe('jsonkit paths --format=table');
      });

      // PowerShell's Tab inserts no common prefix of several matches.
      // Its own file completion offers each name with a leading ./ on Linux and macOS.
      it.runIf(shell !== 'pwsh')('jsonkit --file d<Tab> falls back to file names', async () => {
        const { line } = await complete('jsonkit --file d');
        expect(line).toBe('jsonkit --file doc-');
      });

      it.runIf(shell === 'pwsh')(
        'jsonkit --file d<Tab> falls back to the file names PowerShell lists',
        async () => {
          const { listed } = await complete('jsonkit --file d');
          const names = listed.map((word) => word.replace(/^\.\//u, ''));
          expect(counts(names)).toEqual(counts(['doc-a.json', 'doc-b.json']));
        },
      );

      it('jsonkit paths --format a<Tab> matches no view and offers no file name either', async () => {
        await expect(complete('jsonkit paths --format a')).resolves.toMatchObject({
          line: 'jsonkit paths --format a',
          listed: [],
        });
      });
    });

    describe('Failing closed', () => {
      it('an unknown command earlier in the line inserts and lists nothing', async () => {
        await expect(complete('jsonkit nope a')).resolves.toMatchObject({
          line: 'jsonkit nope a',
          listed: [],
        });
      });

      it('a misplaced option earlier in the line inserts and lists nothing', async () => {
        await expect(complete('jsonkit -F name s')).resolves.toMatchObject({
          line: 'jsonkit -F name s',
          listed: [],
        });
      });

      it('an unclosed quote under the cursor inserts and lists nothing', async () => {
        await expect(complete('jsonkit get "a')).resolves.toMatchObject({
          line: 'jsonkit get "a',
          listed: [],
        });
      });
    });
  });

  describe.skipIf(!installed).each(failures)(
    'a failing jsonkit that $callback',
    ({ callback, title }) => {
      const { complete } = useSession({ callback, files, main, name: 'jsonkit', shell, sources });

      it(`${title} inserts and lists nothing, file names included`, async () => {
        await expect(complete('jsonkit get a')).resolves.toMatchObject({
          line: 'jsonkit get a',
          listed: [],
        });
      });
    },
  );
});
