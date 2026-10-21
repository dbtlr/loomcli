import { DeclarationError, quoted } from './errors.js';
import { siteFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { variableBoundTwice } from './input-rules.js';

/**
 * The variable names one option declaration binds, in declaration order, or none. A name the list
 * repeats binds once.
 */
export function envNames(config: { readonly env?: string | readonly string[] }): readonly string[] {
  const { env } = config;
  if (env === undefined) {
    return [];
  }
  return typeof env === 'string' ? [env] : [...new Set(env)];
}

/**
 * One option bound to a variable: the phrase a duplicate-variable diagnostic names it by, and the
 * site whose `env` its finding marks.
 */
export interface BoundOption {
  readonly phrase: string;
  readonly site: FactSite;
  readonly variable: string;
}

/**
 * The variables one scope binds, each to the option that binds it. Within one invocation's scope a
 * variable binds one option, so a second binder is a declaration error that names the first
 * binder, in scope order, and then the second. `held` is what an enclosing scope already binds,
 * such as the globals table under a Command's own options.
 */
export function claimVariables(
  bound: readonly BoundOption[],
  held: ReadonlyMap<string, BoundOption> = new Map(),
): ReadonlyMap<string, BoundOption> {
  const claimed = new Map(held);
  for (const binder of bound) {
    const { phrase, variable } = binder;
    const owner = claimed.get(variable);
    if (owner !== undefined) {
      throw new DeclarationError(variableBoundTwice, {
        correction: 'Bind each variable to one option.',
        findings: [owner, binder].map(({ site }) => siteFinding(site, `${site.at}.env`)),
        sentence: `Variable ${quoted(variable)} is bound by ${owner.phrase} and ${phrase}.`,
      });
    }
    claimed.set(variable, binder);
  }
  return claimed;
}
