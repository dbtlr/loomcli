import { readdirSync } from 'node:fs';

import { registeredRules, ruleParts } from '../../../scripts/test-rules.js';
import type { RegisteredRule } from '../../../scripts/test-rules.js';

/** The parts of one of core's Developer Diagnostics a rule's own test pins, by the rule's name. */
interface RuleParts {
  readonly rule: string;
  readonly sentence: string;
  readonly correction: string;
}

/** The prefix every identity of core's own rules carries. */
const core = '@loomcli/core/';

/**
 * The parts of the Developer Diagnostic of one of core's rules that printed text holds: the rule's
 * name from its banner, the sentence, and the correction.
 */
function coreRuleParts(text: string): RuleParts | undefined {
  const parts = ruleParts(text);
  return parts === undefined
    ? undefined
    : {
        correction: parts.correction,
        rule: parts.identity.startsWith(core) ? parts.identity.slice(core.length) : parts.identity,
        sentence: parts.sentence,
      };
}

/** The opening of each call that declares one of core's rules, which captures the rule's name. */
const declaring = /registerRule\('@loomcli\/core\/(?<name>[a-z0-9-]+)', \{/gu;

/** The rules one of core's source files declares, read from its text. */
function rulesIn(file: string): RegisteredRule[] {
  return registeredRules(new URL(`../src/${file}`, import.meta.url), declaring);
}

/**
 * The names of the rules one of core's rule files declares, read from its source as text, so a rule
 * a family declares without a pinned diagnostic fails that family's test.
 */
function declaredRules(file: string): string[] {
  return rulesIn(file).map((rule) => rule.name);
}

/** Every rule core's source declares, across all of its files. */
function coreRules(): RegisteredRule[] {
  const files = readdirSync(new URL('../src/', import.meta.url)).filter((file) =>
    file.endsWith('.ts'),
  );
  return files.toSorted().flatMap((file) => rulesIn(file));
}

export type { RuleParts };
export { coreRuleParts, coreRules, declaredRules };
