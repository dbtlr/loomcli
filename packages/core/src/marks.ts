import type { DiagnosticRule } from './diagnostic-text.js';
import { DeclarationError, midSentence } from './errors.js';
import { siteFinding } from './facts.js';
import type { FactSite } from './facts.js';
import type { OptionConfig } from './types.js';

/**
 * A run-wide mark: the key one global option carries, the option type that carries it, and the
 * rule that reports two marked options. The interaction and color marks sit on a Boolean option,
 * the verbose and quiet marks on a counted one, and the background mark on a string one. The types
 * place each mark on a global option of its type, and core reads a mark from the global options
 * alone.
 */
interface Mark {
  readonly fact: 'background' | 'color' | 'interaction' | 'quiet' | 'verbose';
  readonly type: 'boolean' | 'count' | 'string';
  readonly rule: DiagnosticRule;
}

/** Whether one option carries a mark: the key, on an option of the mark's type, holding `true`. */
function isMarked(config: OptionConfig, mark: Mark): boolean {
  return config.type === mark.type && config[mark.fact] === true;
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
export { checkOneMark, isMarked };
