import { DeclarationError, escapeControlCharacters, locate } from '@loomcli/core';
import type { CommandGraph, GraphBuiltHook } from '@loomcli/core';

import { serviceRunUnrouted } from '../rules.js';
import { identity } from './settings.js';

/** The delimiter after which every word is passthrough. */
const delimiter = '--';

/**
 * Whether the words route to a Command with an action: read before a final `--`, they end at an
 * option position, or at a passthrough position when they hold a bare `--` themselves.
 */
function routes(graph: CommandGraph, run: readonly string[]): boolean {
  const position = locate(graph, [...run, delimiter]);
  const accepted =
    position.kind === 'option' || (position.kind === 'passthrough' && run.includes(delimiter));
  return accepted && position.command.hasAction;
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
