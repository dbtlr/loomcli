import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

import { shellSuites, useSession } from '../../../scripts/test-shell.js';
import type { Shell } from '../../../scripts/test-shell.js';
import { zshInstalledScript } from '../src/completion/zsh.js';

const fixture = new URL('fixtures/completion.mjs', import.meta.url);

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
  });

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

      // A Bash with compopt hands the fallback to its own default file completion, which may
      // Append a file name found under the expanded directory while leaving the typed text.
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
});
