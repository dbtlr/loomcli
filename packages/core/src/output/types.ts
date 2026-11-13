import type { Background } from '../host/background.js';
import type { ContextualStyle } from '../style/style.js';

/**
 * Immutable authoring and measurement context for one view destination.
 *
 * @public
 * @sealed
 */
export interface ViewContext {
  /**
   * The run's background, `'dark'` or `'light'`, or `undefined` when no source settled it. It holds
   * one value for the whole run.
   */
  readonly background: Background | undefined;
  /**
   * The destination's effective width, read just before this render call: the real terminal width
   * narrowed by a valid `COLUMNS`. A terminal that reports no width takes a valid `COLUMNS` alone,
   * and reads `undefined` without one. A destination that is not a terminal reads `undefined`.
   */
  readonly columns: number | undefined;
  /**
   * Replaces each tab in marked text with the spaces that reach the next multiple of eight,
   * counted from the start of its input line as `width` counts, so text placed after other text
   * shows as it measures. A tab inside a `pad` frame is left to the frame, which expands it.
   */
  readonly expandTabs: (text: string) => string;
  /** Resolves marked text without styles or controls, keeping this destination's glyph forms. */
  readonly plain: (text: string) => string;
  readonly style: ContextualStyle;
  readonly width: (text: string) => number;
  /**
   * Breaks marked text at spaces so each line fits `columns`, measured as `width` measures. A word
   * wider than `columns` keeps a line of its own, and an undefined `columns` returns the text.
   */
  readonly wrap: (text: string, columns: number | undefined) => string;
}

/**
 * A pure synchronous view turns one typed value into the marked text core resolves.
 *
 * @public
 */
export interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  /** The media type of the text the view writes, such as `application/json`; omitted for none. */
  mediaType?: string;
  /** A view has one shape; the row view of Results is the other. */
  row?: undefined;
}

/**
 * A row view renders a sequence one row at a time.
 * `head` and `tail` open and close the sequence, and each defaults to the empty string.
 * Every function is pure and synchronous and owns the newlines in the text it returns.
 *
 * @public
 */
export interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (count: number, context: ViewContext) => string;
  /** The media type of the text the rows write together, such as `application/jsonl`. */
  mediaType?: string;
  /** A row view has one shape; the whole view of Rendered output is the other. */
  render?: undefined;
}

/**
 * The views record of a value result: every entry renders the whole value.
 *
 * @public
 */
export type ResultViews<Value> = Readonly<Record<string, View<Value>>>;

/**
 * The views record of a rows result: a whole view over the collected rows, which core buffers the
 * sequence for, or a row view, which core feeds as the rows arrive.
 *
 * @public
 */
export type RowViews<Row> = Readonly<Record<string, View<readonly Row[]> | RowView<Row>>>;

/**
 * One view a result names, with its data type erased, as the view registry erases a declared
 * view's. The write site reads each function back through the key that resolved it.
 *
 * @public
 */
export type ResultView = View<never> | RowView<never>;

/**
 * One declared result as the write site reads it: the unit the action emits, the view names it
 * declares in record order, and the key core renders when nothing selects another.
 */
export interface DeclaredResult {
  default: string;
  kind: 'value' | 'rows';
  views: ReadonlyMap<string, ResultView>;
  /** Each view's media type as the call that stored it read it, by view name, `null` for none. */
  mediaTypes: ReadonlyMap<string, string | null>;
}

/**
 * What `out.results` accepts for one declared result. The declaration rides in the declared types
 * as a closed discriminant, so a Command that declares none carries the neutral `unknown` and its
 * `out.results` takes `never`. The parameter is never a union, so distribution reaches one member.
 *
 * @public
 */
export type ResultInput<Result> = Result extends { kind: 'value'; value: infer Value }
  ? Value
  : Result extends { kind: 'rows'; row: infer Row }
    ? Iterable<Row> | AsyncIterable<Row>
    : never;

/**
 * The result an `out` carries where the declaration is not in hand. Its `results` accepts any
 * value, because the authoring call already checked what the Command declares, and the channel
 * core builds for an action carries that declaration at run time.
 */
export interface OpenResult {
  kind: 'value';
  value: unknown;
}

/** The record a `views()` call takes, which is the shape the carried result names. */
export type ResultViewsOf<Result> = Result extends { kind: 'value'; value: infer Value }
  ? ResultViews<Value>
  : Result extends { kind: 'rows'; row: infer Row }
    ? RowViews<Row>
    : never;

/**
 * The data `out.render` accepts: any value under a whole view, and under a row view a sequence of
 * that view's rows. A stated row view's row type is read from the view, so a generic sequence
 * reaches it, and data that is not a sequence, one row or rows that may be `undefined`, does not.
 *
 * @public
 */
export type RenderedData<Data, Row> = Data &
  ([Row] extends [never] ? unknown : Iterable<NoInfer<Row>> | AsyncIterable<NoInfer<Row>>);

/**
 * The row view over the rows `Data` yields, which types a pack view's factory from the data. The
 * check is not distributive, so data that may be `undefined` or a single row has no such view.
 *
 * @public
 */
