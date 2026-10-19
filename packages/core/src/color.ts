import { registerRule } from './diagnostic-text.js';
import { quoted } from './errors.js';
import { factFault } from './facts.js';
import type { FactSite } from './facts.js';
import { checkMarkPlacement, isMarked } from './marks.js';
import type { Mark } from './marks.js';
import type { OptionSpelling } from './options.js';
import type { RenderingPolicy } from './rendering.js';
import type { OptionConfig } from './types.js';

const colorMark = registerRule('@loomcli/core/color-mark', {
  explanation:
    "One Boolean global option may carry the operator's color choice. Core reads it from argv right after host capture, before anything else prints, so it takes no short alias and no second source.",
  headline: 'Invalid color mark',
});

/** The color an operator's spelling sets for the run: `'always'` or `'never'`. */
type ColorChoice = 'always' | 'never';

/** The color mark, whose option the run reads from argv before anything else prints. */
const color: Mark = { fact: 'color', rule: colorMark };

/**
 * The mark belongs only to a Boolean global option with no short alias and no environment
 * binding, judged at the call that declares the option. The configuration binding needs the
 * installed source, so `checkColorBinding` judges it where the Application knows the source.
 */
function checkColor(config: OptionConfig, site: FactSite, global: boolean): void {
  if (!('color' in config)) {
    return;
  }
  checkMarkPlacement(config, site, { global, mark: color });
  checkOneSource(config, site);
}

/** The fault for one of the mark's own rules, marking the key it names. */
function markFault(site: FactSite, fact: string, parts: { sentence: string; correction: string }) {
  return factFault(colorMark, site, { ...parts, fact });
}

/**
 * The marked option is read from argv alone: no short alias, whose group only the parse can read,
 * and no variable, because the environment speaks for color through NO_COLOR and FORCE_COLOR.
 */
function checkOneSource(config: OptionConfig, site: FactSite): void {
  if (config.short !== undefined) {
    throw markFault(site, 'short', {
      correction: 'Remove short; the run reads its color before it reads short groups.',
      sentence: `${site.subject} declares color and a short alias.`,
    });
  }
  if (config.env !== undefined) {
    throw markFault(site, 'env', {
      correction: 'Remove env; NO_COLOR and FORCE_COLOR speak for the environment.',
      sentence: `${site.subject} declares color and env, a second source for the run's color.`,
    });
  }
}

/**
 * A marked option carries no value of the installed configuration source's binding, because the
 * run reads its color before configuration. `carried` is the identity of the installed source's
 * binding when the option's extension record carries it, and `undefined` otherwise.
 */
function checkColorBinding(
  config: OptionConfig,
  site: FactSite,
  carried: string | undefined,
): void {
  if (!isMarked(config, 'color') || carried === undefined) {
    return;
  }
  throw markFault(site, 'extensions', {
    correction: 'Remove the binding; the run reads its color before configuration.',
    sentence: `${site.subject} declares color and carries configuration binding ${quoted(carried)}, a second source for the run's color.`,
  });
}

/**
 * The run's color choice from argv alone: the last word before the first bare `--` that equals a
 * spelling of the marked option, read against `spellings`, the marked option's long spellings
 * from the compiled globals table. A positive spelling chooses `'always'`, a negative one
 * `'never'`, and no match leaves the run without a choice.
 */
function colorChoice(
  argv: readonly string[],
  spellings: ReadonlyMap<string, OptionSpelling>,
): ColorChoice | undefined {
  let choice: ColorChoice | undefined = undefined;
  for (const word of argv) {
    if (word === '--') {
      break;
    }
    const spelling = spellings.get(word);
    if (spelling?.type === 'boolean') {
      choice = spelling.value ? 'always' : 'never';
    }
  }
  return choice;
}

/** A policy with the run's color choice over its `color` field, and every other field kept. */
function chosenPolicy(policy: RenderingPolicy, choice: ColorChoice | undefined): RenderingPolicy {
  return choice === undefined ? policy : { ...policy, color: choice };
}

/**
 * The policy the output of a run whose host capture failed follows, before argv could be read: in
 * a marked Application, color off, the safest reading of a choice core could not read, and in one
 * with no mark, nothing, so it prints as it did before the mark existed.
 */
function uncapturedPolicy(marked: boolean): RenderingPolicy {
  return marked ? { color: 'never' } : {};
}

export type { ColorChoice };
export { checkColor, checkColorBinding, chosenPolicy, color, colorChoice, uncapturedPolicy };
