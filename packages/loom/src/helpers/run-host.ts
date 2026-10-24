import type { Host, OnShutdown } from '@loomcli/core';

/**
 * What a toolchain helper reads from the run it works for: the host it starts every child program
 * through and takes its temporary folder from, the run's signal, which ends those children once
 * the run is cancelled, and its `onShutdown`, which undoes what the helper left when a shutdown
 * ends before the run has unwound.
 */
export interface RunHost {
  readonly host: Pick<Host, 'spawn' | 'tmpdir'>;
  readonly onShutdown: OnShutdown;
  readonly signal: AbortSignal;
}
