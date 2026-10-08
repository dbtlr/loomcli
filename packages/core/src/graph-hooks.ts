import type { Finding } from './diagnostic-text.js';
import { asSentence, DeclarationError, quoted, reasonOf } from './errors.js';
import type { CommandGraph } from './inspect.js';
import { brokenGraphHook } from './plugin-rules.js';
import type { BuiltPlugin } from './plugin.js';
import { ignoreRejection, isThenable } from './thenable.js';
import type { GraphBuiltHook } from './types.js';

/** The finding for the hook one plugin declared, as `plugin(identity, { onGraphBuilt })`. */
function hookFinding(identity: string, hook: GraphBuiltHook): Finding {
  return { arguments: [identity, { onGraphBuilt: hook }], call: 'plugin', mark: '1.onGraphBuilt' };
}

/** The fault a hook that threw anything but a `DeclarationError` is, the thrown value as its cause. */
function threwFault(identity: string, hook: GraphBuiltHook, error: unknown): DeclarationError {
  return new DeclarationError(
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

/**
 * The fault a hook that returned a value is. A returned promise is handed a rejection handler, so
 * its outcome never surfaces as an unhandled rejection.
 */
function returnedFault(
  identity: string,
  hook: GraphBuiltHook,
  returned: unknown,
): DeclarationError {
  if (isThenable(returned)) {
    ignoreRejection(returned);
  }
  return new DeclarationError(brokenGraphHook, {
    correction: 'Return nothing from the hook; it judges the graph and cannot change it.',
    findings: [hookFinding(identity, hook)],
    sentence: `Plugin ${quoted(identity)} returned a value from onGraphBuilt.`,
  });
}

/**
 * One plugin's judgment of the graph, or nothing when the hook accepts it. A `DeclarationError` the
 * hook throws is its rejection and reports as itself. Any other throw, and any returned value, is
 * the hook's own defect.
 */
function judgeOnce(
  graph: CommandGraph,
  hook: GraphBuiltHook,
  identity: string,
): DeclarationError | undefined {
  let returned: unknown = undefined;
  try {
    returned = hook(graph);
  } catch (error) {
    return error instanceof DeclarationError ? error : threwFault(identity, hook, error);
  }
  return returned === undefined ? undefined : returnedFault(identity, hook, returned);
}

/**
 * Every installed plugin's `onGraphBuilt` over one frozen graph, in installation order. Each hook
 * receives the same graph, and each rejection or broken hook is handed to `fault`, which a run and
 * `inspect()` throw, so the first ends the build, and `check()` keeps, so every hook runs.
 */
export function judgeGraph(
  graph: CommandGraph,
  plugins: readonly BuiltPlugin[],
  fault: (error: DeclarationError) => void,
): void {
  for (const installed of plugins) {
    const judged = installed.onGraphBuilt
      ? judgeOnce(graph, installed.onGraphBuilt, installed.identity)
      : undefined;
    if (judged !== undefined) {
      fault(judged);
    }
  }
}

/** Whether any installed plugin judges the graph, so a run builds the frozen graph for it. */
export function judgesGraph(plugins: readonly BuiltPlugin[]): boolean {
  return plugins.some((installed) => installed.onGraphBuilt !== undefined);
}
