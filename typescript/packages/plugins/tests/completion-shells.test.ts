// Acceptance plan: see packages/plugins/tests/completion.test.ts.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  homeEnvironment,
  openSession,
  runInHome,
  shellSuites,
  useSession,
} from '../../../scripts/test-shell.js';
import type { SessionOptions, Shell } from '../../../scripts/test-shell.js';
import { nuScript } from '../src/completion/nu.js';
import { zshInstalledScript } from '../src/completion/zsh.js';

const fixture = new URL('fixtures/completion.mjs', import.meta.url);

/** The program words each shell types before `ca`, a quoted one read without its quotes. */
const quotedPrograms: Record<Shell, string[]> = {
  bash: ['kit'],
  fish: ['kit', "'kit'"],
  nu: ['kit'],
  pwsh: ['kit', "& 'kit'"],
  zsh: ['kit', "'kit'"],
};

/** The Commands `kit <Tab>` lists: the visible root children. */
const commands = ['cache', 'completion', 'keys', 'paths'];

/** The lines of a `.zshrc` that starts the completion system the way Zsh's manual shows. */
const compinit = ['autoload -Uz compinit', 'compinit'];

/** Programs that answer nothing a script may offer, each with the case title it proves. */
const failures: { callback: NonNullable<SessionOptions['callback']>; title: string }[] = [
  { callback: 'exits nonzero', title: 'a callback that exits nonzero' },
  { callback: 'prints a bare colon', title: 'an answer whose directive line is a bare colon' },
];

/** The temporary folders of the cases that start a shell from a home of their own. */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Removes one level of POSIX or Fish quoting from an inserted word: backslash escapes and single
 * quotes, which are the forms the scripts insert.
 */
function unquoted(word: string): string {
  return word.replaceAll(
    /\\(?<escaped>.)|'(?<quoted>[^']*)'/gu,
    (_match, escaped?: string, quoted?: string) => escaped ?? quoted ?? '',
  );
}

/**
 * The words of a Zsh command line as Zsh reads them: split by its parser and with one level of
 * quoting removed, which expands nothing and runs nothing.
 */
function zshWords(line: string): string[] {
  // A Zsh parameter expansion, written so it reads as no template placeholder.
  const program = `print -rN -- "\${(@Q)\${(z)1}}"`;
  const result = spawnSync('zsh', ['-f', '-c', program, 'zsh', line], { encoding: 'utf8' });
  return result.stdout.split('\0').slice(0, -1);
}

/**
 * A typed character the shell reads as itself: escaped with a backslash in Bash, Zsh, and Fish,
 * and single-quoted in PowerShell, where a backslash is an ordinary character.
 */
function literal(shell: Shell, character: string): string {
  return shell === 'pwsh' ? `'${character}'` : `\\${character}`;
}

/** A case's temporary home, which its shells start from, and its working directory. */
interface Sandbox {
  home: string;
  cwd: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-install-'));
  roots.push(root);
  const box = { cwd: join(root, 'work'), home: join(root, 'home') };
  mkdirSync(box.cwd);
  mkdirSync(box.home);
  return box;
}

/** The lines of a `.zshrc` before and after the startup line, and the umask `install` runs under. */
interface Layout {
  before: readonly string[];
  after: readonly string[];
  umask?: string;
}

