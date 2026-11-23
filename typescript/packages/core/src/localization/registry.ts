/*
 * Core's member of `MessagePackages`: each of its message modules by the name of the concept
 * module that holds it. The voice test checks this list against the `messages.ts` files under
 * `src`, so no sentence falls outside a phrasebook's type.
 */
import type * as failures from '../failures/messages.js';
import type * as inputs from '../inputs/messages.js';
import type * as invocation from '../invocation/messages.js';
import type * as output from '../output/messages.js';
import type * as plugins from '../plugins/messages.js';

/**
 * Core's message modules, by the name of the concept module that holds each one. Each member is
 * the module's own type, so the declaration loads nothing at run time.
 *
 * @public
 * @sealed
 */
interface CoreMessageModules {
  /** The sentences of core's failure classes and the failure form. */
  readonly failures: typeof failures;
  /** The sentences and issues of validation, missing inputs, option groups, and content inputs. */
  readonly inputs: typeof inputs;
  /** The issues of a value an invocation by name cannot lower. */
  readonly invocation: typeof invocation;
  /** The line of a result sequence that stopped early. */
  readonly output: typeof output;
  /** The line of a provider's close that threw when it could not fail the run. */
  readonly plugins: typeof plugins;
}

/**
 * Each Loom package's message modules, by package name. A package that joins localization merges
 * its own member, and an application may add one for its own message modules.
 *
 * @example
 * ```ts
 * import type * as notes from './notes/messages.js';
 *
 * declare module '@loomcli/core' {
 *   interface MessagePackages {
 *     notes: { readonly notes: typeof notes };
 *   }
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrasebooks
 * @public
 */
interface MessagePackages {
  /** Core's own message modules. */
  readonly '@loomcli/core': CoreMessageModules;
}

/**
 * The name of a package that registers its message modules.
 *
 * @public
 */
type MessagePackage = keyof MessagePackages;

export type { CoreMessageModules, MessagePackage, MessagePackages };
