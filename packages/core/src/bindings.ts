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

/** The declaration fault for a binding that breaks the name rules. */
function nameFault(site: FactSite, sentence: string, correction: string): DeclarationError {
  return factFault(envName, site, {
    correction,
    fact: 'env',
    sentence: `${site.subject} ${sentence}`,
  });
}

/** One name of a binding: a variable name that the names before it do not already hold. */
function checkName(site: FactSite, name: unknown, held: readonly string[]): string {
  if (typeof name !== 'string' || !variableName.test(name)) {
    const named = typeof name === 'string' ? ` ${quoted(name)}` : '';
    throw nameFault(
      site,
      `env${named} is not a variable name.`,
      'Use a letter or an underscore, then letters, digits, or underscores.',
    );
  }
  if (held.includes(name)) {
    throw nameFault(site, `env names ${quoted(name)} more than once.`, 'Name each variable once.');
  }
  return name;
}

/** A binding's names are a non-empty list of variable names, each held once. */
function checkNames(site: FactSite, names: readonly unknown[]): readonly string[] {
  if (names.length === 0) {
    throw nameFault(
      site,
      'env is an empty list.',
      'List at least one variable name, or remove env.',
    );
  }
  const valid: string[] = [];
  for (const name of names) {
    valid.push(checkName(site, name, valid));
  }
  return valid;
}

/**
 * The environment binding one option declares, as its variable names in declaration order, or
 * `undefined` when it declares none. A multiple option takes its list from the configuration
 * source, so it cannot bind. A binding is one name or a non-empty list, and each name must be a
 * variable name that the list holds once. The site names the declaration and marks its `env`.
 */
export function checkEnvBinding(
  site: FactSite,
  config: BindingConfig,
): readonly string[] | undefined {
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
  return checkNames(site, Array.isArray(env) ? env : [env]);
}

/** The variable names a checked option declaration binds, in declaration order, or none. */
export function envNames(config: { readonly env?: string | readonly string[] }): readonly string[] {
  const { env } = config;
  if (env === undefined) {
    return [];
  }
  return typeof env === 'string' ? [env] : env;
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
