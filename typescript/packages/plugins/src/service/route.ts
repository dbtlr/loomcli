import { DeclarationError, escapeControlCharacters, locate } from '@loomcli/core';
import type { CommandGraph, GraphBuiltHook } from '@loomcli/core';

import { serviceRunUnrouted } from '../rules.js';
import { identity } from './settings.js';

/** Whether every run word reads and the routed Command has an action. */
function routes(graph: CommandGraph, run: readonly string[]): boolean {
  // Before a delimiter, appending one makes locate read every run word as complete.
  // After a delimiter, the final word must fill an argument or reach passthrough.
  const position = locate(graph, run.includes('--') ? run : [...run, '--']);
  return (
    position.kind !== 'none' &&
    position.kind !== 'value' &&
    position.kind !== 'command' &&
    position.command.hasAction
  );
}

/**
 * The hook that judges the `run` words on every graph build, so a renamed or mistyped Command fails
 * the build rather than a supervised daemon. No validator runs, so a value its validator rejects
 * fails when the unit runs.
 */
function judgeRun(run: readonly string[]): GraphBuiltHook {
  return (graph) => {
    if (!routes(graph, run)) {
      const words = run.map((word) => escapeControlCharacters(word)).join(' ');
      throw new DeclarationError(serviceRunUnrouted, {
        correction:
          "Name the words of a Command that has an action, as the application's command line takes them.",
        sentence: `Plugin "${identity}" setting "run" does not route to a Command with an action: ${words}.`,
      });
    }
    return undefined;
  };
}

export { judgeRun };
