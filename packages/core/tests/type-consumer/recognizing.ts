import { Application } from '@loomcli/core';
import type { CommandGraph, DeclarationError } from '@loomcli/core';

// `instanceof Application` narrows an unknown value to an Application whose doors answer.

declare const value: unknown;

if (value instanceof Application) {
  const faults: readonly DeclarationError[] = value.check();
  const graph: CommandGraph = value.inspect();
  const name: string = value.name;
  void [faults, graph, name];
}
