import type { Background } from './background.js';
import { registerRule } from './diagnostic-text.js';
import { quoted } from './errors.js';
import { factFault } from './facts.js';
import type { FactSite } from './facts.js';
import { isMarked } from './marks.js';
import type { Mark } from './marks.js';
import type { OptionSpelling } from './options.js';
import { refusesValue } from './parse.js';
import type { OptionConfig } from './types.js';

const backgroundMark = registerRule('@loomcli/core/background-mark', {
  explanation:
    "One string global option may carry the operator's background choice. Core reads it from argv right after host capture, beside the color choice and before anything else prints, so it takes no short alias and no second source.",
  headline: 'Invalid background mark',
});

/** The background mark, whose option the run reads from argv beside the color choice. */
const background: Mark = { fact: 'background', rule: backgroundMark, type: 'string' };

/**
 * A marked option carries no value of the installed configuration source's binding, because the
 * run reads its background before configuration. `carried` is the identity of the installed
 * source's binding when the option's extension record carries it, and `undefined` otherwise.
 */
function checkBackgroundBinding(
  config: OptionConfig,
  site: FactSite,
  carried: string | undefined,
): void {
  if (!isMarked(config, background) || carried === undefined) {
    return;
  }
  throw factFault(backgroundMark, site, {
    correction: 'Remove the binding; the run reads its background before configuration.',
    fact: 'extensions',
    sentence: `${site.subject} declares background and carries configuration binding ${quoted(carried)}, a second source for the run's background.`,
  });
}

/** A background a word names: `dark` or `light`, and `undefined` for any other word. */
function named(value: string | undefined): Background | undefined {
  return value === 'dark' || value === 'light' ? value : undefined;
}

/**
 * The value the marked spelling at `index` supplies, attached after `=` or the next word unless
 * that word is an option word or the bare `--`, as the parse reads it, and the index of the first
 * word after the occurrence. A word that is no marked spelling supplies nothing.
 */
function occurrence(
  argv: readonly string[],
  index: number,
  spellings: ReadonlyMap<string, OptionSpelling>,
): { value: string | undefined; next: number } {
  const word = argv[index] ?? '';
  const equals = word.indexOf('=');
  if (equals > 0 && spellings.has(word.slice(0, equals))) {
    return { next: index + 1, value: word.slice(equals + 1) };
  }
  const following = argv[index + 1];
  if (spellings.has(word) && following !== undefined && !refusesValue(following)) {
    return { next: index + 2, value: following };
  }
  return { next: index + 1, value: undefined };
}

/**
 * The run's background choice from argv alone: among the words before the first bare `--`, the
 * last occurrence of a marked spelling, read against `spellings`, the marked option's long
 * spellings, whose value is `dark` or `light`.
 */
function backgroundChoice(
  argv: readonly string[],
  spellings: ReadonlyMap<string, OptionSpelling>,
): Background | undefined {
  let choice: Background | undefined = undefined;
  let index = 0;
  while (index < argv.length && argv[index] !== '--') {
    const read = occurrence(argv, index, spellings);
    choice = named(read.value) ?? choice;
    index = read.next;
  }
  return choice;
}

export { background, backgroundChoice, checkBackgroundBinding };
