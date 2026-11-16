/*
 * A progress line's rate and time left, under ADR-0171: computed from the counts its author reports
 * and the clock the line reads for its elapsed time, so it adds no timer.
 */

/** How far back the rate reaches from its newest sample, in milliseconds. */
const WINDOW = 10_000;
/** How far apart the anchor and the newest sample are before the rate is known, in milliseconds. */
const KNOWN = 1000;

/** One report's count at the time the line took it. */
interface Sample {
  readonly time: number;
  readonly count: number;
}

/** A line's estimate: it takes each counted report and answers the rate and the time left. */
interface Estimate {
  /** Takes a report of `count` units done at `time`. */
  readonly report: (time: number, count: number) => void;
  /** Units per second from the anchor to the newest sample, or `undefined` until it is known. */
  readonly rate: () => number | undefined;
  /** Milliseconds left at `now` for `total` units, held at 0, or `undefined` when none follows. */
  readonly remaining: (total: number | undefined, now: number) => number | undefined;
  /** How many samples the estimate holds, read by tests that pin its bookkeeping. */
  readonly held: () => number;
  /** How many times the estimate has dropped its unread samples, read by tests. */
  readonly drops: () => number;
}

/**
 * A fresh estimate. Its window holds the anchor, the latest sample at least 10 seconds before the
 * newest, or the first sample while none is that old, and every sample after it. A count below
 * the newest one restarts the window at that report.
 */
function estimate(): Estimate {
  let samples: Sample[] = [];
  // The anchor's index. The samples before it are never read again, and drop once they outnumber the rest.
  let anchor = 0;
  let drops = 0;
  const span = (): { first: Sample; last: Sample } | undefined => {
    const first = samples[anchor];
    const last = samples.at(-1);
    return first === undefined || last === undefined || last.time - first.time < KNOWN
      ? undefined
      : { first, last };
  };
  return {
    drops: () => drops,
    held: () => samples.length,
    rate: () => {
      const known = span();
      return known === undefined
        ? undefined
        : ((known.last.count - known.first.count) * 1000) / (known.last.time - known.first.time);
    },
    remaining: (total, now) => {
      const known = span();
      if (known === undefined || total === undefined) {
        return undefined;
      }
      const { first, last } = known;
      if (last.count === first.count || last.count >= total) {
        return undefined;
      }
      const left = ((total - last.count) * (last.time - first.time)) / (last.count - first.count);
      return Math.max(0, left - (now - last.time));
    },
    report: (time, count) => {
      const newest = samples.at(-1);
      if (newest !== undefined && count < newest.count) {
        samples = [];
        anchor = 0;
      }
      samples.push({ count, time });
      while (time - (samples[anchor + 1]?.time ?? time) >= WINDOW) {
        anchor += 1;
      }
      if (anchor * 2 > samples.length) {
        samples = samples.slice(anchor);
        anchor = 0;
        drops += 1;
      }
    },
  };
}

export { estimate };
export type { Estimate };
