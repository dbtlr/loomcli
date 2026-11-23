import { plugin } from '@loomcli/core';
import type { LiveRegionsHook, LiveRegionsHookContext, Out, PluginDefinition } from '@loomcli/core';

// A hook reads the state and the run's out, and an arrow with no return compiles.
const observe: LiveRegionsHook = (state, context) => {
  const out: Out = context.out;
  if (state === 'drawn') {
    void out.warn('drawn');
  }
};
const observing = plugin('@acme/regions', { onLiveRegions: observe });
const inline: PluginDefinition = { onLiveRegions: (state) => void state };

// @ts-expect-error TS2322: A hook observes, so it returns nothing.
const returning: PluginDefinition = { onLiveRegions: () => true };

// @ts-expect-error TS2322: A hook is synchronous, so it returns no promise.
const asynchronous: PluginDefinition = { onLiveRegions: async () => undefined };

const unknownState: LiveRegionsHook = (state) => {
  // @ts-expect-error TS2367: The state is 'drawn' or 'closed', and no other.
  void (state === 'opened');
};

const sealed = (context: LiveRegionsHookContext): void => {
  // @ts-expect-error TS2540: The context's out is read-only.
  context.out = { ...context.out };
};

void [observing, inline, returning, asynchronous, unknownState, sealed];
