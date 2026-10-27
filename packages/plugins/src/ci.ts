import type { Host } from '@loomcli/core';

/**
 * Whether the run is under CI, read as ci-info reads `CI`: set and nonempty, where `CI=false` is an
 * operator saying the run is not CI. Core reads it by the same rule and exports no reader for it.
 */
export function underCI(env: Host['env']): boolean {
  const ci = env.CI ?? '';
  return ci !== '' && ci !== 'false';
}
