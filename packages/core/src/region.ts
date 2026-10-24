import type { ProgressLedger, RegionReports } from './progress-events.js';
import { handled } from './thenable.js';
import type { ProgressReport, Region, RegionCloser, RegionOptions, View } from './types.js';

/*
 * The live regions of one run: the handles `out.region()` returns, and the screen model that keeps
 * every open region at the bottom of stderr. A handle's calls decide what happens in call order;
 * the screen decides the bytes when each write reaches stderr, so what it erases is always what
 * that stream last showed.
 */

const escape = '\u001b';
const bell = '\u0007';

/** Every terminal control sequence, which moves no cursor column a reader counts as text. */
const controlSequences = new RegExp(
  `${escape}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)|[@-Z\\\\-_])`,
  'gu',
);

/** The text a terminal shows, without its control sequences. */
function visible(text: string): string {
  return text.replaceAll(controlSequences, '');
}

/** One rendered frame: the marked text core counts rows in, and the resolved text it writes. */
interface Frame {
  readonly marked: string;
  readonly text: string;
}

/** Whether a frame's text ends with a line break of its own. */
function endsLine(frame: Frame): boolean {
  return visible(frame.text).endsWith('\n');
}

/** What one region shows on the screen and the frame it last drew. */
interface Slot {
  readonly input: boolean;
  shown: Frame | undefined;
  latest: Frame | undefined;
  closed: boolean;
}

/** The text a closed region leaves in scrollback: its last frame, ending with a line break. */
function scrollback(frame: Frame | undefined): string {
  if (frame === undefined || frame.text === '') {
    return '';
  }
  return endsLine(frame) ? frame.text : `${frame.text}\n`;
}

/** How the screen measures text at the terminal's current width. */
interface Measure {
  /** Counts the rows a marked text moves the cursor down. */
  rows: (marked: string) => number;
  /** The column the next character lands on after visible text written from `column`. */
  column: (shown: string, column: number) => number;
}

/**
 * The stack of open regions at the bottom of stderr, as the terminal shows it. Each method answers
 * the bytes that move the terminal from what it shows to what it should show, and updates the model
 * to match, so a caller writes those bytes in the order it asked for them.
 */
class Screen {
  readonly #slots: Slot[] = [];
  readonly #closedMeanwhile: Slot[] = [];
  /** The column the last write above the stack left the cursor at, 0 when it ended a row. */
  #column = 0;
  /**
   * The column the row above the stack ended at, when the stack opened on the next row because
   * that write ended partway along it. Text written above the stack continues that row.
   */
  #opened: number | undefined = undefined;
  /** Whether a suspend erased the stack, which shows nothing until the resume draws it again. */
  #suspended = false;

  constructor(private readonly measure: Measure) {}

  /** Whether any region is open on the screen. */
  get holding(): boolean {
    return this.#slots.length > 0;
  }

