import { describe, expect, it } from 'vite-plus/test';

import { shellSuites, useSession } from '../../../scripts/test-shell.js';
import type { SessionOptions } from '../../../scripts/test-shell.js';
import { main } from './documents.js';

/** The documents in each session's directory: `d` completes to `doc-`, and `a` to `alp`. */
const files = ['alpha.json', 'alpine.json', 'doc-a.json', 'doc-b.json'];

/** The options in scope at every jsonkit Command: the global options, the application's and each plugin's. */
const options = ['--explain', '--file', '--help', '--manifest', '--verbose', '--version'];

/** The view names of the `paths` rows. */
const views = ['json', 'jsonl', 'list', 'table'];

/** Programs that answer nothing a script may offer, each with the case title it proves. */
const failures: { callback: NonNullable<SessionOptions['callback']>; title: string }[] = [
  { callback: 'exits nonzero', title: 'a callback that exits nonzero' },
  { callback: 'prints a bare colon', title: 'an answer whose directive line is a bare colon' },
];

/** Each word with how often it appears, so a comparison ignores the order a shell lists in. */
function counts(words: readonly string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const word of words) {
    tally.set(word, (tally.get(word) ?? 0) + 1);
  }
  return tally;
}

describe.each(shellSuites())('$title', ({ installed, shell, sources }) => {
  describe.skipIf(!installed)('jsonkit completes', () => {
    const { complete } = useSession({ files, main, name: 'jsonkit', shell, sources });

    describe('Commands', () => {
      it('jsonkit <Tab> lists the visible root children and never a deprecated, hidden, or alias name', async () => {
        const { listed } = await complete('jsonkit ');
        expect(counts(listed)).toEqual(
          counts(['completion', 'doctor', 'get', 'keys', 'mcp', 'select']),
        );
      });

      it('jsonkit ls --<Tab> lists the options in scope at keys, global and plugin options included', async () => {
        const { listed } = await complete('jsonkit ls --');
        expect(counts(listed)).toEqual(counts(options));
      });

      it('jsonkit completion <Tab> lists the three shells and never __complete', async () => {
        const { listed } = await complete('jsonkit completion ');
        expect(counts(listed)).toEqual(counts(['bash', 'fish', 'zsh']));
      });

      // Bash finds no completion for a quoted program word, so only Zsh and Fish type one.
      it.each(shell === 'bash' ? ['jsonkit'] : ['jsonkit', "'jsonkit'"])(
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
          counts([...options, '--format', '-e', '-f', '-h', '-M', '-o', '-v', '-V']),
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
        const { listed } = await complete('jsonkit -v keys -v --');
        expect(counts(listed)).toEqual(counts(options));
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

      it('jsonkit --file d<Tab> falls back to file names', async () => {
        const { line } = await complete('jsonkit --file d');
        expect(line).toBe('jsonkit --file doc-');
      });

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
