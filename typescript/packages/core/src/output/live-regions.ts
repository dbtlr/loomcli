import type { Out } from './types.js';

/**
 * What one `onLiveRegions` hook reads beside the state: the run's `out`, with the default
 * destinations on every Command, as a middleware's is. A write through it lands above the regions
 * and resolves under the run's rendering policy. The object is the same at every call of one run,
 * so a plugin tells two runs apart by it.
 *
 * @public
 * @sealed
 */
interface LiveRegionsHookContext {
  /** The run's channel with the default destinations, as a middleware's `out` is. */
  readonly out: Out;
}

/**
 * A plugin's `onLiveRegions` hook: core calls it with `'drawn'` at the write that puts the run's
 * first live region frame, or a streamed message's unfinished row or line, on the screen, and with
 * `'closed'` at the write after which none is left, in write order, for every region of the run
 * wherever it was opened. It observes and returns nothing.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/lifecycle-hooks.md#observing-live-regions
 * @public
 */
type LiveRegionsHook = (state: 'drawn' | 'closed', context: LiveRegionsHookContext) => undefined;

/**
 * One run's span of drawn live regions and streamed messages' unfinished rows and lines, as the
 * installed `onLiveRegions` hooks observe it. Core tells it whether the screen holds one around
 * each write that can change that, and it calls the hooks in installation order at each change:
 * `'drawn'` before the write's bytes, and `'closed'` after them. A hook that throws is still called
 * at every later point, and the first throw is kept for the run to report.
 */
class LiveRegionSpan {
  readonly #hooks: readonly LiveRegionsHook[];
  readonly #context: LiveRegionsHookContext;
  #open = false;
  #thrown: { readonly value: unknown } | undefined = undefined;

  constructor(hooks: readonly LiveRegionsHook[], out: Out) {
    this.#hooks = hooks;
    this.#context = Object.freeze({ out });
  }

  /** The first value a hook threw in the run, which the run reports once after its outcome. */
  get thrown(): { readonly value: unknown } | undefined {
    return this.#thrown;
  }

  /** Before a write's bytes: a region that holds a frame while the span is closed opens it. */
  before(holding: boolean): void {
    if (!this.#open && holding) {
      this.#open = true;
      this.#call('drawn');
    }
  }

  /** After a write's bytes: an open span closes once no region holds a frame. */
  after(holding: boolean): void {
    if (this.#open && !holding) {
      this.#end();
    }
  }

  /**
   * Closes a span still open where the run can write no more: a shutdown's end, the process's
   * exit, or the run's end once stderr failed. A throw raised here is not kept, because the run's
   * report of a hook's throw has already been made or never will be.
   */
  finish(): void {
    if (this.#open) {
      const kept = this.#thrown;
      this.#end();
      this.#thrown = kept;
    }
  }

  #end(): void {
    this.#open = false;
    this.#call('closed');
  }

  #call(state: 'drawn' | 'closed'): void {
    for (const hook of this.#hooks) {
      try {
        hook(state, this.#context);
      } catch (error) {
        this.#thrown ??= { value: error };
      }
    }
  }
}

export { LiveRegionSpan };
export type { LiveRegionsHook, LiveRegionsHookContext };
