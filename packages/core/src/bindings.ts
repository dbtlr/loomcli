import { DeclarationError, quoted } from './errors.js';
import { factFault, siteFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { envName, envOnArgument, envOnMultiple, variableBoundTwice } from './input-rules.js';

/** A variable name: a letter or an underscore, then letters, digits, or underscores. */
const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** The two keys the binding rules read, whichever scope declared the option. */
interface BindingConfig {
  readonly env?: unknown;
  readonly multiple?: unknown;
}

/**
 * The environment binding one option declares, or `undefined` when it declares none. A multiple
 * option takes its list from the configuration source, so it cannot bind, and a bound name must be
 * a variable name. The site names the declaration and marks its `env`.
 */
export function checkEnvBinding(site: FactSite, config: BindingConfig): string | undefined {
  const env = config.env;
  if (env === undefined) {
    return undefined;
  }
  if (config.multiple === true) {
    throw factFault(envOnMultiple, site, {
      correction: 'Remove env; a list comes from the configuration source.',
      fact: 'env',
      sentence: `${site.subject} is a multiple option and declares env.`,
    });
  }
  if (typeof env !== 'string' || !variableName.test(env)) {
    const named = typeof env === 'string' ? ` ${quoted(env)}` : '';
    throw factFault(envName, site, {
      correction: 'Use a letter or an underscore, then letters, digits, or underscores.',
      fact: 'env',
      sentence: `${site.subject} env${named} is not a variable name.`,
    });
  }
  return env;
}

/** An argument is identified by its place among bare tokens, so no variable can stand in for it. */
export function checkNoArgumentBinding(site: FactSite, config: object): void {
  if ('env' in config) {
    throw factFault(envOnArgument, site, {
      correction: 'Remove it.',
      fact: 'env',
      sentence: `${site.subject} declares env, which applies to options alone.`,
    });
  }
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
