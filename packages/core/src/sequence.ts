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
  view: ResolvedRowView<Row>;
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

/** One step, counted where the source produced a row. */
async function step<Row>(steps: Steps<Row>, counts: Counts): Promise<IteratorResult<Row>> {
  const result = await pull(steps);
  if (result.done !== true) {
    counts.yielded += 1;
  }
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
  steps: Steps<Row>,
  counts: Counts,
): Promise<void> {
  await writeEdge(writer, writer.view.head);
  for (;;) {
    const next = await step(steps, counts);
    if (next.done === true) {
      return;
    }
    const index = counts.yielded - 1;
    await writer.piece(() => writer.view.row(next.value, index, writer.context));
    counts.written += 1;
  }
}

/**
 * The sequence itself: `head`, then each row as the source yields it, then `tail`. Every piece is
 * awaited before the next row is requested, so a slow destination applies back-pressure to the
 * source. A run cancelled before the source ended never writes `tail`, so a truncated result never
 * reads as a complete one.
 */
async function writeRows<Row>(writer: SequenceWriter<Row>, counts: Counts): Promise<boolean> {
  const steps = stepsOf(writer.source);
  try {
    await writeEachRow(writer, steps, counts);
  } catch (error) {
    await endSteps(steps);
    throw error;
  }
  if (writer.signal.aborted) {
    return false;
  }
  await writeEdge(writer, writer.view.tail);
  return true;
}

/**
 * One sequence written on the place its call reserved. A stop before the end retracts nothing, adds
 * no `tail`, and writes one incomplete-result line on stderr before the fault's own report; a
 * source failure is recorded there, because a call the action never awaited observes none.
 */
async function writeSequence<Row>(writer: SequenceWriter<Row>): Promise<void> {
  const counts: Counts = { written: 0, yielded: 0 };
  try {
    if (!(await writeRows(writer, counts))) {
      writer.incomplete({ path: writer.path, ...counts });
    }
  } catch (error) {
    writer.incomplete({ path: writer.path, ...counts });
    if (error instanceof SourceFault) {
      writer.stopped(error.cause);
      throw error.cause;
    }
    throw error;
  } finally {
    writer.close();
  }
}

export type { SequenceWriter };
export { writeSequence };