  /** Whether an input region is open, which holds every other region's frame still. */
  get #frozen(): boolean {
    return this.#slots.some((slot) => slot.input && !slot.closed);
  }

  /** The frames the terminal shows, top to bottom, each starting on a row of its own. */
  #stack(): { marked: string; text: string } | undefined {
    if (this.#suspended) {
      return undefined;
    }
    const frames = this.#slots.flatMap(({ shown }) =>
      shown === undefined || shown.text === '' ? [] : [shown],
    );
    if (frames.length === 0) {
      return undefined;
    }
    const marked: string[] = [];
    const text: string[] = [];
    frames.forEach((frame, index) => {
      const previous = frames[index - 1];
      const separator = previous !== undefined && !endsLine(previous) ? '\n' : '';
      marked.push(separator, frame.marked);
      text.push(separator, frame.text);
    });
    return { marked: marked.join(''), text: text.join('') };
  }

  /** Returns the cursor to the stack's first row and erases to the end of the screen. */
  #erase(): string {
    const stack = this.#stack();
    if (stack === undefined) {
      return '';
    }
    const rows = this.measure.rows(stack.marked);
    return `\r${rows > 0 ? `${escape}[${String(rows)}A` : ''}${escape}[J`;
  }

  /**
   * Erases the stack, which leaves the cursor on the stack's first row, and returns the cursor to
   * the end of the partial row above it when the stack opened below one. Text written next then
   * continues that row, and a caller that erases by `out.draw`'s count starts from where its frame
   * ended, as it does with no region open. A row filled exactly counts as wrapped, because no
   * control sequence restores a terminal's pending wrap.
   */
  #uncover(): string {
    const erase = this.#erase();
    const column = this.#opened;
    if (column === undefined) {
      return erase;
    }
    this.#opened = undefined;
    this.#column = column;
    return `${erase}${escape}[1A${escape}[${String(column + 1)}G`;
  }

  /** Draws the stack below whatever is above it, on the next row when that ended partway along one. */
  #draw(): string {
    const stack = this.#stack();
    if (stack === undefined) {
      return '';
    }
    if (this.#column === 0) {
      return stack.text;
    }
    this.#opened = this.#column;
    this.#column = 0;
    return `\n${stack.text}`;
  }

  /**
   * A suspend: the bytes that erase the stack, which then shows nothing until `resume`. The cursor
   * is left at the start of the stack's first row, where a write queued before the resume lands and
   * where the shell writes while the process stops, so text written above the stack from now on
   * starts a row of its own.
   */
  suspend(): string {
    if (this.#suspended) {
      return '';
    }
    const erase = this.#erase();
    this.#suspended = true;
    this.#opened = undefined;
    this.#column = 0;
    return erase;
  }

  /**
   * A resume: the bytes that draw the stack again, below whatever was written since the suspend.
   * The shell leaves the cursor at the start of a row after it writes, as the erase did.
   */
  resume(): string {
    if (!this.#suspended) {
      return '';
    }
    this.#suspended = false;
    return this.#draw();
  }

  /** Text written to the terminal above the stack: what to write before it and after it. */
  around(text: string): { before: string; after: string } {
    const before = this.#uncover();
    this.note(text);
    return { after: this.#draw(), before };
  }

  /** Text written to the terminal while no region is open, which moves the row the stack starts on. */
  note(text: string): void {
    this.#column = this.measure.column(visible(text), this.#column);
  }

  /**
   * Whether a closing region's last frame is already the whole stack, so it can stay where it is:
   * it shows its latest frame, no other region shows one, and no region closed while it held them.
   */
  #settled(slot: Slot): boolean {
    return (
      slot.shown === slot.latest &&
      this.#closedMeanwhile.length === 0 &&
      this.#slots.every(
        (other) =>
          other === slot ||
          ((other.shown === undefined || other.shown.text === '') && other.latest === other.shown),
      )
    );
  }

  /** A region that opened, which takes no rows until it draws. */
  open(slot: Slot): void {
    this.#slots.push(slot);
  }

  /** A region's new frame, which a frozen region keeps without drawing. */
  draw(slot: Slot, frame: Frame): string {
    if (!this.#slots.includes(slot)) {
      return '';
    }
    slot.latest = frame;
    if (this.#frozen && !slot.input) {
      return '';
    }
    const before = this.#erase();
    slot.shown = frame;
    return before + this.#draw();
  }

  /**
   * A region that closed: its last frame moves into scrollback and the regions below close the
   * gap. A region that closes while an input region holds it still stays as it was shown until the
   * input region closes, when each such last frame moves into scrollback in the order the regions
   * closed, above the input region's own, and every open region draws its latest frame once.
   */
  close(slot: Slot): string {
    if (!this.#slots.includes(slot)) {
      return '';
    }
    if (this.#frozen && !slot.input) {
      slot.closed = true;
      this.#closedMeanwhile.push(slot);
      return '';
    }
    if (this.#settled(slot)) {
      this.#slots.splice(this.#slots.indexOf(slot), 1);
      if (slot.shown === undefined || slot.shown.text === '') {
        // Nothing is drawn, so the cursor returns to where the text above ended.
        return this.#uncover();
      }
      // The last frame is already the bottom of the screen, so it stays where it is.
      this.#opened = undefined;
      return endsLine(slot.shown) ? '' : '\n';
    }
    const before = this.#uncover();
    const leaving = slot.input ? [...this.#closedMeanwhile.splice(0), slot] : [slot];
    for (const left of leaving) {
      this.#slots.splice(this.#slots.indexOf(left), 1);
    }
    if (slot.input) {
      for (const open of this.#slots) {
        open.shown = open.latest;
      }
    }
    let text = leaving.map(({ latest }) => scrollback(latest)).join('');
    if (text !== '') {
      text = (this.#column === 0 ? '' : '\n') + text;
      this.#column = 0;
    }
    return before + text + this.#draw();
  }
}

/** What the run's regions need from the output that owns them. */
interface RegionHost {
  /** Whether a region opened now is live: stderr is a terminal, and it takes input or the run is not quiet. */
  live: (input: boolean) => boolean;
  /** Renders one frame through its view, or answers the rejection a broken view raised. */
  frame: (data: unknown, view: View<never>) => Frame | { failed: Promise<void> };
  /** Writes what `compose` answers once every earlier write to stderr has reached the stream. */
  write: (compose: () => string) => Promise<void>;
  /** The run's progress events. */
  ledger: ProgressLedger;
  /** Whether the run has been cancelled already. */
  cancelled: () => boolean;
  /**
   * Erases the regions on a suspend and redraws them on the resume, from now until the call it
   * answers, which the regions make while any live region is open.
   */
  holdSuspend: () => () => void;
}

/** One region a run opened, as its handle answers and as the run closes it. */
class LiveRegion implements Region {
  readonly live: boolean;
  readonly slot: Slot;
  /** Whether the region has opened; a live input region waits while another one is open. */
  opened = false;
  /** Draw promises a waiting region resolves once it opens and its frame is written. */
  readonly waiters: (() => void)[] = [];
  /** The latest frame a waiting region drew, which it draws once it opens. */
  pending: Frame | undefined = undefined;
  readonly #controller = new AbortController();
  #closedBy: RegionCloser | undefined = undefined;
  /** Whether the close has run its abort listeners, after which the region takes no frame. */
  #finished = false;

  readonly input: boolean;
  readonly reports: RegionReports;
  readonly #regions: Regions;

  constructor(regions: Regions, facts: { input: boolean; live: boolean; reports: RegionReports }) {
    this.#regions = regions;
    this.input = facts.input;
    this.live = facts.live;
    this.reports = facts.reports;
    this.slot = { closed: false, input: facts.input, latest: undefined, shown: undefined };
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get closedBy(): RegionCloser | undefined {
    return this.#closedBy;
  }

  draw<Data>(data: Data, view: View<Data>): Promise<void> {
    if (this.#finished || !this.live) {
      return Promise.resolve();
    }
    return this.#regions.draw(this, data, view);
  }

  end(state: 'ended' | 'failed' = 'ended', label?: string): Promise<void> {
    return this.close('end', state, label);
  }

  report(progress: ProgressReport): void {
    if (this.#closedBy === undefined) {
      this.reports.report(progress);
    }
  }

  /**
   * Closes the region once, whatever closes it: `closedBy` is set, the signal aborts and its
   * listeners run, a frame one of them draws is the last frame, and then the region leaves the
   * stack. The close resolves once that is written, and a later close resolves at once. A `label`
   * from `end()` replaces the reported label on the end event.
   */
  close(closer: RegionCloser, state: 'ended' | 'failed', label?: string): Promise<void> {
    if (this.#closedBy !== undefined) {
      return Promise.resolve();
    }
    this.#closedBy = closer;
    this.#controller.abort();
    this.#finished = true;
    this.reports.close(closer, state, label);
    const released = this.#regions.release(this);
    void handled(released);
    return released;
  }
}

/**
 * The regions one run opened: the ones still open in the order they opened, the one input region
 * that is open, and the input regions waiting for it to close.
 */
class Regions {
  readonly #open = new Set<LiveRegion>();
  readonly #waiting: LiveRegion[] = [];
  #inputOwner: LiveRegion | undefined = undefined;
  /** The live regions that opened and have not closed, which hold the suspend handlers. */
  #live = 0;
  #releaseSuspend: (() => void) | undefined = undefined;

  constructor(
    private readonly host: RegionHost,
    readonly screen: Screen,
  ) {}

  /**
   * Opens one region for `out.region(options)`, which `owner` collects when the opener closes the
   * regions it left open. A region opened after the run's cancellation closes at once.
   */
  open(options: RegionOptions | undefined, owner?: Set<LiveRegion>): Region {
    const input = options?.input === true;
    const region = new LiveRegion(this, {
      input,
      live: this.host.live(input),
      reports: this.host.ledger.region(),
    });
    this.#open.add(region);
    owner?.add(region);
    if (region.live && input && this.#inputOwner !== undefined) {
      this.#waiting.push(region);
    } else {
      this.#start(region);
    }
    if (this.host.cancelled()) {
      void region.close('cancellation', 'ended');
    }
    return region;
  }

  /** Closes every region still open, or waiting to open, among `only` when it is given. */
  closeAll(closer: RegionCloser, only?: ReadonlySet<LiveRegion>): void {
    const targets = [...this.#open].filter((region) => only === undefined || only.has(region));
    // A waiting region closes first, so the input region that closes after it promotes none.
    targets.sort((left, right) => Number(left.opened) - Number(right.opened));
    for (const region of targets) {
      void region.close(closer, 'ended');
    }
  }

  /** One frame of a live region that has not finished. */
  draw(region: LiveRegion, data: unknown, view: View<never>): Promise<void> {
    const frame = this.host.frame(data, view);
    if ('failed' in frame) {
      return frame.failed;
    }
    if (!region.opened) {
      region.pending = frame;
      return new Promise((resolve) => {
        region.waiters.push(resolve);
      });
    }
    const drawn = this.host.write(() => this.screen.draw(region.slot, frame));
    void handled(drawn);
    return drawn;
  }

  /** A region that closed leaves the stack, and the next waiting input region opens. */
  release(region: LiveRegion): Promise<void> {
    this.#open.delete(region);
    if (!region.opened) {
      this.#waiting.splice(this.#waiting.indexOf(region), 1);
      for (const resolve of region.waiters.splice(0)) {
        resolve();
      }
      return Promise.resolve();
    }
    const closing = region.live
      ? this.host.write(() => this.screen.close(region.slot))
      : Promise.resolve();
    if (region.live) {
      this.#leaveLive();
    }
    if (region === this.#inputOwner) {
      this.#inputOwner = undefined;
      const next = this.#waiting.shift();
      if (next !== undefined) {
        this.#start(next);
      }
    }
    return closing;
  }

  /** A region that opens now: an input region holds the input until it closes. */
  #start(region: LiveRegion): void {
    region.opened = true;
    if (!region.live) {
      return;
    }
    this.#enterLive();
    if (region.input) {
      this.#inputOwner = region;
    }
    const { pending, slot } = region;
    const opened = this.host.write(() => {
      this.screen.open(slot);
      return pending === undefined ? '' : this.screen.draw(slot, pending);
    });
    // A waiting draw resolves once the region has opened, whether or not its write succeeded.
    const release = async (): Promise<void> => {
      try {
        await opened;
      } catch {
        // The write's failure is stderr's, recorded where it was queued.
      }
      for (const resolve of region.waiters.splice(0)) {
        resolve();
      }
    };
    void release();
  }

  /** A live region opened: the first one makes a suspend erase the regions. */
  #enterLive(): void {
    this.#live += 1;
    if (this.#live === 1) {
      this.#releaseSuspend = this.host.holdSuspend();
    }
  }

  /** A live region closed: once none is open, a suspend has nothing to erase. */
  #leaveLive(): void {
    this.#live -= 1;
    if (this.#live === 0) {
      this.#releaseSuspend?.();
      this.#releaseSuspend = undefined;
    }
  }
}

export { Regions, Screen };
export type { Frame, LiveRegion, RegionHost };
