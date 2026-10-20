import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError, midSentence } from './errors.js';
import { factFault, siteFinding } from './facts.js';
import type { FactSite } from './facts.js';
import type { OptionConfig } from './types.js';

/**
 * A run-wide mark: the key one global option carries, the option type that may carry it, and the
 * rule that guards it. The interaction and color marks sit on a Boolean option, the verbose and
 * quiet marks on a counted one, and the background mark on a string one.
 */
interface Mark {
  readonly fact: 'background' | 'color' | 'interaction' | 'quiet' | 'verbose';
  readonly type: 'boolean' | 'count' | 'string';
  readonly rule: DiagnosticRule;
}

/** The type each mark's option takes, as a fault names it and as its fix spells it. */
const typeNames: Readonly<Record<Mark['type'], string>> = {
  boolean: 'Boolean',
  count: 'a counted option',
  string: 'a string option',
};

/** Whether one option carries a mark: the key, on an option of the mark's type, holding `true`. */
function isMarked(config: OptionConfig, mark: Mark): boolean {
  return config.type === mark.type && config[mark.fact] === true;
}

/** The sentence and fix one option of the wrong type reports for a mark. */
function wrongType(subject: string, mark: Mark): { sentence: string; correction: string } {
  return {
    correction: `Use type "${mark.type}".`,
    sentence: `${subject} declares ${mark.fact} but is not ${typeNames[mark.type]}.`,
  };
}

/**
 * The sentence and fix of the first placement rule one marked config breaks, or `undefined` when
 * it sits on a global option of the mark's type and holds `true`.
 */
function misplaced(
  config: OptionConfig,
  subject: string,
  scope: { readonly global: boolean; readonly mark: Mark },
): { sentence: string; correction: string } | undefined {
  const { global, mark } = scope;
  const { fact } = mark;
  if (!global) {
    return {
      correction: 'Declare it with globalOption().',
      sentence: `${subject} declares ${fact} but is not a global option.`,
    };
  }
  if (config.type !== mark.type) {
    return wrongType(subject, mark);
  }
  const value: unknown = config[fact];
  return value === true
    ? undefined
    : {
        correction: `Remove ${fact} or set it to true.`,
        sentence: `${subject} declares ${fact} that is not true.`,
      };
}

/**
 * A mark belongs only to a global option of its type and holds `true`, judged at the call that
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
  const fault = misplaced(config, site.subject, scope);
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
