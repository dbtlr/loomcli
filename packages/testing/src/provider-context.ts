/**
 * The context a test calls one provider's opener with, typed from the opener alone. The test
 * imports the opener's module itself, so no `load` runs, and the builder calls no `close`.
 */
import type { ProviderContext } from '@loomcli/core';

import { logWith, neverAborts, outWith, registersNothing, unstated } from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';
import { unstatedStyle } from './unstated-style.js';

/**
 * What a test states to build a provider context: `options` and `provided` whole, and any other
 * member it means the opener to read.
 */
type ProviderValues<Globals, Provided> = Pick<
  ProviderContext<Globals, Provided>,
  'options' | 'provided'
> &
  OptionalMembers<Omit<ProviderContext<Globals, Provided>, 'options' | 'provided'>>;

/**
 * Builds the context an opener, typed `Opener<typeof declaration>`, takes from the values the test
 * states. A run freezes `options` to every depth; the builder holds what the test stated.
 *
 * ```ts
 * const context = providerContext(open, {
 *   options: { token: 't0k3n' },
 *   provided: { pool: testPool() },
 * });
 * const session = await open(context);
 * ```
 */
function providerContext<Globals, Provided>(
  opener: (context: ProviderContext<Globals, Provided>) => unknown,
  values: NoInfer<ProviderValues<Globals, Provided>>,
): ProviderContext<Globals, Provided> {
  return {
    ...values,
    get graph() {
      return values.graph ?? unstated('providerContext', 'graph');
    },
    get host() {
      return values.host ?? unstated('providerContext', 'host');
    },
    log: logWith(values.log),
    onShutdown: values.onShutdown ?? registersNothing,
    out: outWith(values.out, 'providerContext'),
    signal: values.signal ?? neverAborts(),
    style: values.style ?? unstatedStyle(),
  };
}

export { providerContext };
export type { ProviderValues };
