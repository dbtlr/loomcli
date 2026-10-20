import type { ProgressEvent, ProgressReport, RegionCloser } from './types.js';

/** How a run's ledger reads a label and hands an event on. */
interface LedgerSinks {
  /** The plain text of a marked label, as the view context's `plain` reads it. */
  plain: (text: string) => string;
  /** Hands one event to whoever observes the run, synchronously. */
  deliver: (event: ProgressEvent) => void;
}

/** The end state each closer builds, for a region whose own `end()` asked for `ended`. */
const builtBy: Readonly<Record<RegionCloser, ProgressEvent['state']>> = {
  cancellation: 'cancelled',
  completion: 'ended',
  end: 'ended',
  failure: 'failed',
};

/** One region's reports: the values its events carry, and the id its first report took. */
class RegionReports {
  #id: number | undefined = undefined;
  #label = '';
  #completed: number | undefined = undefined;
  #total: number | undefined = undefined;

  constructor(private readonly ledger: ProgressLedger) {}

  /** A `started` event for the first report and an `updated` event for each later one. */
  report(progress: ProgressReport): void {
    const state = this.#id === undefined ? 'started' : 'updated';
    this.#id ??= this.ledger.nextId();
    if (progress.label !== undefined) {
      this.#label = progress.label;
    }
    this.#completed = progress.completed ?? this.#completed;
    this.#total = progress.total ?? this.#total;
    this.#build(state);
  }

  /**
   * The end event of a region that reported: `failed` after `end('failed')` and after a failure,
   * `cancelled` after cancellation, and `ended` otherwise. It carries the label `end()` received,
   * and the last reported label without one. A region that never reported builds none.
   */
  close(closer: RegionCloser, state: 'ended' | 'failed', label?: string): void {
    if (this.#id !== undefined) {
      this.#build(closer === 'end' && state === 'failed' ? 'failed' : builtBy[closer], label);
    }
  }

  #build(state: ProgressEvent['state'], label = this.#label): void {
    this.ledger.deliver(
      Object.freeze({
        ...(this.#completed === undefined ? {} : { completed: this.#completed }),
        id: this.#id ?? 0,
        label: this.ledger.plain(label),
        state,
        ...(this.#total === undefined ? {} : { total: this.#total }),
      }),
    );
  }
}

/**
 * The progress events of one run: it numbers the reporting regions from 1 in the order each first
 * reports, and hands each event on synchronously, inside the report or the close that built it.
 */
class ProgressLedger {
  #next = 1;

  constructor(private readonly sinks: LedgerSinks) {}

  /** The reports of one region the run opened. */
  region(): RegionReports {
    return new RegionReports(this);
  }

  /** The id of the next region to report for the first time. */
  nextId(): number {
    const id = this.#next;
    this.#next += 1;
    return id;
  }

  plain(text: string): string {
    return this.sinks.plain(text);
  }

  deliver(event: ProgressEvent): void {
    this.sinks.deliver(event);
  }
}

export { ProgressLedger };
export type { RegionReports };
