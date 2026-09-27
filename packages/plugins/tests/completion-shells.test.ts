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

describe.each(shellSuites())('$title', ({ installed, shell }) => {
  describe.skipIf(!installed)('typed text is never evaluated', () => {
    const { complete, cwd } = useSession({ main: fixture, name: 'kit', shell });
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
      expect(listed.toSorted()).toEqual(
        ['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'].toSorted(),
      );
      expect(sentinel()).toBe(false);
    });

    it.each(['kit "$(touch sentinel)" ', 'kit $(touch sentinel) ', 'kit keys `touch sentinel` '])(
      'a typed word in %s reaches the program as text and runs nothing',
      async (typed) => {
        await expect(complete(typed)).resolves.toEqual({ line: typed, listed: [] });
        expect(sentinel()).toBe(false);
      },
    );

    it('a typed $(...) value is read as the option value it is, and completion continues past it', async () => {
      const { line } = await complete('kit paths --field "$(touch sentinel)" --fo');
      expect(line.trimEnd()).toBe('kit paths --field "$(touch sentinel)" --format');
      expect(sentinel()).toBe(false);
    });
  });
});
