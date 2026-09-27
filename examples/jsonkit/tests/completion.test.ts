import { describe, expect, it } from 'vite-plus/test';

import { shellSuites, useSession } from '../../../scripts/test-shell.js';
import { main } from './documents.js';

/** The documents in each session's directory: `d` completes to `doc-`, and `a` to `alp`. */
const files = ['alpha.json', 'alpine.json', 'doc-a.json', 'doc-b.json'];

/** The options in scope at every jsonkit Command: the global option and the plugin options. */
const options = ['--explain', '--file', '--help', '--manifest', '--version'];

/** The view names of the `paths` rows. */
const views = ['json', 'jsonl', 'list', 'table'];

/** Each word with how often it appears, so a comparison ignores the order a shell lists in. */
function counts(words: readonly string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const word of words) {
    tally.set(word, (tally.get(word) ?? 0) + 1);
  }
  return tally;
}

describe.each(shellSuites())('$title', ({ installed, shell }) => {
  describe.skipIf(!installed)('jsonkit completes', () => {
    const { complete } = useSession({ files, main, name: 'jsonkit', shell });

    describe('Commands', () => {
      it('jsonkit <Tab> lists the visible root children and never a deprecated, hidden, or alias name', async () => {
        const { listed } = await complete('jsonkit ');
        expect(counts(listed)).toEqual(counts(['completion', 'doctor', 'get', 'keys', 'select']));
      });

      it('jsonkit ls --<Tab> lists the options in scope at keys, global and plugin options included', async () => {
        const { listed } = await complete('jsonkit ls --');
        expect(counts(listed)).toEqual(counts(options));
      });

      it('jsonkit completion <Tab> lists the three shells and never __complete', async () => {
        const { listed } = await complete('jsonkit completion ');
        expect(counts(listed)).toEqual(counts(['bash', 'fish', 'zsh']));
      });
    });

    describe('Options', () => {
      it('jsonkit paths -<Tab> lists long and short spellings', async () => {
        const { listed } = await complete('jsonkit paths -');
        expect(counts(listed)).toEqual(counts([...options, '--format', '-f', '-h', '-V']));
      });

      it('jsonkit paths --<Tab> lists long spellings alone', async () => {
        const { listed } = await complete('jsonkit paths --');
        expect(counts(listed)).toEqual(counts([...options, '--format']));
      });

      it('an option already given is not listed again', async () => {
        const { listed } = await complete('jsonkit paths --format json --');
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
    });

    describe('Failing closed', () => {
      it('an unknown command earlier in the line inserts and lists nothing', async () => {
        await expect(complete('jsonkit nope a')).resolves.toEqual({
          line: 'jsonkit nope a',
          listed: [],
        });
      });

      it('an unclosed quote under the cursor inserts and lists nothing', async () => {
        await expect(complete('jsonkit get "a')).resolves.toEqual({
          line: 'jsonkit get "a',
          listed: [],
        });
      });
    });
  });

  describe.skipIf(!installed)('a failing jsonkit', () => {
    const { complete } = useSession({
      callback: 'exits nonzero',
      files,
      main,
      name: 'jsonkit',
      shell,
    });

    it('a callback that exits nonzero inserts and lists nothing, file names included', async () => {
      await expect(complete('jsonkit get a')).resolves.toEqual({
        line: 'jsonkit get a',
        listed: [],
      });
    });
  });
});
