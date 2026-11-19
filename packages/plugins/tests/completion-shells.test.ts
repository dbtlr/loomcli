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
import { zshInstalledScript } from '../src/completion/zsh.js';

const fixture = new URL('fixtures/completion.mjs', import.meta.url);

/** The program words each shell types before `ca`, a quoted one read without its quotes. */
const quotedPrograms: Record<Shell, string[]> = {
  bash: ['kit'],
  fish: ['kit', "'kit'"],
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

    it('an unclosed quote under the cursor inserts and lists nothing', async () => {
      await expect(complete('kit keys "p')).resolves.toMatchObject({
        line: 'kit keys "p',
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

    it.each([
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

    it('the listed values leave out the one holding a newline and every other unsafe value', async () => {
      const { listed } = await complete('kit keys ');
      // Bash lists each word escaped, as it would insert it.
      expect(listed.map((word) => unquoted(word)).toSorted()).toEqual(
        ['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'].toSorted(),
      );
      expect(sentinel()).toBe(false);
    });

    it.each(['kit "$(touch sentinel)" ', 'kit $(touch sentinel) ', 'kit keys `touch sentinel` '])(
      'a typed word in %s reaches the program as text and runs nothing',
      async (typed) => {
        await expect(complete(typed)).resolves.toMatchObject({ line: typed, listed: [] });
        expect(sentinel()).toBe(false);
      },
    );

    // PowerShell's Tab inserts no common prefix of several matches, so only the other shells do.
    describe.runIf(shell !== 'pwsh')('the common prefix of several values', () => {
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
    });

    it.each([
      ['p', String.raw`p\q`],
      ['r', String.raw`r\:s`],
    ])('a value after %s that holds a backslash inserts as %s', async (typed, value) => {
      const { line } = await complete(`kit odd values ${typed}`);
      expect(unquoted(line.slice('kit odd values '.length).trimEnd())).toBe(value);
    });

    it('a description holding a colon and a backslash is shown as text and splits no word', async () => {
      const { listed, listing } = await complete('kit odd ');
      expect(listed.toSorted()).toEqual(['colon', 'values']);
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

    /** The words the program received on its last call, one per line in the file it wrote. */
    const received = () => readFileSync(join(cwd(), 'received'), 'utf8').split('\n').slice(0, -1);

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
  describe.skipIf(!installed)('a static value hint on file names', () => {
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
      ['kit scan --config ', ['alpha.json', 'docs', 'home', 'spaced']],
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
      expect(line.trimEnd()).toBe('kit task --id task-1');
    });

    it('kit task --id q<Tab> offers nothing and no file name', async () => {
      const { line, listed } = await complete('kit task --id q');
      expect(line.trimEnd()).toBe('kit task --id q');
      expect(listed).toEqual([]);
    });
  });
});
