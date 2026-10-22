import { InputError, plugin } from '@loomcli/core';
import type { FailureHook, InputProblem, Plugin } from '@loomcli/core';

/** Whether a problem is a distance pace could not read. */
function isDistance(problem: InputProblem): boolean {
  return problem.reason === 'invalid' && ['distance', 'every'].includes(problem.input.name);
}

/** Adds the races pace knows by name under a failure that names a distance it could not read. */
const raceHint: FailureHook = (failure) =>
  failure instanceof InputError && failure.problems.some(isDistance)
    ? 'Name a race as half (21.0975 km) or marathon (42.195 km).'
    : undefined;

/** Pace's own plugin. It uses the plugin contract every first-party plugin uses. */
export function races(): Plugin {
  return plugin('pace/races', { onFailure: raceHint });
}
