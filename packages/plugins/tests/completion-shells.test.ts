import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

import { shellSuites, useSession } from '../../../scripts/test-shell.js';

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
        const { line } = await complete(`kit keys \\${typed}`);
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
});
