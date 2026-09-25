import { DeclarationError } from './errors.js';

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
 * a variable name. `sentence` names the declaration at the start of the diagnostic.
 */
export function checkEnvBinding(sentence: string, config: BindingConfig): string | undefined {
  const env = config.env;
  if (env === undefined) {
    return undefined;
  }
  if (config.multiple === true) {
    throw new DeclarationError(
      `${sentence} is a multiple option and declares env. Remove env; a list comes from the configuration source.`,
    );
  }
  if (typeof env !== 'string' || !variableName.test(env)) {
    const quoted = typeof env === 'string' ? ` "${env}"` : '';
    throw new DeclarationError(
      `${sentence} env${quoted} is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.`,
    );
  }
  return env;
}

/** An argument is identified by its place among bare tokens, so no variable can stand in for it. */
export function checkNoArgumentBinding(sentence: string, config: object): void {
  if ('env' in config) {
    throw new DeclarationError(
      `${sentence} declares env, which applies to options alone. Remove it.`,
    );
  }
}

/** One option bound to a variable, with the phrase a duplicate-variable diagnostic names it by. */
export interface BoundOption {
  readonly site: string;
  readonly variable: string;
}

/**
 * The variables one scope binds, each to the phrase of the option that binds it. Within one
 * invocation's scope a variable binds one option, so a second binder is a declaration error that
 * names the first binder, in scope order, and then the second. `held` is what an enclosing scope
 * already binds, such as the globals table under a Command's own options.
 */
export function claimVariables(
  bound: readonly BoundOption[],
  held: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, string> {
  const claimed = new Map(held);
  for (const { site, variable } of bound) {
    const owner = claimed.get(variable);
    if (owner !== undefined) {
      throw new DeclarationError(
        `Variable "${variable}" is bound by ${owner} and ${site}. Bind each variable to one option.`,
      );
    }
    claimed.set(variable, site);
  }
  return claimed;
}
