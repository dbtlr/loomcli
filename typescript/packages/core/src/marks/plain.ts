import { registerRule } from '../diagnostics/diagnostic-text.js';
import { factFault } from '../diagnostics/facts.js';
import type { FactSite } from '../diagnostics/facts.js';
import { quoted } from '../failures/wording.js';
import type { OptionSpelling } from '../inputs/options.js';
import type { OptionConfig } from '../inputs/types.js';
import { isMarked } from './marks.js';
import type { Mark } from './marks.js';

const plainMark = registerRule('@loomcli/core/plain-mark', {
  explanation:
    "One Boolean global option may carry the spelling that turns the run's plain switch on. Core reads it from argv right after host capture, before anything else prints, so it takes no second source, and ACCESSIBLE is the environment's word for the switch.",
  headline: 'Invalid plain mark',
});

/** The plain mark, whose option's spellings the run reads from argv before anything else prints. */
const plain: Mark = { fact: 'plain', rule: plainMark, type: 'boolean' };

/**
 * A marked option carries no value of the installed configuration source's binding, because the
 * run reads its plain switch before configuration. `carried` is the identity of the installed
 * source's binding when the option's extension record carries it, and `undefined` otherwise.
 */
function checkPlainBinding(
  config: OptionConfig,
  site: FactSite,
  carried: string | undefined,
): void {
  if (!isMarked(config, plain) || carried === undefined) {
    return;
  }
  throw factFault(plainMark, site, {
    correction: 'Remove the binding; the run reads its plain switch before configuration.',
    fact: 'extensions',
    sentence: `${site.subject} declares plain and carries configuration binding ${quoted(carried)}, a second source for the run's plain switch.`,
  });
}

/**
 * Whether the run's plain switch is on: a word of argv before the first bare `--` equals one of
 * `spellings`, the marked option's long spellings, or `ACCESSIBLE` is set and not empty, which
 * core reads in every Application, marked or not. A word that attaches a value equals no
 * spelling, so it turns nothing on.
 */
function plainSwitch(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  spellings: ReadonlyMap<string, OptionSpelling> | undefined,
): boolean {
  if ((env.ACCESSIBLE ?? '') !== '') {
    return true;
  }
  if (spellings === undefined) {
    return false;
  }
  const end = argv.indexOf('--');
  return (end === -1 ? argv : argv.slice(0, end)).some((word) => spellings.has(word));
}

export { checkPlainBinding, plain, plainSwitch };
