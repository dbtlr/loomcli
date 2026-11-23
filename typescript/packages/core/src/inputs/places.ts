import type { BuiltGraph } from '../commands/build.js';
import type { BuiltCommand } from '../commands/types.js';
import type { InputSite } from '../diagnostics/facts.js';
import type { InputDeclaration, InputPlaces } from './declarations.js';
import { declaringSite, inputPlace } from './declarations.js';
/** Every declaration in the graph, so defaults are validated before any token is read. */
export function collectInputs(command: BuiltCommand): InputDeclaration[] {
  return [
    ...command.inputs,
    ...[...command.children.values()].flatMap((child) => collectInputs(child)),
  ];
}

/**
 * Where every input of one graph was declared: each global option at its `globalOption()` call or
 * in its plugin's `options` record, and each Command's own inputs at their calls on the Command,
 * under its path from the root.
 */
export function inputPlaces(graph: BuiltGraph): InputPlaces {
  const places = new Map<InputDeclaration, InputSite>(graph.globals.sites);
  const walk = (command: BuiltCommand, path: readonly string[]) => {
    for (const input of command.inputs) {
      places.set(input, declaringSite(input, inputPlace(input, path)));
    }
    for (const [name, child] of command.children) {
      walk(child, [...path, name]);
    }
  };
  walk(graph.root, []);
  return places;
}
