import { InputError, plugin } from '@loomcli/core';
import type { FailureHook, InputProblem, Plugin } from '@loomcli/core';

/** Whether a problem is a distance pace could not read. */
function isDistance(problem: InputProblem): boolean {
  return problem.reason === 'invalid' && ['distance', 'every'].includes(problem.input.name);
}

/**
 * Points at `pace races` under a failure for a distance pace could not read. A run by name has no
 * command line to point at, so it gets no hint.
 */
const pointAtRaces: FailureHook = (failure, { invokedBy }) =>
  invokedBy === 'argv' && failure instanceof InputError && failure.problems.some(isDistance)
    ? 'Run "pace races" to list the races pace knows by name.'
    : undefined;

/** Pace's own plugin. It uses the plugin contract every first-party plugin uses. */
export function raceHint(): Plugin {
  return plugin('pace/races', { onFailure: pointAtRaces });
}
