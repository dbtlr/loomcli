import { DeclarationError } from './errors.js';
import type { CommandGraph } from './inspect.js';
import type { BuiltPlugin } from './plugin.js';
import type { GraphBuiltHook } from './types.js';

/**
 * One plugin's judgment of the graph, or nothing when the hook accepts it. A `DeclarationError` the
 * hook throws is its rejection and reports as itself. Any other throw leaves the build as it is, a
 * foreign throw from the hook's code.
 */
function judgeOnce(graph: CommandGraph, hook: GraphBuiltHook): DeclarationError | undefined {
  try {
    hook(graph);
  } catch (error) {
    if (error instanceof DeclarationError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

/**
 * Every installed plugin's `onGraphBuilt` over one frozen graph, in installation order. Each hook
 * receives the same graph, and each rejection is handed to `fault`, which a run and `inspect()`
 * throw, so the first ends the build, and `check()` keeps, so every hook runs.
 */
export function judgeGraph(
  graph: CommandGraph,
  plugins: readonly BuiltPlugin[],
  fault: (error: DeclarationError) => void,
): void {
  for (const installed of plugins) {
    const judged = installed.onGraphBuilt ? judgeOnce(graph, installed.onGraphBuilt) : undefined;
    if (judged !== undefined) {
      fault(judged);
    }
  }
}

/** Whether any installed plugin judges the graph, so a run builds the frozen graph for it. */
export function judgesGraph(plugins: readonly BuiltPlugin[]): boolean {
  return plugins.some((installed) => installed.onGraphBuilt !== undefined);
}
