import { Application } from '@loomcli/core';
import type { CommandGraph, DeclarationError } from '@loomcli/core';

// `instanceof Application` narrows an unknown value to an Application whose doors answer, and
// Publishes no authoring call, because a recognized Application may sit in any authoring state.

declare const value: unknown;

if (value instanceof Application) {
  const faults: readonly DeclarationError[] = value.check();
  const graph: CommandGraph = value.inspect();
  const name: string = value.name;
  void [faults, graph, name];
  // @ts-expect-error A recognized Application may already be past its last globalOption().
  value.globalOption('trace', { description: 'Trace.', type: 'boolean' });
  // @ts-expect-error A recognized Application may already be past its last argument().
  value.argument('subject', { description: 'The subject.' });
}
