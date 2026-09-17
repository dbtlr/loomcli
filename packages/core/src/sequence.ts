import { InternalError, routedSubject } from './errors.js';
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
 * The view one sequence writes through. A row view writes each row as the source yields it; a
 * whole view collects every row and renders once at the end of the source.
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

/**
 * The two iteration protocols, read off one source without assuming it carries either. A string
 * carries the synchronous one and answers no `in` check, and an object may carry the asynchronous
 * key with nothing callable under it, so each is read and tested rather than probed for.
 */
interface Protocols<Row> {
  [Symbol.asyncIterator]?: (() => AsyncIterator<Row>) | undefined;
  [Symbol.iterator]?: (() => Iterator<Row>) | undefined;
}

/**
 * The steps one source answers with, under whichever protocol it carries. The asynchronous one
 * answers first, as the language's own `for await` does.
 * A value that iterates neither way answers with nothing, and its caller reports the fault.
 */
function iterate<Row>(source: Protocols<Row> | null | undefined): Steps<Row> | undefined {
  const asynchronous = source?.[Symbol.asyncIterator];
  if (typeof asynchronous === 'function') {
    return asynchronous.call(source);
  }
  const synchronous = source?.[Symbol.iterator];
  if (typeof synchronous === 'function') {
    return synchronous.call(source);
  }
  return undefined;
}

/**
 * The steps one source answers with, with whatever the protocol raised marked as the source's own
 * failure. A value that iterates neither way is the same fault, named for the Command that emitted
 * it, because the types reject it and a JavaScript author alone reaches it.
 */
function stepsOf<Row>(writer: SequenceWriter<Row>): Steps<Row> {
  let steps: Steps<Row> | undefined = undefined;
  try {
    steps = iterate(writer.source);
  } catch (error) {
    throw new SourceFault(error);
  }
  if (!steps) {
    throw new SourceFault(
      new InternalError(`The result of ${routedSubject(writer.path)} is not iterable.`, undefined),
    );
  }
  return steps;
}

/**
 * One step of a source, read inside the source-fault wrapper. `done` and `value` are read here, so
 * an iterator result whose own getter throws is the source's failure rather than an escape.
 */
type Pulled<Row> = { done: true } | { done: false; value: Row };

/** One request of the source, with whatever it raised marked as the source's own failure. */
async function pull<Row>(steps: Steps<Row>): Promise<Pulled<Row>> {
  try {
    const result = await steps.next();
    return result.done === true ? { done: true } : { done: false, value: result.value };
  } catch (error) {
    throw new SourceFault(error);
  }
}

/** One reading of one source: the steps it answers with, and what it has produced so far. */
interface Reading<Row> {
  counts: Counts;
  live: Live;
  signal: AbortSignal;
  steps: Steps<Row>;
}

/**
 * The stop, read before the writer requests the next row and before it writes the piece it holds.
 * A cancelled run stops here too, so core requests no further rows and writes no further pieces
 * from the moment the signal aborted.
 */
function halt(reading: { live: Live; signal: AbortSignal }): void {
  if (reading.live.stopped || reading.signal.aborted) {
    throw stopRequested;
  }
}

/** One step, counted where the source produced a row. A stopped writer requests none. */
async function step<Row>(reading: Reading<Row>): Promise<Pulled<Row>> {
  halt(reading);
  const result = await pull(reading.steps);
  if (!result.done) {
    reading.counts.yielded += 1;
  }
  // A row an in-flight request delivered after the stop is counted, and nothing is written for it.
  halt(reading);
  return result;
}

/**
 * The source is told the writer wants no more rows, so a generator runs its own cleanup.
 * The settlement is never awaited: a cleanup that never settles would pin the destination's tail,
 * and the failure that stopped the sequence would never be reported.
 * Whatever that cleanup raises is the source's business, and it is observed here alone, because the
 * stop is reported through the fault that raised it and a second failure would replace it.
 */
function endSteps<Row>(steps: Steps<Row>): void {
  try {
    const ended: unknown = steps.return?.();
    void Promise.resolve(ended).catch(() => undefined);
  } catch {
    // A cleanup that throws outright is the same business, and it ends here too.
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
  halt(reading);
  await writeEdge(writer, view.head);
  for (;;) {
    const next = await step(reading);
    if (next.done) {
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
    if (next.done) {
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
    endSteps(reading.steps);
    throw error;
  }
}

/**
 * The sequence itself: every piece the source decides, then the closing piece. Every piece is
 * awaited before the next row is requested, so a slow destination applies back-pressure to the
 * source. The stop is read once more between the source's end and the closing piece, so a run
 * cancelled there, and an action that failed there, never write it and a truncated result never
 * reads as a complete one.
 */
async function writeRows<Row>(
  writer: SequenceWriter<Row>,
  live: Live,
  counts: Counts,
): Promise<boolean> {
  const reading: Reading<Row> = { counts, live, signal: writer.signal, steps: stepsOf(writer) };
  const close = await closingPiece(writer, reading);
  if (live.stopped || writer.signal.aborted) {
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
