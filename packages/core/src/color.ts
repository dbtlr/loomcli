import { registerRule } from './diagnostic-text.js';
import { quoted } from './errors.js';
import { factFault } from './facts.js';
import type { FactSite } from './facts.js';
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

/** Whether one option carries the color mark: the key, on a Boolean option, holding `true`. */
function isColorMarked(config: OptionConfig): boolean {
  return config.type === 'boolean' && config.color === true;
}

/**
 * The mark belongs only to a Boolean global option with no short alias and no environment
 * binding, judged at the call that declares the option. The configuration binding needs the
 * installed source, so `checkColorBinding` judges it where the Application knows the source.
 */
function checkColor(config: OptionConfig, site: FactSite, global: boolean): void {
  if (!('color' in config)) {
    return;
  }
  checkPlacement(config, site, global);
  checkOneSource(config, site);
}

/** The fault for one rule of the mark, marking the key it names. */
function markFault(site: FactSite, fact: string, parts: { sentence: string; correction: string }) {
  return factFault(colorMark, site, { ...parts, fact });
}

/** The mark sits on a Boolean global option and holds `true`. */
function checkPlacement(config: OptionConfig, site: FactSite, global: boolean): void {
  if (!global) {
    throw markFault(site, 'color', {
      correction: 'Declare it with globalOption().',
      sentence: `${site.subject} declares color but is not a global option.`,
    });
  }
  if (config.type !== 'boolean') {
    throw markFault(site, 'color', {
      correction: 'Use type "boolean".',
      sentence: `${site.subject} declares color but is not Boolean.`,
    });
  }
  const mark: unknown = Reflect.get(config, 'color');
  if (mark !== true) {
    throw markFault(site, 'color', {
      correction: 'Remove color or set it to true.',
      sentence: `${site.subject} declares color that is not true.`,
    });
  }
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
 * run reads its color before configuration. `binding` is the source's descriptor identity, or
 * `undefined` when the Application installs no source, and `record` the option's extension values.
 */
function checkColorBinding(
  config: OptionConfig,
  site: FactSite,
  carried: {
    readonly binding: string | undefined;
    readonly record: Readonly<Record<string, unknown>> | undefined;
  },
): void {
  const { binding, record } = carried;
  if (!isColorMarked(config) || binding === undefined || !Object.hasOwn(record ?? {}, binding)) {
    return;
  }
  throw markFault(site, 'extensions', {
    correction: 'Remove the binding; the run reads its color before configuration.',
    sentence: `${site.subject} declares color and carries configuration binding ${quoted(binding)}, a second source for the run's color.`,
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

export type { ColorChoice };
export { checkColor, checkColorBinding, chosenPolicy, colorChoice, colorMark, isColorMarked };