export type RowViewOver<Data> = [Data] extends [Iterable<infer Row> | AsyncIterable<infer Row>]
  ? RowView<Row>
  : never;

/** @public @sealed */
export interface Out<Result = unknown> {
  /**
   * A message on stdout at every verbosity, or on stderr from the action of a Command that declares
   * a result. Each semantic method draws its message through its lane view, or through `view` when
   * the call passes one, which replaces the lane view for that call, and ends it with exactly one
   * line break.
   */
  print(message: string, view?: View<string>): Promise<void>;
  /** An informational message on stderr, hidden under `-q`. */
  info(message: string, view?: View<string>): Promise<void>;
  /** A success message on stderr, hidden under `-q`. */
  success(message: string, view?: View<string>): Promise<void>;
  /** A warning on stderr at every verbosity. */
  warn(message: string, view?: View<string>): Promise<void>;
  /** An error message on stderr at every verbosity, which changes no outcome. */
  error(message: string, view?: View<string>): Promise<void>;
  /** A debug line on stderr, written from verbosity 1, as an operator's `-v` asks. */
  debug(message: string, view?: View<string>): Promise<void>;
  /** A trace line on stderr, finer than a debug line, written from verbosity 2, as an operator's `-vv` asks. */
  trace(message: string, view?: View<string>): Promise<void>;
  /**
   * The neutral view call: a rendered value has no purpose and no destination. A row view takes an
   * iterable, and core writes each row's text as the source yields it. One signature rather than an
   * overload per shape, because the compiler fixes a factory call's type against the first overload
   * it tries, which left a row view's configuration typed from its own keys.
   */
  render<Data, Row = never>(
    data: RenderedData<Data, Row>,
    view: View<Data> | ([Row] extends [never] ? RowViewOver<Data> : RowView<Row>),
  ): Promise<void>;
  /** Draws a view on stderr without a newline, preserving terminal controls at a terminal. */
  draw<Data>(data: Data, view: View<Data>): Promise<number>;
  /**
   * The text `render` would write for a whole view at this moment, resolved for `render`'s
   * destination, and written nowhere, so a caller can decide where the bytes go.
   */
  text<Data>(data: Data, view: View<Data>): string;
  /**
   * Opens a live region at the bottom of stderr and returns its handle at once. Core keeps every
   * open region below every other write, in open order, and closes one left open when what opened
   * it finishes.
   */
  region(options?: RegionOptions): Region;
  /** Lends the terminal to work, holding region frames until it settles. */
  lendTerminal<Value>(work: () => Value | PromiseLike<Value>): Promise<Value>;
  /**
   * The Command's own result, emitted once. Property syntax keeps the parameter contravariant, so
   * a neutral `Out` never stands in for one that carries a declaration.
   */
  results: (value: ResultInput<Result>) => Promise<void>;
  fatal(message: string): never;
}

/**
 * How `out.region()` opens a region.
 *
 * @public
 */
export interface RegionOptions {
  /** The region reads the operator's keys, as a question does. */
  readonly input?: boolean;
}

/**
 * What closed a region: its own `end()`, its opener finishing, a failure, or cancellation.
 *
 * @public
 * @sealed
 */
export type RegionCloser = 'end' | 'completion' | 'failure' | 'cancellation';

/**
 * One report of a region's progress; an omitted field keeps its last reported value.
 *
 * @public
 */
export interface ProgressReport {
  readonly completed?: number;
  readonly total?: number;
  readonly label?: string;
}

/**
 * The handle `out.region()` returns.
 *
 * @public
 * @sealed
 */
export interface Region {
  /** Whether core draws this region's frames: stderr is a terminal, and the region takes input or the run is not quiet. */
  readonly live: boolean;
  /** Aborted whenever the region closes, after `closedBy` is set. */
  readonly signal: AbortSignal;
  /** What closed the region, or `undefined` while it is open. */
  readonly closedBy: RegionCloser | undefined;
  /** Replaces the region's frame with a view's text, rendered as `out.draw` renders it. */
  draw<Data>(data: Data, view: View<Data>): Promise<void>;
  /**
   * Closes the region, leaving its last frame in scrollback; `'failed'` makes its end event read
   * failed, and a `label` replaces the reported label on that event.
   */
  end(state?: 'ended' | 'failed', label?: string): Promise<void>;
  /** Builds a typed progress event for whoever observes the run, and draws nothing. */
  report(progress: ProgressReport): void;
}

/**
 * The typed value a region's report builds, which a program reads without reading a frame.
 *
 * @public
 * @sealed
 */
export interface ProgressEvent {
  readonly id: number;
  readonly label: string;
  readonly state: 'started' | 'updated' | 'ended' | 'failed' | 'cancelled';
  readonly completed?: number;
  readonly total?: number;
}

/**
 * What the action's channel answers to: the routed path its diagnostics name, the result the
 * routed Command declared, and the view this run selected. The declaration decides the
 * destinations the channel carries, so the redirect is read from the graph once and never from the
 * view a run selected; `view` decides the rendering alone, and is `null` when nothing selected one
 * and the declaration's default stands.
 */
export interface ResultBinding {
  path: readonly string[];
  result: DeclaredResult | undefined;
  view: string | null;
}
