import type { Finding } from './diagnostic-text.js';
import { asSentence, DeclarationError, quoted, reasonOf } from './errors.js';
import type { CommandGraph } from './inspect.js';
import { brokenGraphHook } from './plugin-rules.js';
import type { BuiltPlugin } from './plugin.js';
import type { GraphBuiltHook } from './types.js';

/** The finding for the hook one plugin declared, as `plugin(identity, { onGraphBuilt })`. */
function hookFinding(identity: string, hook: GraphBuiltHook): Finding {
  return { arguments: [identity, { onGraphBuilt: hook }], call: 'plugin', mark: '1.onGraphBuilt' };
}

/**
 * One plugin's judgment of the graph. A `DeclarationError` the hook throws is its rejection and
 * reports as itself. Any other throw, and any returned value, is the hook's own defect; a returned
 * promise is handed a rejection handler, so its outcome never surfaces as an unhandled rejection.
 */
function judgeOnce(graph: CommandGraph, hook: GraphBuiltHook, identity: string): void {
  let returned: unknown = undefined;
  try {
    returned = hook(graph);
  } catch (error) {
    if (error instanceof DeclarationError) {
      throw error;
    }
    throw new DeclarationError(
      brokenGraphHook,
      {
        correction:
          'Return nothing from the hook, and throw only a DeclarationError to reject the graph.',
        findings: [hookFinding(identity, hook)],
        sentence: `Plugin ${quoted(identity)} failed in onGraphBuilt: ${asSentence(reasonOf(error))}`,
      },
      { cause: error },
    );
  }
  if (returned !== undefined) {
    void Promise.resolve(returned).catch(() => undefined);
    throw new DeclarationError(brokenGraphHook, {
      correction: 'Return nothing from the hook; it judges the graph and cannot change it.',
      findings: [hookFinding(identity, hook)],
      sentence: `Plugin ${quoted(identity)} returned a value from onGraphBuilt.`,
    });
  }
}

/**
 * Every installed plugin's `onGraphBuilt` over one frozen graph, in installation order. Each hook
 * receives the same graph, and the first that rejects it ends the build.
 */
export function judgeGraph(graph: CommandGraph, plugins: readonly BuiltPlugin[]): void {
  for (const installed of plugins) {
    if (installed.onGraphBuilt) {
      judgeOnce(graph, installed.onGraphBuilt, installed.identity);
    }
  }
}

/** Whether any installed plugin judges the graph, so a run builds the frozen graph for it. */
export function judgesGraph(plugins: readonly BuiltPlugin[]): boolean {
  return plugins.some((installed) => installed.onGraphBuilt !== undefined);
}
