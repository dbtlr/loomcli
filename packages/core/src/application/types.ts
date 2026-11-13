import type { FailureExitCode } from '../failures/exit-codes.js';
import type { ProcessHandle } from '../host/types.js';
import type { RenderingPolicy } from '../style/rendering.js';

/**
 * The status `run()` resolves: success, a failure class's code, or a cancellation code.
 *
 * @public
 * @sealed
 */
export type ExitCode = 0 | FailureExitCode | 129 | 130 | 131 | 141 | 143;

/**
 * What a caller states for one `run()`: a rendering policy, the process handle, and a cancellation
 * signal.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/application.md
 * @public
 */
export interface RunOptions {
  /** The rendering policy for this run, in place of the Application's own. */
  rendering?: RenderingPolicy;
  /** The process the run reads its facts from and makes its effects on: `processHandle()` when omitted. */
  process?: ProcessHandle;
  /**
   * A caller-owned signal that cancels the run. Core subscribes to it at run entry and honors an
   * abort at every phase boundary; a shutdown aborts the run as well, and the first cause decides.
   */
  signal?: AbortSignal;
}