/** Runs `kit completion install <shell>` in the home, and fails the case when it fails. */
function install(box: Sandbox, shell: Shell, umask?: string): void {
  const args = ['completion', 'install', shell];
  const result = runInHome({
    ...box,
    args,
    main: fixture,
    ...(umask === undefined ? {} : { umask }),
  });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

/**
 * Writes the `.zshrc` lines before the startup line, installs Zsh's in the home, and appends the
 * lines after it, so the startup line stands where the layout puts it.
 */
function zshrcAround(box: Sandbox, { after, before, umask }: Layout): void {
  const zshrc = join(box.home, '.zshrc');
  if (before.length > 0) {
    writeFileSync(zshrc, `${before.join('\n')}\n`);
  }
  install(box, 'zsh', umask);
  appendFileSync(zshrc, after.map((line) => `${line}\n`).join(''));
  const lines = readFileSync(zshrc, 'utf8').split('\n');
  expect(lines.slice(0, before.length)).toEqual(before);
  expect(lines[before.length]).toMatch(/# added by kit completion install$/u);
  expect(lines.slice(before.length + 1)).toEqual([...after, '']);
}

/** What a shell did: the words `kit <Tab>` listed, and its start's output. */
interface Started {
  listed: string[];
  startup: string;
}

/** Starts the shell from the home, as an operator opens a terminal, and presses Tab after `kit `. */
async function tabFromHome(box: Sandbox, shell: Shell): Promise<Started> {
  const session = await openSession({ ...box, main: fixture, name: 'kit', shell });
  try {
    const { listed } = await session.complete('kit ');
    return { listed, startup: session.startup };
  } finally {
    await session.close();
  }
}

describe.each(shellSuites())('$title', ({ installed, shell, sources }) => {
  describe.skipIf(!installed)("the parser's grammar", () => {
    const { complete } = useSession({ main: fixture, name: 'kit', shell, sources });

    it("kit paths -qf <Tab> lists the values the group's last value letter awaits", async () => {
      const { listed } = await complete('kit paths -qf ');
      expect(listed.toSorted()).toEqual(['json', 'jsonl', 'table']);
    });

    it('kit paths -qft<Tab> inserts the value attached to the value letter', async () => {
      const { line } = await complete('kit paths -qft');
      expect(line.trimEnd()).toBe('kit paths -qftable');
    });

    it('kit backups -v --verb<Tab> inserts the counted --verbose again', async () => {
      const { line } = await complete('kit backups -v --verb');
      expect(line.trimEnd()).toBe('kit backups -v --verbose');
    });

    it('kit backups --backup=<Tab> lists the values of the option with an implied value', async () => {
      const { listed } = await complete('kit backups --backup=');
      // Bash lists the words after the last `=`, a word break; Zsh and Fish list whole words.
      const values = listed.map((word) => word.replace(/^--backup=/u, ''));
      expect(values.toSorted()).toEqual(['none', 'numbered', 'simple']);
    });

    it('kit backups --backup <Tab> lists what the next word may be and no value', async () => {
      const { listed } = await complete('kit backups --backup ');
      expect(listed.toSorted()).toEqual(['disk', 'tape']);
    });

    it('a misplaced option earlier in the line inserts and lists nothing', async () => {
      await expect(complete('kit -q paths -')).resolves.toMatchObject({
        line: 'kit -q paths -',
        listed: [],
      });
    });

    it('kit stats depth m<Tab> inserts max, three levels below the root', async () => {
      const { line } = await complete('kit stats depth m');
      expect(line.trimEnd()).toBe('kit stats depth max');
    });

    it('kit stats depth max --fi<Tab> inserts the option in scope three levels down', async () => {
      const { line } = await complete('kit stats depth max --fi');
      expect(line.trimEnd()).toBe('kit stats depth max --file');
    });
  });

  // The directory holds alpha.json, so a file name offered by mistake shows in the line.
  describe.skipIf(!installed)('failing closed', () => {
    const { complete } = useSession({
      files: ['alpha.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it('an unknown command earlier in the line inserts and lists nothing', async () => {
      await expect(complete('kit nope a')).resolves.toMatchObject({
        line: 'kit nope a',
        listed: [],
      });
    });

    // The typed word starts like alpha.json, so a shell that fell back to file names would show it.
    it('an unclosed quote under the cursor inserts and lists nothing', async () => {
      await expect(complete('kit keys "a')).resolves.toMatchObject({
        line: 'kit keys "a',
        listed: [],
      });
    });
  });

  // The directory holds two documents that start with `d` and one that does not.
  describe.skipIf(!installed)('the file fallback', () => {
    const { complete } = useSession({
      files: ['alpha.json', 'doc-a.json', 'doc-b.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    // PowerShell's Tab inserts no common prefix of several matches.
    // Its own file completion offers each name with a leading ./ on Linux and macOS.
    it.runIf(shell !== 'pwsh')('kit --file d<Tab> falls back to file names', async () => {
      const { line } = await complete('kit --file d');
      expect(line).toBe('kit --file doc-');
    });

    it.runIf(shell === 'pwsh')(
      'kit --file d<Tab> falls back to the file names PowerShell lists',
      async () => {
        const { listed } = await complete('kit --file d');
        expect(listed.map((word) => word.replace(/^\.\//u, '')).toSorted()).toEqual([
          'doc-a.json',
          'doc-b.json',
        ]);
      },
    );
  });

  // Bash finds no completion for a quoted program word, so only Zsh, Fish, and PowerShell type one.
  // PowerShell types it after its call operator, because a quoted word alone is a string.
  describe.skipIf(!installed).each(quotedPrograms[shell])('the program word %s', (program) => {
    const { complete } = useSession({ main: fixture, name: 'kit', shell, sources });

    it(`${program} ca<Tab> inserts cache, the program word read without its quotes`, async () => {
      const { line } = await complete(`${program} ca`);
      expect(line.trimEnd()).toBe(`${program} cache`);
    });
  });

  describe.skipIf(!installed).each(failures)(
    'a failing kit that $callback',
    ({ callback, title }) => {
      const { complete } = useSession({
        callback,
        files: ['alpha.json'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it(`${title} inserts and lists nothing, file names included`, async () => {
        await expect(complete('kit --file a')).resolves.toMatchObject({
          line: 'kit --file a',
          listed: [],
        });
      });
    },
  );

  describe.skipIf(!installed)('typed text is never evaluated', () => {
    const { complete, cwd } = useSession({ main: fixture, name: 'kit', shell, sources });
    const sentinel = () => existsSync(join(cwd(), 'sentinel'));

    // Nushell reads a typed $, backtick, or ; as its own syntax, so its values are checked below.
    // Nushell reads a bare true, false, or null as a keyword, so as an argument to the extern it is a
    // Parse error. The script quotes exactly those three, and the inserted text is read as a string.
    it.runIf(shell === 'nu').each(['true', 'false', 'null'])(
      'kit odd words %s<Tab> inserts a quoted word that parses as the string',
      async (value) => {
        const { line } = await complete(`kit odd words ${value.slice(0, 3)}`);
        const inserted = line.slice('kit odd words '.length).trimEnd();
        expect(inserted).toBe(`\`${value}\``);
        const probe = spawnSync(
          'nu',
          [
            '--no-config-file',
            '-c',
            `def probe [...a: string] { $a | to json -r }; probe ${inserted}`,
          ],
          { encoding: 'utf8' },
        );
        expect(probe.stdout.trim()).toBe(`["${value}"]`);
      },
    );

    it.skipIf(shell === 'nu').each([
      ['$', '$(touch sentinel)'],
      ['`', '`touch sentinel`'],
      [';', ';touch sentinel'],
    ])(
      'a closed-set value that starts with %s is inserted as quoted text',
      async (typed, value) => {
        const { line } = await complete(`kit keys ${literal(shell, typed)}`);
        const inserted = line.slice('kit keys '.length).trimEnd();
        expect(line.startsWith('kit keys ')).toBe(true);
        expect(inserted).not.toBe(value);
        expect(unquoted(inserted)).toBe(value);
        expect(sentinel()).toBe(false);
      },
    );

    it.skipIf(shell === 'nu')(
      'the listed values leave out the one holding a newline and every other unsafe value',
      async () => {
        const { listed } = await complete('kit keys ');
        // Bash lists each word escaped, as it would insert it.
        expect(listed.map((word) => unquoted(word)).toSorted()).toEqual(
          ['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'].toSorted(),
        );
        expect(sentinel()).toBe(false);
      },
    );

    // Nushell lists each value as it inserts it.
    // That is a bare word, or a string that holds the value as text.
    it.runIf(shell === 'nu')(
      'the listed values are each a bare word or a string, never code',
      async () => {
        const { listed } = await complete('kit keys ');
        expect(listed.toSorted()).toEqual(
          ['plain', '`$(touch sentinel)`', '"`touch sentinel`"', '`;touch sentinel`'].toSorted(),
        );
        expect(sentinel()).toBe(false);
      },
    );

    it.each(['kit "$(touch sentinel)" ', 'kit $(touch sentinel) ', 'kit keys `touch sentinel` '])(
      'a typed word in %s reaches the program as text and runs nothing',
      async (typed) => {
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        expect(sentinel()).toBe(false);
      },
    );

    // PowerShell's Tab inserts no common prefix of several matches, so only the other shells do.
    // Nushell inserts the prefix inside a string it leaves open, which the case below checks.
    describe.runIf(shell !== 'pwsh' && shell !== 'nu')(
      'the common prefix of several values',
      () => {
        it.each([
          [String.raw`\$`, '$(touch sentinel)'],
          [String.raw`a\ `, 'a b'],
        ])(
          'several values that share a prefix insert the prefix after %s as quoted text',
          async (typed, prefix) => {
            const { line } = await complete(`kit odd values ${typed}`);
            const inserted = line.slice('kit odd values '.length).trimEnd();
            expect(line.startsWith('kit odd values ')).toBe(true);
            expect(inserted).not.toBe(prefix);
            expect(unquoted(inserted)).toBe(prefix);
            expect(sentinel()).toBe(false);
          },
        );
      },
    );

    it.runIf(shell === 'nu').each([
      ['p', '`p\\q`'],
      ['r', '`r\\:s`'],
    ])('a value after %s that holds a backslash inserts as the string %s', async (typed, value) => {
      const { line } = await complete(`kit odd values ${typed}`);
      expect(line.slice('kit odd values '.length).trimEnd()).toBe(value);
      expect(sentinel()).toBe(false);
    });

    it.skipIf(shell === 'nu').each([
      ['p', String.raw`p\q`],
      ['r', String.raw`r\:s`],
    ])('a value after %s that holds a backslash inserts as %s', async (typed, value) => {
      const { line } = await complete(`kit odd values ${typed}`);
      expect(unquoted(line.slice('kit odd values '.length).trimEnd())).toBe(value);
    });

    it('a description holding a colon and a backslash is shown as text and splits no word', async () => {
      const { listed, listing } = await complete('kit odd ');
      expect(listed.toSorted()).toEqual(['colon', 'values', 'words']);
      expect(listing).toContain(String.raw`One: two \ three.`);
      const { line } = await complete('kit odd c');
      expect(line.trimEnd()).toBe('kit odd colon');
    });

    describe.runIf(shell === 'bash')('the Bash file fallback', () => {
      it.each([
        'kit --file $((x[$(touch sentinel)]))/',
        // A shell parameter expansion, written so it reads as no template placeholder.
        `kit --file \${HOME[$(touch sentinel)]}/`,
      ])('reads %s as text: it runs nothing and rewrites nothing', async (typed) => {
        const { line } = await complete(typed);
        expect(line).toBe(typed);
        expect(sentinel()).toBe(false);
      });

      // A Bash with compopt hands the fallback to its own default file completion.
      // That completion may append a file name found under the expanded directory while leaving the typed text.
      it('reads kit --file $HOME/ as text: the typed word stays and nothing runs', async () => {
        const typed = 'kit --file $HOME/';
        const { line } = await complete(typed);
        expect(line.startsWith(typed)).toBe(true);
        expect(line).not.toContain(process.env.HOME ?? '\u0000');
        expect(sentinel()).toBe(false);
      });
    });

    describe.runIf(shell === 'bash')('the Bash quoting of a ~', () => {
      // Bash expands a ~ after = or : in a word shaped like an assignment when the line runs.
      it.each([
        ['a=', String.raw`a=\~root`],
        ['x', String.raw`x:\~root`],
        ['b', String.raw`b=\~root`],
      ])('a value completed from %s inserts every ~ escaped as %s', async (typed, inserted) => {
        const { line } = await complete(`kit odd values ${typed}`);
        expect(line.slice('kit odd values '.length).trimEnd()).toBe(inserted);
      });
    });

    /**
     * The script inserts a value with a space as a backtick string, so its scanner must read its own
     * quoting back as one word. It also reads a double-quoted string with a backtick or an escaped
     * quote, and a raw string, as one word.
     */
    it.runIf(shell === 'nu').each([
      ['a backtick string with a space', '`a b`'],
      ['a backtick string that holds a quote and a backslash', '`a "b\' \\ c`'],
      ['a double-quoted string that holds a backtick', '"a`b c"'],
      ['a double-quoted string that holds an escaped quote', String.raw`"a\"b c"`],
      ["the script's own double-quoted form of a backtick and a quote", `"a\`\\"b c"`],
      ['a raw string with a space', "r#'a b'#"],
      ['a raw string with two # that holds a quote and a #', "r##'a 'b'# c'##"],
    ])('--fo<Tab> completes an option after %s', async (_title, value) => {
      const typed = `kit paths --field ${value} --fo`;
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(`${typed}rmat`);
      expect(sentinel()).toBe(false);
    });

    // A quoted span inside a bare word belongs to that word, as Nushell reads it.
    it.runIf(shell === 'nu').each([
      ['an option with a double-quoted value attached', 'kit paths --field="a b" --fo'],
      ['an option with a single-quoted value attached', "kit paths --field='a b' --fo"],
      ['a value with a single-quoted span in it', "kit paths --field foo'b c' --fo"],
    ])('--fo<Tab> completes an option after %s', async (_title, typed) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(`${typed}rmat`);
      expect(sentinel()).toBe(false);
    });

    it.runIf(shell === 'nu').each([
      ['an unclosed backtick string', 'kit paths --field `a b --fo'],
      ['an unclosed span inside a word', "kit paths --field='a b --fo"],
      ['an unclosed raw string', "kit paths --field r#'a b --fo"],
      ['a raw string closed by too few #', "kit paths --field r##'a b'# --fo"],
      ['an unclosed quote in an interpolation', 'kit paths --field $"x(echo " b --fo'],
    ])('%s offers nothing', async (_title, typed) => {
      await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
      expect(sentinel()).toBe(false);
    });

    it
      .runIf(shell === 'nu')
      .each(['kit "pa', 'kit paths "--fo', "kit paths '--fo", 'kit paths `--fo'])(
      '%s<Tab> offers nothing with an unclosed quote under the cursor',
      async (typed) => {
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
      },
    );

    // The call is the words after the last unquoted | or ; or newline, or an open ( or {.
    // Whatever comes before the call never reaches the program.
    it.runIf(shell === 'nu').each([
      ['echo x | kit ke', 'echo x | kit keys'],
      ['echo x; kit ke', 'echo x; kit keys'],
      ['do { kit ke', 'do { kit keys'],
      ['let a = (kit ke', 'let a = (kit keys'],
      ['echo x | kit paths --fo', 'echo x | kit paths --format'],
      ['echo "a|b; (c" | kit ke', 'echo "a|b; (c" | kit keys'],
      ['let a = [(kit ke', 'let a = [(kit keys'],
      ['echo [x (kit paths --fo', 'echo [x (kit paths --format'],
      ['let a = {k: (kit ke', 'let a = {k: (kit keys'],
    ])('%s<Tab> completes the call that follows the boundary', async (typed, expected) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(expected);
      expect(sentinel()).toBe(false);
    });

    /**
     * A closed ( … ) or { … } before the cursor is one word of the call, such as a subexpression
     * passed as an option's value, so the words before it still reach the program.
     */
    it
      .runIf(shell === 'nu')
      .each([
        'kit paths --field (whoami) --fo',
        'kit paths --field {a: 1} --fo',
        'kit paths --field (echo (whoami)) --fo',
        'kit paths --field report(1).json --fo',
      ])('%s<Tab> completes the option after a closed group', async (typed) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(`${typed}rmat`);
      expect(sentinel()).toBe(false);
    });

    it
      .runIf(shell === 'nu')
      .each([
        'kit paths --field $"x(echo " b ")" --fo',
        'kit paths --field [b c] --fo',
        'kit paths --field $"x(^touch "sentinel")" --fo',
      ])('%s<Tab> completes the option without evaluating the value', async (typed) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(`${typed}rmat`);
      expect(sentinel()).toBe(false);
    });

    /**
     * The words the script reads from a line, asked of its word reader directly, because a line
     * with a newline in it is not typed at a pty prompt.
     */
    it.runIf(shell === 'nu').each([
      ['echo x\nkit ke', ['ke']],
      ['echo x\r\nkit ke', ['ke']],
      ['kit paths --field (whoami) --fo', ['paths', '--field', '(whoami)', '--fo']],
      ['kit paths --field report(1).json --fo', ['paths', '--field', 'report(1).json', '--fo']],
      ['kit a (echo x | kit b', ['b']],
      ['kit a $"x(echo " b ")" --fo', ['a', 'x(echo " b ")', '--fo']],
      ['kit a $"x(echo "b")" --fo', ['a', 'x(echo "b")', '--fo']],
      ['kit a $"abc" --fo', ['a', 'abc', '--fo']],
      ["kit a $'a(b)c' --fo", ['a', 'a(b)c', '--fo']],
      [String.raw`kit a $"x\(b" --fo`, ['a', String.raw`x\(b`, '--fo']],
      ['kit a $"x(echo (echo " b "))" --fo', ['a', 'x(echo (echo " b "))', '--fo']],
      ['kit a $"x(echo (echo a) " b ")" --fo', ['a', 'x(echo (echo a) " b ")', '--fo']],
      ['kit a $"x(echo `a " b`)" --fo', ['a', 'x(echo `a " b`)', '--fo']],
      ['kit a $"x(echo $"y(echo " b ")")" --fo', ['a', 'x(echo $"y(echo " b ")")', '--fo']],
      ["kit a $'x(echo ' b ')' --fo", ['a', "x(echo ' b ')", '--fo']],
      [String.raw`kit a $'x\(echo ' b ')' --fo`, ['a', String.raw`x\(echo ' b ')`, '--fo']],
      [String.raw`kit a $'x\' --fo`, ['a', 'x\\', '--fo']],
      ['kit a [b c] --fo', ['a', '[b c]', '--fo']],
      ['kit a [b " c "] --fo', ['a', '[b " c "]', '--fo']],
      ['kit a report[b c].json --fo', ['a', 'report[b c].json', '--fo']],
      ['kit a b] --fo', ['a', 'b]', '--fo']],
    ])('the words of %j are %j', (line, words) => {
      const folder = sandbox().cwd;
      const file = join(folder, 'kit.nu');
      writeFileSync(file, nuScript('kit'));
      const result = spawnSync(
        'nu',
        ['--no-config-file', '-c', `source ${file}; __kit_words $env.LINE | get word | to json -r`],
        { encoding: 'utf8', env: { ...process.env, LINE: line } },
      );
      expect(result.stdout.trim()).toBe(JSON.stringify(words));
    });

    /**
     * The extern changes how Nushell runs the program, not only how it completes, so with the script
     * loaded a bare glob and a ~ still reach the program expanded, and a quoted one as typed, as
     * they do with no script. The application here is the system printf.
     */
    it.runIf(shell === 'nu')(
      'the script leaves how Nushell passes arguments to the program',
      () => {
        const folder = sandbox().cwd;
        writeFileSync(join(folder, 'a.txt'), '');
        writeFileSync(join(folder, 'b.txt'), '');
        writeFileSync(join(folder, 'printf.nu'), nuScript('printf'));
        const run = (source: string) =>
          spawnSync(
            'nu',
            ['--no-config-file', '-c', `${source}printf '<%s>' *.txt '*.txt' ~ 1 --x=y (echo z)`],
            { cwd: folder, encoding: 'utf8', env: { ...process.env, HOME: folder } },
          ).stdout;
        expect(run('source ./printf.nu; ')).toBe(run(''));
        expect(run('')).toBe(`<a.txt><b.txt><*.txt><${folder}><1><--x=y><z>`);
      },
    );

    it.runIf(shell === 'nu')(
      'a | or ; inside a quoted value before the cursor is no call boundary',
      async () => {
        const typed = 'kit paths --field "a|b;c" --fo';
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(`${typed}rmat`);
      },
    );

    it('a typed $(...) value is read as the option value it is, and completion continues past it', async () => {
      const { line } = await complete('kit paths --field "$(touch sentinel)" --fo');
      expect(line.trimEnd()).toBe('kit paths --field "$(touch sentinel)" --format');
      expect(sentinel()).toBe(false);
    });
  });

  describe.runIf(installed && shell === 'pwsh')('PowerShell reads typed text as data', () => {
    const { complete, cwd } = useSession({
      main: fixture,
      name: 'kit',
      // A .cmd file the program word can resolve to, which records that it ran.
      programs: { 'kit.cmd': 'touch sentinel' },
      shell,
      sources,
    });
    const sentinel = () => existsSync(join(cwd(), 'sentinel'));
    const curly = String.fromCodePoint(8217);

    it.each(['kit $(New-Item sentinel) ', 'kit "$(New-Item sentinel)" '])(
      'a typed word in %s reaches the program as text and runs nothing',
      async (typed) => {
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        expect(sentinel()).toBe(false);
      },
    );

    it('a typed $(New-Item sentinel) value is read as the option value it is', async () => {
      const { line } = await complete('kit paths --field $(New-Item sentinel) --fo');
      expect(line).toBe('kit paths --field $(New-Item sentinel) --format ');
      expect(sentinel()).toBe(false);
    });

    it('an offered value holding $(New-Item sentinel) is inserted single-quoted', async () => {
      const { line } = await complete("kit quotes '$(New'");
      expect(line).toBe("kit quotes '$(New-Item sentinel)' ");
      expect(sentinel()).toBe(false);
    });

    it('an offered value holding U+2019 is inserted single-quoted with the U+2019 doubled', async () => {
      const { line } = await complete('kit quotes it');
      expect(line).toBe(`kit quotes 'it${curly}${curly}s' `);
      const { listed } = await complete('kit quotes ');
      expect(listed.toSorted()).toEqual(["'$(New-Item sentinel)'", `'it${curly}${curly}s'`]);
      expect(sentinel()).toBe(false);
    });

    it('an empty word and a word holding " reach the program as they are', async () => {
      const { line } = await complete(`kit paths --field '' --field 'a"b c' --fo`);
      expect(line).toBe(`kit paths --field '' --field 'a"b c' --format `);
    });

    it('a completed Command name is followed by a space', async () => {
      await expect(complete('kit pa')).resolves.toMatchObject({ line: 'kit paths ' });
    });

    it('a program that resolves to a .cmd file offers nothing and is never called', async () => {
      await expect(complete('kit.cmd keys ')).resolves.toMatchObject({
        line: 'kit.cmd keys ',
        listed: [],
      });
      expect(sentinel()).toBe(false);
    });
  });

  describe.runIf(installed && shell === 'pwsh')(
    'PowerShell with $PSNativeCommandArgumentPassing set to Legacy',
    () => {
      const { complete } = useSession({
        before: ["$PSNativeCommandArgumentPassing = 'Legacy'"],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it('an empty last word reaches the program, so the next word is completed', async () => {
        const { listed } = await complete('kit keys ');
        expect(listed.map((word) => unquoted(word)).toSorted()).toEqual(
          ['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'].toSorted(),
        );
      });

      it('an empty word and a word holding " before the cursor reach the program as they are', async () => {
        const { line } = await complete(`kit paths --field '' --field 'a"b c\\' --fo`);
        expect(line).toBe(`kit paths --field '' --field 'a"b c\\' --format `);
      });
    },
  );

  describe.skipIf(!installed)('a quoted word reaches the program unexpanded', () => {
    const { complete, cwd } = useSession({
      callback: 'records its words',
      files: ['a.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it.runIf(shell === 'nu').each(['kit paths [b c', 'kit paths [b --fo'])(
      '%s<Tab> in an open list offers nothing without a call',
      async (typed) => {
        const received = join(cwd(), 'received');
        rmSync(received, { force: true });
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        expect(existsSync(received)).toBe(false);
      },
    );

    /** The words the program received on its last call, one per line in the file it wrote. */
    const received = () => readFileSync(join(cwd(), 'received'), 'utf8').split('\n').slice(0, -1);

    it.runIf(shell === 'nu')("keeps the r in a word starting with r' and no #", async () => {
      await complete("kit paths --field r'a b' --fo");
      expect(received()).toEqual([
        'completion',
        '__complete',
        '--',
        'paths',
        '--field',
        'ra b',
        '--fo',
      ]);
    });

    it.each(["'~'", "'*.json'"])(
      'a typed %s before the cursor reaches the program as it is, not expanded',
      async (typed) => {
        await complete(`kit keys ${typed} `);
        expect(received()).toEqual([
          'completion',
          '__complete',
          '--',
          'keys',
          typed.slice(1, -1),
          '',
        ]);
      },
    );
  });

  describe.runIf(installed && shell === 'zsh')('the installed Zsh file', () => {
    describe.each(['files', 'describe'])('for an application named %s', (name) => {
      const { complete } = useSession({
        files: ['alpha.json'],
        installed: { file: `_loom_${name}`, text: zshInstalledScript(name) },
        main: fixture,
        name,
        shell,
        sources,
      });

      it(`${name} <Tab> lists its Commands`, async () => {
        const { listed } = await complete(`${name} `);
        expect(listed.toSorted()).toEqual(['cache', 'completion', 'keys', 'paths']);
      });

      it("Zsh's own file completion still works after it", async () => {
        const { line } = await complete('ls alp');
        expect(line.trimEnd()).toBe('ls alpha.json');
      });
    });

    describe('loaded by a .zshrc that never ran compinit', () => {
      const { complete } = useSession({
        installed: { file: '_loom_kit', text: zshInstalledScript('kit') },
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it('registers its completion and completes the Commands', async () => {
        const { line } = await complete('kit pa');
        expect(line.trimEnd()).toBe('kit paths');
      });
    });
  });

  describe.skipIf(!installed)('after kit completion install alone', () => {
    // PowerShell's session dot-sources the home's profile itself.
    // Its case proves that the line install writes there completes; loading the profile at startup is pwsh's own behavior.
    const started =
      shell === 'pwsh'
        ? 'a pwsh that dot-sources its profile'
        : `a ${shell} started from the home, through its own startup files,`;

    it(`${started} completes kit <Tab>`, async () => {
      const box = sandbox();
      install(box, shell);
      const { listed, startup } = await tabFromHome(box, shell);
      // Zsh's startup is the one that may ask: its .zshrc never ran compinit.
      expect(startup).not.toContain('?');
      expect(listed.toSorted()).toEqual(commands);
    });
  });

  describe.runIf(installed && shell === 'zsh')('a .zshrc around the startup line', () => {
    const layouts: (Layout & { title: string })[] = [
      {
        after: compinit,
        before: compinit,
        title: 'that runs compinit before the line and again after it',
      },
    ];

    it.each(layouts)('$title completes kit <Tab> and asks nothing', async (layout) => {
      const box = sandbox();
      zshrcAround(box, layout);
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(listed.toSorted()).toEqual(commands);
    });

    it('whose only compinit runs after the line completes kit <Tab> on a second start, asking nothing', async () => {
      const box = sandbox();
      zshrcAround(box, { after: compinit, before: [] });
      const first = await tabFromHome(box, 'zsh');
      expect(first.startup).not.toContain('?');
      expect(first.listed.toSorted()).toEqual(commands);
      expect(existsSync(join(box.home, '.zcompdump'))).toBe(true);
      const second = await tabFromHome(box, 'zsh');
      expect(second.startup).not.toContain('?');
      expect(second.listed.toSorted()).toEqual(commands);
    }, 60_000);

    it('with an insecure folder on fpath completes kit <Tab> and asks nothing', async () => {
      const box = sandbox();
      const insecure = join(box.home, 'site-functions');
      mkdirSync(insecure);
      // World-writable, because compaudit excuses a group-writable folder whose group is the user's own, as on Ubuntu.
      chmodSync(insecure, 0o777);
      // Zsh's own audit names the folder, so the case proves the line with one it judges insecure.
      const audit = spawnSync(
        'zsh',
        ['-f', '-c', 'fpath=("$1" $fpath); autoload -Uz compaudit; compaudit', 'zsh', insecure],
        { encoding: 'utf8', env: homeEnvironment(box.home) },
      );
      expect(audit.stdout).toContain(insecure);
      zshrcAround(box, { after: [], before: [`fpath=('${insecure}' $fpath)`] });
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(listed.toSorted()).toEqual(commands);
    });

    it('installed under umask 002, with a plain compinit after the line, completes kit <Tab> and asks nothing', async () => {
      const box = sandbox();
      zshrcAround(box, { after: compinit, before: [], umask: '002' });
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(listed.toSorted()).toEqual(commands);
    });
  });
});

const helpFixture = new URL('fixtures/completion-help.mjs', import.meta.url);

/**
 * The names a listing offers, without the `./` PowerShell puts before one, the `/` that marks a
 * folder, or the `--option=` that Fish and PowerShell write before each name after an attached
 * value. Bash may print several names on one listing line.
 */
function names(listed: readonly string[]): string[] {
  return listed
    .flatMap((word) => word.split(/\s+/u))
    .map((word) =>
      word
        .replace(/^--[a-z]+=/u, '')
        .replace(/^\.\//u, '')
        .replace(/\/$/u, ''),
    )
    .toSorted();
}

describe.each(shellSuites())('$title', ({ installed, shell, sources }) => {
  // The directory holds JSON and CSV documents, a text file, an archive, a name whose extension
  // Differs from json only in case, and two folders.
  describe.skipIf(!installed || shell === 'nu')('a static value hint on file names', () => {
    const { complete } = useSession({
      files: [
        'A.JSON',
        'alpha.json',
        'beta.json',
        'notes.txt',
        'one.csv',
        'two.csv',
        'x.tar.gz',
        'docs/',
        'more/',
      ],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it.each(['kit scan --config ', 'kit scan --config='])(
      '%s<Tab> lists the JSON files and the folders, and no other file',
      async (line) => {
        const { listed } = await complete(line);
        expect(names(listed)).toEqual(['alpha.json', 'beta.json', 'docs', 'more']);
      },
    );

    it.each(['kit scan --into ', 'kit scan --into='])(
      '%s<Tab> lists the folders only',
      async (line) => {
        const { listed } = await complete(line);
        expect(names(listed)).toEqual(['docs', 'more']);
      },
    );

    it('kit scan <Tab> lists the CSV files and the folders for the argument', async () => {
      const { listed } = await complete('kit scan ');
      expect(names(listed)).toEqual(['docs', 'more', 'one.csv', 'two.csv']);
    });

    it('kit scan --config=a<Tab> inserts the one JSON file that starts with a', async () => {
      const { line } = await complete('kit scan --config=a');
      expect(line.trimEnd()).toBe('kit scan --config=alpha.json');
    });

    it('kit scan --into=d<Tab> inserts the folder that starts with d, and no file', async () => {
      const { line } = await complete('kit scan --into=d');
      expect(line.trimEnd()).toBe('kit scan --into=docs/');
    });

    // The one name that starts with x is a file no hint accepts, so no shell falls back to it.
    // An extension compares by case, so A.JSON is no JSON file in any shell, bash-completion's
    // Case-insensitive listing included.
    it.each([
      'kit scan --config A',
      'kit scan --into x',
      'kit scan --into=x',
      'kit scan --config x',
      'kit scan --config=x',
    ])(
      '%s<Tab> leaves the line as it is, because no name it may take starts with what was typed',
      async (typed) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(typed);
      },
    );

    // PowerShell splits a bare native argument that starts with one - and holds a . at that dot.
    // The PowerShell script inserts such a word single-quoted, so the program receives it whole.
    it.each([
      ['kit scan -ca', shell === 'pwsh' ? "kit scan '-calpha.json'" : 'kit scan -calpha.json'],
      ['kit scan -id', 'kit scan -idocs/'],
    ])('%s<Tab> completes the value attached to the short option as %s', async (typed, done) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(done);
    });
  });

  // The option path takes any string and data takes file names, so each completes every file name.
  // Zsh binds Tab to complete-word, which runs completion alone, so only the script can evaluate.
  // PowerShell inserts a word that starts with one - and holds a . single-quoted.
  describe.skipIf(!installed || shell === 'nu')(
    'a value attached to an option that leaves the shell its file names',
    () => {
      const { complete, cwd } = useSession({
        before: shell === 'zsh' ? ["bindkey '^I' complete-word"] : [],
        files: ['alpha.json', 'notes.txt', 'docs/'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });
      const quoted = (word: string) => (shell === 'pwsh' ? `'${word}'` : word);

      it.each([
        ['kit scan -pa', `kit scan ${quoted('-palpha.json')}`],
        ['kit scan -vpa', `kit scan ${quoted('-vpalpha.json')}`],
        ['kit scan -pn', `kit scan ${quoted('-pnotes.txt')}`],
        ['kit scan -pdo', 'kit scan -pdocs/'],
        ['kit scan -da', `kit scan ${quoted('-dalpha.json')}`],
        ['kit scan -vda', `kit scan ${quoted('-vdalpha.json')}`],
        ['kit scan -p=a', `kit scan ${quoted('-p=alpha.json')}`],
        ['kit scan --path=a', 'kit scan --path=alpha.json'],
        ['kit scan --data=n', 'kit scan --data=notes.txt'],
      ])('%s<Tab> inserts the file name behind the lead as %s', async (typed, done) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(done);
      });

      it.each(['kit scan -p$(touch PWNED)/', 'kit scan -vd$(touch PWNED)/'])(
        '%s<Tab> runs nothing the typed word holds',
        async (typed) => {
          const { line } = await complete(typed);
          expect(line.startsWith(typed)).toBe(true);
          expect(existsSync(join(cwd(), 'PWNED'))).toBe(false);
        },
      );
    },
  );

  /**
   * A word that ends at its lead, as in `--path=` or `-p=`, gets no lead from the answer under
   * directive 0, so the Zsh and PowerShell scripts read the lead from the word itself. The folder
   * holds one visible name, so the listing inserts it, and a dot-name the listing leaves out. The
   * option label hints `none`, so its word lists nothing. After `--` on paths, the passthrough
   * position answers directive 0 with no word, so a typed word there reaches the script's reading.
   * Bash leaves such a word to readline's own file completion, which lists the dot-name too, so
   * its cases that insert the one name are not run.
   */
  describe.skipIf(!installed || shell === 'nu')(
    'a value attached to an option whose word ends at its lead',
    () => {
      const { complete, cwd } = useSession({
        before: shell === 'zsh' ? ["bindkey '^I' complete-word"] : [],
        files: ['.hidden.json', 'alpha.json'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });
      const quoted = (word: string) => (shell === 'pwsh' ? `'${word}'` : word);

      it.skipIf(shell === 'bash').each([
        ['kit scan --path=', 'kit scan --path=alpha.json'],
        ['kit scan --data=', 'kit scan --data=alpha.json'],
        ['kit scan -p=', `kit scan ${quoted('-p=alpha.json')}`],
        ['kit scan -vp=', `kit scan ${quoted('-vp=alpha.json')}`],
        ['kit scan --path=a', 'kit scan --path=alpha.json'],
        ['kit paths -- --x=', 'kit paths -- --x=alpha.json'],
      ])('%s<Tab> inserts the file name behind the lead as %s', async (typed, done) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(done);
      });

      it.each(['kit scan --label=', 'kit scan -l='])(
        '%s<Tab> lists nothing, because the option completes no file name',
        async (typed) => {
          await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        },
      );

      it
        .runIf(shell === 'zsh' || shell === 'pwsh')
        .each([
          'kit paths -- --x$(touch PWNED)=',
          ...(shell === 'zsh' ? ['kit paths -- --x`touch PWNED`='] : []),
        ])('%s<Tab> reads no lead and runs nothing the typed word holds', async (typed) => {
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        expect(existsSync(join(cwd(), 'PWNED'))).toBe(false);
      });
    },
  );

  /**
   * PowerShell's parser splits a bare word that starts with one `-` and a letter at its first `.`,
   * so `-pnotes.` reaches the completer as `-pnotes` and a touching `.`, and `-px.tar.` as `-px` and
   * `.tar.`. The script reads a word under the cursor that starts with `.` and touches the
   * parameter before it as one word. PowerShell replaces only the part after the parameter, so
   * the script inserts the rest of the word single-quoted, as in `-pnotes'.txt'`, which a program
   * receives as the one word `-pnotes.txt`. The option `path` answers directive 0, `config`
   * directive 8, and `into` directive 16. A dot-name the spaced word names shows that `-c .j` stays
   * two words.
   */
  describe.runIf(installed && shell === 'pwsh')(
    'PowerShell reads a value attached to its short option across the dot it splits at',
    () => {
      const { complete, cwd } = useSession({
        files: ['.journal.json', 'alpha.json', 'notes.txt', 'x.tar.gz', 'v1.d/'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it.each([
        ['kit scan -pnotes.', "kit scan -pnotes'.txt'"],
        ['kit scan -palpha.j', "kit scan -palpha'.json'"],
        ['kit scan -px.tar.', "kit scan -px'.tar.gz'"],
        ['kit scan -p./no', "kit scan -p'./notes.txt'"],
        ['kit scan -calpha.', "kit scan -calpha'.json'"],
        ['kit scan -calpha.j', "kit scan -calpha'.json'"],
        ['kit scan -iv1.', "kit scan -iv1'.d/'"],
      ])('%s<Tab> inserts the name behind the lead as %s', async (typed, done) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(done);
      });

      it('kit scan -c .j<Tab> reads two words and inserts the dot-name as the value', async () => {
        const { line } = await complete('kit scan -c .j');
        expect(line.trimEnd()).toBe('kit scan -c .journal.json');
      });

      it.each(['kit scan -p$(touch PWNED).', 'kit scan -pnotes.$(touch PWNED).'])(
        '%s<Tab> runs nothing the typed word holds',
        async (typed) => {
          const { line } = await complete(typed);
          expect(line.startsWith(typed)).toBe(true);
          expect(existsSync(join(cwd(), 'PWNED'))).toBe(false);
        },
      );
    },
  );

  /**
   * A backtick escapes a space in the part after the split, so ``-pnotes.` j`` reaches the
   * completer as `-pnotes` and a touching ``.` j``, whose value is `. j`. The script joins the
   * parameter with that value, as it reads a word that is not split, so the word matches the name
   * `notes. january.txt`. A suffix that holds an unescaped `$(…)` is an expandable string, which
   * the script passes as typed and never evaluates.
   */
  describe.runIf(installed && shell === 'pwsh')(
    'PowerShell reads an escape in the part of a split word after its dot',
    () => {
      const { complete, cwd } = useSession({
        files: ['notes. january.txt', 'beta. one.json', 'v2. d/'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it.each([
        ['kit scan -pnotes.` j', "kit scan -pnotes'. january.txt'"],
        ['kit scan -cbeta.` o', "kit scan -cbeta'. one.json'"],
        ['kit scan -iv2.` d', "kit scan -iv2'. d/'"],
      ])('%s<Tab> inserts the name behind the lead as %s', async (typed, done) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(done);
      });

      it.each([
        // Each form reaches the joined word: PowerShell calls the script for it.
        'kit scan -pnotes.` $(touch PWNED)x',
        'kit scan -pnotes.` j$(touch PWNED)/',
      ])('%s<Tab> runs nothing the typed word holds', async (typed) => {
        const { line } = await complete(typed);
        expect(line.startsWith(typed)).toBe(true);
        expect(existsSync(join(cwd(), 'PWNED'))).toBe(false);
      });
    },
  );

  // Tab is bound to complete-word, which runs completion alone, so only the script can evaluate.
  // HOME is the home folder in the working directory, so a typed ~/ lists files the test wrote.
  // A dynamic named directory hook touches the sentinel, so a typed ~[x] that reaches it shows.
  describe.runIf(installed && shell === 'zsh')('the Zsh listing of file names', () => {
    const { complete, cwd } = useSession({
      before: [
        "bindkey '^I' complete-word",
        'HOME=$PWD/home',
        'zsh_directory_name() { touch sentinel; return 1; }',
      ],
      files: [
        '.hidden.json',
        'alpha.json',
        'docs/',
        'docs/a.json',
        'docs/b.csv',
        'docs/inner/',
        'empty/',
        'home/',
        'home/h.json',
        'home/idir/',
        'spaced/',
        'spaced/my dir/',
        'spaced/my dir/c.json',
      ],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });
    const sentinel = () => join(cwd(), 'sentinel');

    /** Whether the typed text ran a command, and the sentinel removed so the next case starts clean. */
    const ran = (): boolean => {
      const found = existsSync(sentinel());
      rmSync(sentinel(), { force: true });
      return found;
    };

    const typedFolders = [
      '$(touch sentinel)/',
      '`touch sentinel`/',
      // A parameter subscript, written so it reads as no template placeholder.
      `\${HOME[$(touch sentinel)]}/`,
      '$((x[$(touch sentinel)]))/',
      "x(e:'touch sentinel':)/",
      "*(e:'touch sentinel':)",
      '=(touch sentinel)/',
      '~/$(touch sentinel)/',
      '~[x]/',
    ];
    const typedLeads = [
      'kit --file ',
      'kit scan --config ',
      'kit scan --config=',
      'kit scan -c',
      'kit scan --into ',
      'kit scan --into=',
      'kit scan -i',
    ];

    it.each(typedLeads.flatMap((lead) => typedFolders.map((folder) => `${lead}${folder}`)))(
      '%s<Tab> runs nothing the typed word holds',
      async (typed) => {
        const { line } = await complete(typed);
        expect(line.startsWith(typed)).toBe(true);
        expect(ran()).toBe(false);
      },
    );

    it.each([
      ['kit --file docs/', ['a.json', 'b.csv', 'inner']],
      ['kit scan --config docs/', ['a.json', 'inner']],
      ['kit --file ~/', ['h.json', 'idir']],
      ['kit scan --config ', ['alpha.json', 'docs', 'empty', 'home', 'spaced']],
    ])('%s<Tab> lists %j', async (typed, listed) => {
      const { listed: found } = await complete(typed);
      expect(names(found)).toEqual(listed);
    });

    it.each([
      ['kit scan --config ./docs/a', 'kit scan --config ./docs/a.json'],
      ['kit scan --config docs/inner/../a', 'kit scan --config docs/inner/../a.json'],
      ['kit scan --config=docs/a', 'kit scan --config=docs/a.json'],
      ['kit scan -cdocs/a', 'kit scan -cdocs/a.json'],
      ['kit scan --into=docs/i', 'kit scan --into=docs/inner/'],
      ['kit scan -idocs/i', 'kit scan -idocs/inner/'],
      ['kit scan --config ~/h', 'kit scan --config ~/h.json'],
      ['kit scan --into ~/', 'kit scan --into ~/idir/'],
      ['kit scan --into docs/', 'kit scan --into docs/inner/'],
      ['kit scan --config .', 'kit scan --config .hidden.json'],
      [String.raw`kit scan --config spaced/my\ d`, String.raw`kit scan --config spaced/my\ dir/`],
      [
        String.raw`kit scan --config spaced/my\ dir/`,
        String.raw`kit scan --config spaced/my\ dir/c.json`,
      ],
      ['kit --file docs/b', 'kit --file docs/b.csv'],
    ])('%s<Tab> inserts %s', async (typed, done) => {
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(done);
    });

    it('a sole folder takes no space after it, and a sole file one', async () => {
      await expect(complete('kit scan --into=docs/i')).resolves.toMatchObject({
        line: 'kit scan --into=docs/inner/',
      });
      await expect(complete('kit scan --config=docs/a')).resolves.toMatchObject({
        line: 'kit scan --config=docs/a.json ',
      });
    });

    it('an absolute folder lists the names in it', async () => {
      const typed = `kit scan --config ${cwd()}/docs/a`;
      const { line } = await complete(typed);
      expect(line.trimEnd()).toBe(`${typed}.json`);
    });

    it('a typed $HOME/ is read as text: it lists nothing and stays as typed', async () => {
      const typed = 'kit scan --into $HOME/';
      await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
    });

    it.each([
      'kit scan --config empty/',
      'kit --file empty/',
      'kit scan --into empty/',
      'kit scan --config missing/',
      'kit --file missing/a',
      'kit scan --into=missing/',
    ])('%s<Tab> lists nothing, says nothing, and leaves the line as typed', async (typed) => {
      await expect(complete(typed)).resolves.toEqual({ line: typed, listed: [], listing: '' });
    });
  });

  // The matcher-list below is the oh-my-zsh and prezto default.
  // It matches a typed lowercase letter against an uppercase one, and the format heads each group.
  describe.runIf(installed && shell === 'zsh')(
    "the Zsh listing under the operator's styles",
    () => {
      const { complete } = useSession({
        before: [
          "bindkey '^I' complete-word",
          "zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'",
          "zstyle ':completion:*:descriptions' format 'heading:%d'",
        ],
        files: ['Docs/', 'Docs/Readme.json', 'More/', 'Notes.json', 'Notes.csv'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it.each([
        ['kit scan --config doc', 'kit scan --config Docs/'],
        ['kit scan --config=doc', 'kit scan --config=Docs/'],
        ['kit --file doc', 'kit --file Docs/'],
        ['kit scan --into doc', 'kit scan --into Docs/'],
        ['kit scan --into=doc', 'kit scan --into=Docs/'],
        ['kit scan --config Docs/r', 'kit scan --config Docs/Readme.json'],
        ['kit scan --config n', 'kit scan --config Notes.json'],
      ])('%s<Tab> matches by the matcher-list and inserts %s', async (typed, done) => {
        const { line } = await complete(typed);
        expect(line.trimEnd()).toBe(done);
      });

      it.each([
        ['kit scan --config ', 'heading:file'],
        ['kit --file ', 'heading:file'],
        ['kit scan --into ', 'heading:directory'],
      ])('%s<Tab> lists under the format heading %s', async (typed, heading) => {
        const { listing } = await complete(typed);
        expect(listing).toContain(heading);
      });
    },
  );

  // Zsh reads a leading ~ as a home folder and a leading = as a command's path, so each is escaped.
  describe.runIf(installed && shell === 'zsh')('the Zsh listing of a sole ~ name', () => {
    const { complete } = useSession({
      before: ["bindkey '^I' complete-word"],
      files: ['~lead.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    // A bare -c is read as the option itself, so the short option's case types the value's ~.
    it.each([
      ['kit --file ', '~lead.json'],
      ['kit scan --config ', '~lead.json'],
      ['kit scan --config=', '--config=~lead.json'],
      [String.raw`kit scan -c\~`, '-c~lead.json'],
    ])('%s<Tab> inserts the word %s and a space after it', async (typed, word) => {
      const { line } = await complete(typed);
      expect(line.endsWith(String.raw`\~lead.json `)).toBe(true);
      expect(zshWords(line).at(-1)).toBe(word);
    });
  });

  describe.runIf(installed && shell === 'zsh')('the Zsh listing of names with a lead', () => {
    const { complete } = useSession({
      before: ["bindkey '^I' complete-word"],
      files: ['~lead.json', '~load.json', '=eq.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it.each([
      [String.raw`kit --file \~le`, String.raw`kit --file \~lead.json `],
      [String.raw`kit scan --config \~lo`, String.raw`kit scan --config \~load.json `],
      [String.raw`kit --file \=`, String.raw`kit --file \=eq.json `],
      [String.raw`kit scan --config=\=`, String.raw`kit scan --config=\=eq.json `],
    ])('%s<Tab> inserts the one name it matches as %s', async (typed, done) => {
      await expect(complete(typed)).resolves.toMatchObject({ line: done });
    });

    it('several names that share an escaped prefix insert it', async () => {
      const { line } = await complete(String.raw`kit --file \~`);
      expect(line).toBe(String.raw`kit --file \~l`);
    });

    // Every name starts with an escaped character, so the backslash is their shared prefix.
    // Zsh's own _files inserts it too.
    it('kit scan --config <Tab> inserts the backslash every quoted name starts with', async () => {
      const { line } = await complete('kit scan --config ');
      expect(line).toBe('kit scan --config \\');
    });

    it.each(['kit scan --config \\', 'kit --file \\'])(
      '%s<Tab> lists each name as text',
      async (typed) => {
        const { line, listed } = await complete(typed);
        expect(line).toBe(typed);
        expect(names(listed)).toEqual(['=eq.json', '~lead.json', '~load.json']);
      },
    );
  });

  // Each name below holds a character Zsh reads as syntax, and no other name starts like it.
  // Zsh adds no space after a word it ends in $'…' quoting, so only the inserted word is checked.
  describe.runIf(installed && shell === 'zsh')(
    'the Zsh listing of a name Zsh reads as syntax',
    () => {
      const special = [
        'a b.json',
        'c*.json',
        'd[.json',
        'e(.json',
        'f#.json',
        'g!.json',
        'h$.json',
        'i;.json',
        "j'.json",
        'k\nl.json',
        'm~n.json',
        'o=p.json',
      ];
      const { complete } = useSession({
        before: ["bindkey '^I' complete-word"],
        files: ['odd/', ...special.map((name) => `odd/${name}`)],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });

      it.each(
        special.flatMap((name) =>
          ['kit scan --config ', 'kit --file '].map((lead) => [lead, name]),
        ),
      )('%sodd/<first letter><Tab> inserts the name %j exactly', async (lead, name) => {
        const { line } = await complete(`${lead}odd/${name[0]}`);
        expect(zshWords(line).at(-1)).toBe(`odd/${name}`);
      });
    },
  );

  // Nushell offers no extension and no lead as a value: under a hint the script returns nothing, so
  // Nushell lists the file names itself, every one, and lists none after an attached `=`.
  describe.runIf(installed && shell === 'nu')(
    'a static value hint on file names in Nushell',
    () => {
      const { complete } = useSession({
        files: ['A.JSON', 'alpha.json', 'notes.txt', 'one.csv', 'x.tar.gz', 'docs/'],
        main: fixture,
        name: 'kit',
        shell,
        sources,
      });
      const every = ['A.JSON', 'alpha.json', 'docs', 'notes.txt', 'one.csv', 'x.tar.gz'];

      it.each(['kit scan --config ', 'kit scan --into ', 'kit scan '])(
        '%s<Tab> lists every file name and offers no extension as a value',
        async (line) => {
          const { listed } = await complete(line);
          expect(names(listed)).toEqual(every);
        },
      );

      it.each(['kit scan --config=', 'kit scan --into=', 'kit scan --config=a'])(
        '%s<Tab> lists and inserts nothing, because Nushell completes no file name after an =',
        async (typed) => {
          await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        },
      );

      it.each(['kit scan -pa', 'kit scan -vpa', 'kit scan -da', 'kit scan --path=a'])(
        '%s<Tab> lists and inserts nothing, because the lead of an attached value is no value',
        async (typed) => {
          await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        },
      );

      it('kit scan --config x<Tab> inserts the name Nushell finds, which no hint narrows', async () => {
        const { line } = await complete('kit scan --config x');
        expect(line.trimEnd()).toBe('kit scan --config x.tar.gz');
      });
    },
  );

  describe.runIf(installed && shell === 'nu')('an attached value under directive 0', () => {
    const { complete } = useSession({
      files: ['-palpha.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it('kit scan -pa<Tab> falls back to Nushell file completion', async () => {
      const { line } = await complete('kit scan -pa');
      expect(line.trimEnd()).toBe('kit scan `-palpha.json`');
    });
  });

  describe.runIf(installed && shell === 'fish')('the Fish listing of hinted file names', () => {
    // A name that holds a tab would split the listing line, so Fish leaves it out.
    const { complete } = useSession({
      files: ['ok.json', 'tab\tname.json'],
      main: fixture,
      name: 'kit',
      shell,
      sources,
    });

    it('kit scan --config <Tab> lists ok.json and leaves out the name that holds a tab', async () => {
      const { listed } = await complete('kit scan --config ');
      expect(listed).toEqual(['ok.json']);
    });
  });

  // `task` has the children `show` and `shelve`, and a hidden `shred`; `tidy` is hidden at the root.
  describe.skipIf(!installed)('the help Command', () => {
    const { complete } = useSession({
      main: helpFixture,
      name: 'app',
      shell,
      sources,
    });

    it('app help ta<Tab> inserts task, the one Command that starts with ta', async () => {
      const { line } = await complete('app help ta');
      expect(line.trimEnd()).toBe('app help task');
    });

    it('app help t<Tab> lists task and team and never the hidden tidy', async () => {
      const { listed } = await complete('app help t');
      expect(names(listed)).toEqual(['task', 'team']);
    });

    it('app help task sh<Tab> lists the children show and shelve and never the hidden shred', async () => {
      const { listed } = await complete('app help task sh');
      expect(names(listed)).toEqual(['shelve', 'show']);
    });

    it('app help task shel<Tab> inserts shelve', async () => {
      const { line } = await complete('app help task shel');
      expect(line.trimEnd()).toBe('app help task shelve');
    });
  });
});

const dynamicFixture = new URL('fixtures/completion-dynamic.mjs', import.meta.url);

describe.each(shellSuites())('$title', ({ installed, shell, sources }) => {
  // The values come from the author's own function, which narrows by the word typed so far. The
  // Directory holds files that start like the values, so a shell that fell back to file names shows.
  describe.skipIf(!installed)('a named completer', () => {
    const { complete } = useSession({
      files: ['q-local.json', 'task-1-local.json'],
      main: dynamicFixture,
      name: 'kit',
      shell,
      sources,
    });

    it.each(['kit task --id ', 'kit task --id=', 'kit task '])(
      '%s<Tab> lists every value, with the description beside it',
      async (line) => {
        const { listed, listing } = await complete(line);
        expect(names(listed)).toEqual(['task-1', 'task-2', 'zeta']);
        expect(listing).toContain('Fix the build.');
        expect(listing).toContain('Write the docs.');
      },
    );

    it('kit task --id=task-<Tab> lists the two values that start with task-', async () => {
      const { listed } = await complete('kit task --id=task-');
      expect(names(listed)).toEqual(['task-1', 'task-2']);
    });

    it('kit task --id=ze<Tab> inserts the one value that starts with ze', async () => {
      const { line } = await complete('kit task --id=ze');
      expect(line.trimEnd()).toBe('kit task --id=zeta');
    });

    it('kit task --id task-1<Tab> inserts the value, and no file name', async () => {
      const { line } = await complete('kit task --id task-1');
      // The macOS Bash 3.2 session uses a completion spec that suppresses the space.
      const appendsSpace = shell === 'bash' && process.platform !== 'darwin';
      expect(appendsSpace ? line : line.trimEnd()).toBe(
        appendsSpace ? 'kit task --id task-1 ' : 'kit task --id task-1',
      );
    });

    it('kit task --id q<Tab> offers nothing and no file name', async () => {
      const { line, listed } = await complete('kit task --id q');
      expect(line.trimEnd()).toBe('kit task --id q');
      expect(listed).toEqual([]);
    });
  });
});
