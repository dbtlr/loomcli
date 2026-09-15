import type { IncompleteResult } from './lanes.js';
import type { ViewContext } from './types.js';
import type { ResolvedRowView } from './view.js';

/**
 * A failure the source raised, so the writer tells it apart from the view and write faults its own
 * pieces raise, which the output path has accounted for already.
 */
class SourceFault {
  readonly cause: unknown;

  constructor(cause: unknown) {
    this.cause = cause;
  }
}

/**
 * The value a stopped writer unwinds with, compared by identity where the sequence ends. The
 * invocation that stopped it has a primary failure of its own, so this value reports nothing.
 */
const stopRequested = Symbol('stopped');

/** Whether the invocation still wants rows, read where the writer would otherwise go on. */
interface Live {
  stopped: boolean;
}

/** One source read as the steps the writer pulls, whichever iteration protocol it carries. */
interface Steps<Row> {
  next: () => Promise<IteratorResult<Row>> | IteratorResult<Row>;
  return?: (() => unknown) | undefined;
}

/** How many rows the source produced, and how many of them core wrote. */
interface Counts {
  written: number;
  yielded: number;
}

/**
 * The presentation one sequence writes through. A row view writes each row as the source yields
 * it; a whole view collects every row and renders once at the end of the source.
 */
type SequenceView<Row> =
  | { kind: 'rows'; view: ResolvedRowView<Row> }
  | { kind: 'whole'; render: (rows: readonly Row[], context: ViewContext) => unknown };

/** What one sequence writes through, supplied by the output that reserved its place. */
interface SequenceWriter<Row> {
  /** The context of the destination the pieces reach. */
  context: ViewContext;
  /** Ends the reservation, so later output to that destination writes after this sequence. */
  close: () => void;
  /** Writes the incomplete-result line on stderr, before the fault's own report. */
  incomplete: (facts: IncompleteResult) => void;
  path: readonly string[];
  /** Resolves and queues one piece on the reserved place, rejecting on a view or write fault. */
  piece: (produce: () => unknown) => Promise<void>;
  signal: AbortSignal;
  source: Iterable<Row> | AsyncIterable<Row>;
  /** Records a source failure, which this invocation reports after its primary outcome. */
  stopped: (cause: unknown) => void;
  view: SequenceView<Row>;
}

/** The steps one source answers with. A value that iterates neither way fails as the source. */
function stepsOf<Row>(source: Iterable<Row> | AsyncIterable<Row>): Steps<Row> {
  try {
    return Symbol.asyncIterator in source
      ? source[Symbol.asyncIterator]()
      : source[Symbol.iterator]();
  } catch (error) {
    throw new SourceFault(error);
  }
}

/** One request of the source, with whatever it raised marked as the source's own failure. */
async function pull<Row>(steps: Steps<Row>): Promise<IteratorResult<Row>> {
  try {
    return await steps.next();
  } catch (error) {
    throw new SourceFault(error);
  }
}

/** One reading of one source: the steps it answers with, and what it has produced so far. */
interface Reading<Row> {
  counts: Counts;
  live: Live;
  steps: Steps<Row>;
}

/** The stop, read where the writer would request the next row or write the one it holds. */
function halt(live: Live): void {
  if (live.stopped) {
    throw stopRequested;
  }
}

/** One step, counted where the source produced a row. A stopped writer requests none. */
async function step<Row>(reading: Reading<Row>): Promise<IteratorResult<Row>> {
  halt(reading.live);
  const result = await pull(reading.steps);
  if (result.done !== true) {
    reading.counts.yielded += 1;
  }
  // A row the source produced after the stop was counted, and nothing is written for it.
  halt(reading.live);
  return result;
}

/**
 * The source is told the writer wants no more rows, so a generator runs its own cleanup. Whatever
 * that cleanup raises is the source's business: the stop that reaches this point is reported
 * already, and a second failure would replace it.
 */
async function endSteps<Row>(steps: Steps<Row>): Promise<void> {
  try {
    await steps.return?.();
  } catch {
    // The stop is reported through the fault that raised it, never through the cleanup.
  }
}

/** The text one edge function returns. An absent `head` or `tail` writes nothing at all. */
function edge(
  produce: ((context: ViewContext) => unknown) | undefined,
  context: ViewContext,
): (() => unknown) | undefined {
  return produce === undefined ? undefined : () => produce(context);
}

/** One piece, skipped where the view supplies no function for it. */
async function writeEdge<Row>(
  writer: SequenceWriter<Row>,
  produce: ((context: ViewContext) => unknown) | undefined,
): Promise<void> {
  const text = edge(produce, writer.context);
  if (text) {
    await writer.piece(text);
  }
}

