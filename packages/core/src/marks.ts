import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError, midSentence } from './errors.js';
import { factFault, siteFinding } from './facts.js';
import type { FactSite } from './facts.js';
import type { OptionConfig } from './types.js';

/** A run-wide mark: the key one Boolean global option carries, and the rule that guards it. */
interface Mark {
  readonly fact: 'color' | 'interaction';
  readonly rule: DiagnosticRule;
}

/** Whether one option carries a mark: the key, on a Boolean option, holding `true`. */
function isMarked(config: OptionConfig, fact: Mark['fact']): boolean {
  return config.type === 'boolean' && config[fact] === true;
}

/**
 * The sentence and fix of the first placement rule one marked config breaks, or `undefined` when
 * it sits on a Boolean global option and holds `true`.
 */
function misplaced(
  config: OptionConfig,
  subject: string,
  scope: { readonly global: boolean; readonly fact: Mark['fact'] },
): { sentence: string; correction: string } | undefined {
  const { fact, global } = scope;
  if (!global) {
    return {
      correction: 'Declare it with globalOption().',
      sentence: `${subject} declares ${fact} but is not a global option.`,
    };
  }
  if (config.type !== 'boolean') {
    return {
      correction: 'Use type "boolean".',
      sentence: `${subject} declares ${fact} but is not Boolean.`,
    };
  }
  const value: unknown = Reflect.get(config, fact);
  return value === true
    ? undefined
    : {
        correction: `Remove ${fact} or set it to true.`,
        sentence: `${subject} declares ${fact} that is not true.`,
      };
}

/**
 * A mark belongs only to a Boolean global option and holds `true`, judged at the call that
 * declares the option. A config without the key declares no mark and passes.
 */
function checkMarkPlacement(
  config: OptionConfig,
  site: FactSite,
  scope: { readonly global: boolean; readonly mark: Mark },
): void {
  const { fact, rule } = scope.mark;
  if (!(fact in config)) {
    return;
  }
  const fault = misplaced(config, site.subject, { fact, global: scope.global });
  if (fault !== undefined) {
    throw factFault(rule, site, { ...fault, fact });
  }
}

/**
 * At most one option of an Application carries one mark. `sites` places each marked option, in
 * table order, and the fault names each as its own site names it, the first leading the sentence,
 * and marks the key on each.
 */
function checkOneMark(sites: readonly FactSite[], mark: Mark): void {
  if (sites.length < 2) {
    return;
  }
  const { fact, rule } = mark;
  const subjects = sites.map(({ subject }, index) =>
    index === 0 ? subject : midSentence(subject),
  );
  throw new DeclarationError(rule, {
    correction: 'Mark one option.',
    findings: sites.map((site) => siteFinding(site, `${site.at}.${fact}`)),
    sentence: `${subjects.join(' and ')} both declare ${fact}.`,
  });
}

export type { Mark };
export { checkMarkPlacement, checkOneMark, isMarked };
