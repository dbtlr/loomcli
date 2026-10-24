import type { Host } from '@loomcli/core';

/**
 * What a toolchain helper reads from the run it works for: the host it starts every child program
 * through and takes its temporary folder from, and the run's signal, which ends those children once
 * the run is cancelled.
 */
export interface RunHost {
  readonly host: Pick<Host, 'spawn' | 'tmpdir'>;
  readonly signal: AbortSignal;
}