/**
 * Every piece but `tail`: `head`, then each row as the source yields it. Each piece is awaited
 * before the next row is requested, so a slow destination applies back-pressure to the source.
 */
async function writeEachRow<Row>(
  writer: SequenceWriter<Row>,
  view: ResolvedRowView<Row>,
  reading: Reading<Row>,
): Promise<void> {
  await writeEdge(writer, view.head);
  for (;;) {
    const next = await step(reading);
    if (next.done === true) {
      return;
    }
    const index = reading.counts.yielded - 1;
    await writer.piece(() => view.row(next.value, index, writer.context));
    reading.counts.written += 1;
  }
}

/** Every row the source produced, which a whole view renders once at the end of the source. */
async function collectRows<Row>(reading: Reading<Row>): Promise<Row[]> {
  const collected: Row[] = [];
  for (;;) {
    const next = await step(reading);
    if (next.done === true) {
      return collected;
    }
    collected.push(next.value);
  }
}

/**
 * Every piece the source decides, and the closing piece a complete sequence ends with: `head` and
 * each row under a row view, whose closing piece is `tail`, and the collected rows under a whole
 * view, whose closing piece is its one render. A whole view queues nothing before the source ends,
 * so `written` counts no row under it.
 */
async function writePieces<Row>(
  writer: SequenceWriter<Row>,
  reading: Reading<Row>,
): Promise<() => Promise<void>> {
  if (writer.view.kind === 'whole') {
    const { render } = writer.view;
    const collected = await collectRows(reading);
    return () => writer.piece(() => render(collected, writer.context));
  }
  const { view } = writer.view;
  await writeEachRow(writer, view, reading);
  return () => writeEdge(writer, view.tail);
}

/** The same pieces, with the source told to stop where one of them raised. */
async function closingPiece<Row>(
  writer: SequenceWriter<Row>,
  reading: Reading<Row>,
): Promise<() => Promise<void>> {
  try {
    return await writePieces(writer, reading);
  } catch (error) {
    await endSteps(reading.steps);
    throw error;
  }
}

/**
 * The sequence itself: every piece the source decides, then the closing piece. Every piece is
 * awaited before the next row is requested, so a slow destination applies back-pressure to the
 * source. A run cancelled before the source ended never writes the closing piece, so a truncated
 * result never reads as a complete one.
 */
async function writeRows<Row>(
  writer: SequenceWriter<Row>,
  live: Live,
  counts: Counts,
): Promise<boolean> {
  const close = await closingPiece(writer, { counts, live, steps: stepsOf(writer.source) });
  if (writer.signal.aborted) {
    return false;
  }
  await close();
  return true;
}

/**
 * One sequence written on the place its call reserved. A stop before the end retracts nothing, adds
 * no `tail`, and writes one incomplete-result line on stderr before the fault's own report; a
 * source failure is recorded there, because a call the action never awaited observes none.
 */
async function runSequence<Row>(writer: SequenceWriter<Row>, live: Live): Promise<void> {
  const counts: Counts = { written: 0, yielded: 0 };
  try {
    if (!(await writeRows(writer, live, counts))) {
      writer.incomplete({ path: writer.path, ...counts });
    }
  } catch (error) {
    writer.incomplete({ path: writer.path, ...counts });
    raise(writer, error);
  } finally {
    writer.close();
  }
}

/**
 * What one stop leaves behind once its line is written: nothing, where the invocation asked for
 * the stop and reports its own failure, the source's failure recorded and raised, or the fault of
 * a piece, which the output path has accounted for already.
 */
function raise<Row>(writer: SequenceWriter<Row>, error: unknown): void {
  if (error === stopRequested) {
    return;
  }
  if (error instanceof SourceFault) {
    writer.stopped(error.cause);
    throw error.cause;
  }
  throw error;
}

/** One sequence in flight: the promise its call answers with, and the switch that ends it early. */
interface LiveSequence {
  pending: Promise<void>;
  /** Ends the sequence where it next would go on. A finished sequence answers it with nothing. */
  stop: () => void;
}

/** One sequence, started here and stoppable from the invocation that issued it. */
function writeSequence<Row>(writer: SequenceWriter<Row>): LiveSequence {
  const live: Live = { stopped: false };
  return {
    pending: runSequence(writer, live),
    stop: () => {
      live.stopped = true;
    },
  };
}

export type { LiveSequence, SequenceView, SequenceWriter };
export { writeSequence };
