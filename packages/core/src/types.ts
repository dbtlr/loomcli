/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Background } from './background.js';
import type { Content } from './content.js';
import type { LoomError } from './errors.js';
import type { FailureExitCode } from './exit-codes.js';
import type { ExtensionValue } from './extension.js';
import type { FailureForm } from './form.js';
import type { CommandGraph, CommandNode, ResultNode } from './inspect.js';
import type { Log } from './log.js';
import type { RenderingPolicy } from './rendering.js';
import type { OnResume, OnShutdown, OnSuspend } from './signal-lane.js';
import type { ContextualStyle } from './style.js';

type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';
type ShortAlias = LowercaseLetter | Uppercase<LowercaseLetter>;
/**
 * The spellings an option declares beyond its long form. `aliases` adds a long spelling for each
 * name, so `shortOnly`, which removes every long spelling, never declares one.
 */
type OptionSpelling =
  | { short?: ShortAlias; shortOnly?: false; aliases?: readonly string[] }
  | { short: ShortAlias; shortOnly: true; aliases?: never };

type Presence = { required: true; default?: never } | { required?: false; default?: unknown };
/**
 * The literal member keeps `multiple: true` exact under contextual typing, as `Presence` does.
 * A multiple option takes its list from the configuration source, so it binds no variable.
 */
type Multiplicity = { multiple: true; env?: never } | ({ multiple?: false } & EnvBinding);
/**
 * The environment binding: the variable, or the non-empty list of variables, the input-source
 * stage fills the option from when argv supplies none. The first name holding a value supplies it.
 * The declaration names each explicitly, and core derives no name.
 */
interface EnvBinding {
  env?: string | readonly [string, ...string[]];
}
/**
 * `validateOmitted: true` sends an omitted optional scalar to its own schema. The literal member
 * keeps the flag exact under contextual typing, as `Multiplicity` does.
 */
type Omission = { validateOmitted: true } | { validateOmitted?: false };
/**
 * The presence rules a global option never declares, because its validation runs on every Command.
 * `GlobalOptionConfig` and `GlobalOmissionConstraint` both read the rule from here.
 */
type PresenceRuleKey = 'required' | 'validateOmitted';

/** The fault each presence rule names when a global option declares it. */
interface PresenceRuleFaults {
  required: {
    'A global option declares no required; the Commands that read it check for it': never;
  };
  validateOmitted: {
    'A global option declares no validateOmitted; its omission is plain absence': never;
  };
}

/** The first presence rule a config declares, in the order the faults name them. */
type DeclaredPresenceRule<Config> = {
  [Key in PresenceRuleKey]: [Extract<Config, Record<Key, unknown>>] extends [never] ? never : Key;
}[PresenceRuleKey];

/**
 * The one-line summary every projection reads. It is a core fact: optional, and a string that holds
 * a character other than whitespace and no line terminator.
 */
interface Described {
  description?: string;
}
/**
 * The two core facts a listing reads on a named Command and on an option.
 * `hidden` keeps the member off every listing, and an omitted one reads `false`.
 * `deprecated` is the one-line migration message a listing shows beside the member.
 * Neither belongs to an argument, which cannot leave the grammar it sits in, or to the root.
 */
interface Listed {
  hidden?: boolean;
  deprecated?: string;
}
/** Every key any member of a union declares. */
type KeysOf<Type> = Type extends unknown ? keyof Type : never;
/**
 * The core fact that marks an option as controlling the invocation rather than feeding the
 * Command's work, such as `--help` or `--format`. An omitted mark reads `false`. Core never reads
 * it at run time; a projection that lists what a Command needs does.
 */
interface Controlled {
  control?: boolean;
}
/** The extension values one option declaration carries, whatever scope declares the option. */
interface OptionExtensions {
  extensions?: readonly ExtensionValue<'option'>[];
}
/** What every Boolean option declares, whichever of its three shapes it takes. */
type BooleanFacts = Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'boolean';
    interaction?: true;
    verbose?: never;
    quiet?: never;
    background?: never;
    validate?: never;
    default?: never;
    multiple?: never;
    required?: never;
    validateOmitted?: never;
    implied?: never;
  };
/**
 * A value-taking option carries no run-wide mark but the background mark, which the marked string
 * shape declares: the interaction and color marks belong to one Boolean global option each, and
 * the verbose and quiet marks to one counted global option each. A local option's declaration
 * carries none of them either.
 */
interface Unmarked {
  interaction?: never;
  color?: never;
  verbose?: never;
  quiet?: never;
  background?: never;
}
/** The same slot on an argument declaration, typed by the target its values must name. */
interface ArgumentExtensions {
  extensions?: readonly ExtensionValue<'argument'>[];
}
/**
 * The tokens one declaration collects before validation: one string, or several. A multiple option
 * and a variadic argument collect alike, so they share this raw shape.
 */
type RawValue<Config> = Config extends { multiple: true } | { variadic: true } ? string[] : string;
/** A multiple option and a variadic argument pass each value through the same validator. */
type PerValue<Config, Value> = Config extends { multiple: true } | { variadic: true }
  ? Value[]
  : Value;
/** The validated value: the validator's output for each value, or the raw shape without one. */
type SchemaOutput<Config, Schema, Raw> = Schema extends StandardSchemaV1
  ? PerValue<Config, StandardSchemaV1.InferOutput<Schema>>
  : Raw;
type SchemaInput<Schema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<Schema>
  : string;
/** The value a default stands in for: the validator's input for each value, or the raw tokens. */
type DefaultInput<Config> = 'validate' extends keyof Config
  ? PerValue<Config, SchemaInput<Config['validate']>>
  : RawValue<Config>;
/**
 * The defaults a config accepts: its default input, or a readonly list of it. A list a conditional
 * declaration writes inline infers as a readonly tuple, and core copies a declared list for each
 * run, so the action still receives its own array.
 */
type AcceptedDefault<Config> =
  | DefaultInput<Config>
  | (DefaultInput<Config> extends unknown[] ? Readonly<DefaultInput<Config>> : never);
/**
 * The members of a config whose declared default is outside their own accepted defaults. A
 * default a config spreads in conditionally is optional, and is checked the same way. An
 * `unknown` default, which the wide `OptionConfig` declares, states nothing to check.
 */
type DefaultFault<Config> = Config extends { default: infer Default }
  ? [Default] extends [AcceptedDefault<Config>]
    ? never
    : Config
  : 'default' extends keyof Config
    ? unknown extends Config['default']
      ? never
      : Config extends { default?: AcceptedDefault<Config> }
        ? never
        : Config
    : never;
/**
 * Each member paired with its own default input. A member whose default misses that input
 * reduces to `never`, so another member's validator input never stands in for it.
 */
type PairedDefault<Config> = Config extends unknown
  ? Config & { default?: DefaultInput<Config> }
  : never;

/** The named key states the rule, so a rejected declaration name reads as its own diagnostic. */
interface LiteralNameFault {
  'Declaration names must be one literal string': never;
}

type ActionArgument<Declaration> =
  ActionHandler<Declaration> extends (context: infer Context) => unknown ? Context : never;

/** The context fragment a stdin declaration contributes to its action. */
interface StdinContext {
  readonly stdin?: Content | undefined;
}

interface ContentInput {
  type: 'content';
  stdin?: boolean;
  required?: boolean;
  default?: never;
  validate?: never;
  validateOmitted?: never;
}

/** A local option name cannot repeat a key the globals already own; the key names the fault. */
export type GlobalNameConstraint<Name extends string, Globals> = Name extends keyof Globals
  ? { 'This option name is already declared as a global option': Name }
  : unknown;

/** A required record key excludes open strings; distribution rejects each union member. */
export type NameConstraint<Name extends string, Whole extends string = Name> =
  {} extends Record<Name, unknown>
    ? LiteralNameFault
    : Name extends Whole
      ? [Whole] extends [Name]
        ? unknown
        : LiteralNameFault
      : LiteralNameFault;

/** The status `run()` resolves: success, a failure class's code, or a cancellation code. */
export type ExitCode = 0 | FailureExitCode | 129 | 130 | 131 | 141 | 143;
export interface InputTerminal {
  isTTY: boolean;
}
export interface OutputTerminal extends InputTerminal {
  columns: number | undefined;
  rows: number | undefined;
}
/**
 * The run's terminal facts: each stream's kind, the output streams' live width and height, and the
 * run's background, the one fact core settles rather than captures. It reads `undefined` until it
 * settles, when no source settled it, and in an invocation by name.
 */
export interface HostTerminal {
  stdin: InputTerminal;
  stdout: OutputTerminal;
  stderr: OutputTerminal;
  readonly background: Background | undefined;
}
/** A signal a signal source delivers and raises. */
export type ProcessSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGTSTP' | 'SIGCONT';
/** A listener for one signal source event: the `exit` event passes the exit code, a signal nothing. */
export type SignalListener<Event extends ProcessSignal | 'exit'> = Event extends 'exit'
  ? (code: number) => void
  : () => void;
/**
 * Where a run's signals come from and where core raises them: the real process's own, which every
 * handle `processHandle` builds shares, or a source a handle holds of its own.
 */
export interface SignalSource {
  /** The stdin of the terminal this source's process is attached to, or `undefined` for none. */
  readonly terminal: Readable | undefined;
  on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  /** Delivers the signal to this source's process. */
  raise(signal: ProcessSignal): void;
}
/**
 * The terminal facts of a process handle's streams. Output `columns` and `rows` may be getters,
 * which core reads live. A stated `background` settles the run's background, with no query.
 */
export interface ProcessTerminal {
  readonly stdin: InputTerminal;
  readonly stdout: OutputTerminal;
  readonly stderr: OutputTerminal;
  readonly background?: Background | undefined;
}
/**
 * Where one child program runs and what it reads and writes. `cwd` and `env` default to the run's;
 * a relative `cwd` resolves against the run's, and a supplied `env` is the child's whole
 * environment. An attached child takes `input`, its whole stdin, or `stdin: 'inherit'`, the run's
 * own, never both; each of `stdout` and `stderr` is captured when omitted. A detached child starts
 * in a process group of its own with every stream ignored, and nothing in the run ends it.
 */
export type SpawnOptions = {
  /** The run's `cwd` when omitted; a relative path resolves against it. */
  readonly cwd?: string;
  /** The run's `env` when omitted, replaced whole when given. */
  readonly env?: Readonly<Record<string, string | undefined>>;
} & (
  | ({
      readonly detached?: false;
      /** `capture` when omitted. */
      readonly stdout?: 'capture' | 'ignore' | 'inherit' | Writable;
      /** `capture` when omitted. */
      readonly stderr?: 'capture' | 'ignore' | 'inherit' | Writable;
      /** An abort ends the child with `SIGTERM`. */
      readonly signal?: AbortSignal;
    } & (
      | {
          /** Written to the child's stdin, which then ends; an empty stdin when omitted. */
          readonly input?: string | Uint8Array;
          readonly stdin?: never;
        }
      | {
          /** The run's own stdin. */
          readonly stdin: 'inherit';
          readonly input?: never;
        }
    ))
  | { readonly detached: true }
);
/** What a child wrote to one captured stream: empty for a stream that was not captured. */
export interface ChildOutput {
  readonly bytes: Uint8Array;
  /** The bytes decoded as UTF-8. */
  readonly text: string;
}
/**
 * How a child ended: its exit code, 128 plus the signal's number for a child a signal ended, and
 * its captured output; or that it never started, because no program answered to the command or
 * the runtime refused it, with the runtime's error.
 */
export type ChildExit =
  | {
      readonly kind: 'exited';
      readonly code: number;
      readonly stdout: ChildOutput;
      readonly stderr: ChildOutput;
    }
  | { readonly kind: 'unstarted'; readonly error: Error };
/** A child program a run started. */
export interface Child {
  /** Resolves once the child has ended and its streams have closed; it never rejects. */
  readonly exited: Promise<ChildExit>;
  /**
   * Delivers a signal to the child, `SIGTERM` when omitted, or `SIGKILL`, which the child cannot
   * handle; does nothing once it has exited.
   */
  kill(signal?: ProcessSignal | 'SIGKILL'): void;
}
/**
 * Every process fact a run reads and every process effect it makes. A run binds one at entry and
 * never replaces it, and core copies its facts into the run's host.
 */
export interface ProcessHandle {
  readonly argv: readonly string[];
  readonly program: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The working directory, which throws when it cannot be read. */
  cwd(): string;
  /** The operator's home folder. */
  readonly home: string;
  /** The folder for temporary files. */
  readonly tmpdir: string;
  readonly platform: string;
  readonly arch: string;
  readonly libc: 'glibc' | 'musl' | undefined;
  readonly uid: number | undefined;
  readonly timeZone: string;
  readonly release: ReleaseFacts;
  readonly readSource?: (path: string, cwd: string) => string | undefined;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly terminal: ProcessTerminal;
  readonly signals: SignalSource;
  /**
   * Starts one child program. Core fills `cwd` and `env` from the run before it calls the handle,
   * and passes `inherit` only for a stream that is the handle's own.
   */
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions & {
      readonly cwd: string;
      readonly env: Readonly<Record<string, string | undefined>>;
    },
  ): Child;
  /** The one member core writes: `run()` writes the run's code once it is final. */
  exitCode: ExitCode | undefined;
  /** Receives each variable an argv run's environment preparation copies out. */
  readonly publishEnv?: (name: string, value: string) => void;
}
/**
 * The fields `processHandle` takes, each replacing its whole field. An absolute `cwd` string never
 * throws; a relative one resolves against the process's working directory at each read, so it
 * throws when that directory cannot be read; and a `cwd` function throws as it chooses.
 */
export type ProcessFields = Partial<
  Omit<ProcessHandle, 'cwd' | 'exitCode' | 'publishEnv' | 'signals' | 'spawn'>
> & {
  readonly cwd?: string | (() => string);
};
/**
 * How the running application was built, released, and installed. The build bakes the build and
 * release facts into the artifact, core reads the installation from the installation record, and
 * core fills `host.release` from them for every run; a run of the source, with nothing baked in,
 * reads `{ build: 'source' }`.
 */
export interface ReleaseFacts {
  /** `source` and `development` are development builds, and `distributed` is a distributed one. */
  readonly build: 'source' | 'development' | 'distributed';
  /** Present only when the artifact was built as a release. */
  readonly release?: {
    readonly version: string;
    /** The first prerelease identifier of `version`, or `stable` when it has none. */
    readonly channel: string;
    /** The repository the release belongs to, as `owner/name`. */
    readonly repository: string;
    /** The release asset's name, present for a compiled binary alone. */
    readonly asset?: string;
  };
  /**
   * How the application was installed, read from the installation record's `install.json` for a
   * compiled binary built as a release, and present only when its path is the running executable.
   */
  readonly installation?: {
    readonly method: string;
    readonly path: string;
    readonly digest: string;
  };
}
export interface Host {
  platform: string;
  /** The process's CPU architecture, such as `x64` or `arm64`. */
  arch: string;
  /**
   * `glibc` or `musl` on Linux, and `undefined` elsewhere. Core copies it from the handle on the
   * run's first read, because the real process's answer comes from a costly runtime report.
   */
  readonly libc: 'glibc' | 'musl' | undefined;
  /** The process's user ID, or `undefined` on a runtime with none. */
  uid: number | undefined;
  argv: string[];
  /**
   * The runtime and script prefix `argv` omits: the words that start this application again, so
   * `[...program, ...argv]` reruns it. A compiled binary reads its own path alone, and any other
   * run reads the runtime's path and the absolute path of the script it ran. Frozen; a supplied
   * `program` replaces the whole list, and an action's `invoke` keeps its run's.
   */
  program: readonly string[];
  cwd: string;
  /**
   * The operator's home folder, copied from the handle at entry: its absolute `HOME` unless a
   * `home` was supplied. Environment preparation never moves it.
   */
  home: string;
  /**
   * The folder for temporary files, copied from the handle at entry: its absolute `TMPDIR`, else
   * `/tmp`, unless a `tmpdir` was supplied. It names a folder and creates nothing.
   */
  tmpdir: string;
  /**
   * The operator's IANA time zone, such as `America/New_York`, which a validator reads to place a
   * local time. The real process's handle reads the zone `Intl` resolves, which honours `TZ`; a
   * supplied `timeZone` replaces it, and an action's `invoke` keeps its run's.
   */
  timeZone: string;
  env: Record<string, string | undefined>;
  terminal: HostTerminal;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  /**
   * Reads one source file for a defect's Developer Diagnostic, or answers `undefined`. Core calls
   * it only in a development build, only while it reports a defect, and only for a path under the
   * working directory. The real process's handle supplies a reader that refuses a file outside
   * `cwd` after resolving symbolic links, and answers `undefined` for a path that is not a regular
   * file or that exceeds 1 MiB.
   */
  readSource?: (path: string, cwd: string) => string | undefined;
  /**
   * The release facts the build baked in, or `{ build: 'source' }` when it baked none, frozen when
   * core read them. A supplied `release` is taken as given, neither validated nor frozen.
   */
  release: ReleaseFacts;
  /**
   * Raises the signal a key read in raw mode stands for on the run's signal source and answers
   * `true` when `stdin` is that source's own terminal; otherwise it raises nothing and answers
   * `false`, and the reader cancels the run itself.
   */
  raise: (signal: 'SIGINT' | 'SIGQUIT' | 'SIGTSTP') => boolean;
  /**
   * Starts a child program through the run's process handle, with no shell, in the run's `cwd` and
   * with its `env` unless the options name others. It returns the child at once.
   */
  spawn: (command: string, args: readonly string[], options?: SpawnOptions) => Child;
}
export interface RunOptions {
  rendering?: RenderingPolicy;
  /** The process the run reads its facts from and makes its effects on: `processHandle()` when omitted. */
  process?: ProcessHandle;
  /**
   * A caller-owned signal that cancels the run. Core subscribes to it at run entry and honors an
   * abort at every phase boundary; a shutdown aborts the run as well, and the first cause decides.
   */
  signal?: AbortSignal;
}

/** The declaration one schema call validates, under the name and the scope it was declared in. */
export interface InputIdentity {
  kind: 'argument' | 'option' | 'stdin';
  name: string;
  global: boolean;
}

/**
 * The raw tokens of one invocation, keyed by declared name, before any schema or default runs.
 * Each schema call reads its own snapshot, so a collected value is read-only and writing to one
 * changes nothing the parser, a later schema, or the action reads.
 */
export interface SuppliedInputs {
  /** Raw positional values of the routed Command: one string, or the tokens of a variadic. */
  args: Readonly<Record<string, string | readonly string[] | undefined>>;
  /**
   * Raw option values, globals and locals: a string, every occurrence, a Boolean presence, or the
   * number of times a counted option was supplied.
   */
  options: Readonly<Record<string, string | readonly string[] | boolean | number | undefined>>;
}

/**
 * What core knows when it calls one schema. A default validates before any token is read, so its
 * phase carries the host and the declaration alone. An invocation call adds the routed path, the
 * passthrough tail, and the tokens every declared input received. A question carries the same run
 * facts and identifies its link, or its own title when unlinked.
 */
export type ValidationContext =
  | { phase: 'default'; host: Host; input: InputIdentity }
  | {
      phase: 'invocation';
      host: Host;
      input: InputIdentity;
      command: readonly string[];
      passthrough: readonly string[];
      supplied: SuppliedInputs;
    }
  | {
      phase: 'question';
      host: Host;
      input: InputIdentity | { kind: 'question'; name: string; global: false };
      command: readonly string[];
      passthrough: readonly string[];
      supplied: SuppliedInputs;
    };
/** Immutable authoring and measurement context for one view destination. */
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
/** A pure synchronous view turns one typed value into the marked text core resolves. */
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
/** The views record of a value result: every entry renders the whole value. */
export type ResultViews<Value> = Readonly<Record<string, View<Value>>>;
/**
 * The views record of a rows result: a whole view over the collected rows, which core buffers the
 * sequence for, or a row view, which core feeds as the rows arrive.
 */
export type RowViews<Row> = Readonly<Record<string, View<readonly Row[]> | RowView<Row>>>;

/**
 * One view a result names, with its data type erased, as the view registry erases a declared
 * view's. The write site reads each function back through the key that resolved it.
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

/** Phantom key. It brands the surface a lifecycle hook receives, so a forged value is not one. */
export declare const attachedCommand: unique symbol;

/**
 * One Command as `onCommandAttach` receives it: the facts `inspect()` publishes, with their types
 * erased, and the authoring calls a hook may make. Each call returns a new value whose facts hold
 * what the call added, so a hook reads its own earlier calls back. The calls a hook cannot make are
 * absent, because each of them changes what the action was compiled against or the graph's shape.
 */
export interface AttachedCommand {
  readonly [attachedCommand]: true;
  /** The Command's own name, and `null` for the root. */
  readonly name: string | null;
  readonly path: readonly string[];
  readonly hasAction: boolean;
  /** The declared argument names, in declaration order. */
  readonly arguments: readonly string[];
  /** The declared local option names, in declaration order. */
  readonly options: readonly string[];
  readonly result: ResultNode | null;
  /**
   * The extension record `inspect()` would publish for this Command at this hook: the author's
   * layers, then every value an earlier hook or this hook's earlier `extend()` calls added.
   */
  readonly extensions: Readonly<Record<string, unknown>>;
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  option(name: string, config: OptionConfig & Unmarked): AttachedCommand;
  exclusive(...names: [string, string, ...string[]]): AttachedCommand;
  oneRequired(...names: [string, string, ...string[]]): AttachedCommand;
  requiredTogether(...names: [string, string, ...string[]]): AttachedCommand;
  views<const Replacements extends Readonly<Record<string, ResultView>>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
  ): AttachedCommand;
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}

/**
 * The lifecycle hook core calls once per Command at graph build, in installation order, each
 * receiving what the previous plugin's hook returned.
 */
export type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

/**
 * The lifecycle hook core calls once per graph build, after every `onCommandAttach` hook, with the
 * frozen graph. It judges the graph and never contributes: it returns nothing, and it rejects the
 * graph by throwing a `DeclarationError`.
 */
export type GraphBuiltHook = (graph: CommandGraph) => undefined;

/**
 * What `out.results` accepts for one declared result. The declaration rides in the declared types
 * as a closed discriminant, so a Command that declares none carries the neutral `unknown` and its
 * `out.results` takes `never`. The parameter is never a union, so distribution reaches one member.
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
 */
export type RenderedData<Data, Row> = Data &
  ([Row] extends [never] ? unknown : Iterable<NoInfer<Row>> | AsyncIterable<NoInfer<Row>>);

/**
 * The row view over the rows `Data` yields, which types a pack view's factory from the data. The
 * check is not distributive, so data that may be `undefined` or a single row has no such view.
 */
export type RowViewOver<Data> = [Data] extends [Iterable<infer Row> | AsyncIterable<infer Row>]
  ? RowView<Row>
  : never;

export interface Out<Result = unknown> {
  print(message: string): Promise<void>;
  info(message: string): Promise<void>;
  success(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
  /** A debug line on stderr, written from verbosity 1, as an operator's `-v` asks. */
  debug(message: string): Promise<void>;
  /** A trace line on stderr, finer than a debug line, written from verbosity 2, as an operator's `-vv` asks. */
  trace(message: string): Promise<void>;
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
   * Opens a live region at the bottom of stderr and returns its handle at once. Core keeps every
   * open region below every other write, in open order, and closes one left open when what opened
   * it finishes.
   */
  region(options?: RegionOptions): Region;
  /**
   * The Command's own result, emitted once. Property syntax keeps the parameter contravariant, so
   * a neutral `Out` never stands in for one that carries a declaration.
   */
  results: (value: ResultInput<Result>) => Promise<void>;
  fatal(message: string): never;
}

/** How `out.region()` opens a region. */
export interface RegionOptions {
  /** The region reads the operator's keys, as a question does. */
  readonly input?: boolean;
}

/** What closed a region: its own `end()`, its opener finishing, a failure, or cancellation. */
export type RegionCloser = 'end' | 'completion' | 'failure' | 'cancellation';

/** One report of a region's progress; an omitted field keeps its last reported value. */
export interface ProgressReport {
  readonly completed?: number;
  readonly total?: number;
  readonly label?: string;
}

/** The handle `out.region()` returns. */
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

/** The typed value a region's report builds, which a program reads without reading a frame. */
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

/**
 * The routed Command's invocation after parsing and validation, which every middleware reads. The
 * values are what the action receives, the output of each declaration's schema, for that Command's
 * own arguments and local options; global option values are not here. The records are
 * untyped and frozen, because a middleware runs ahead of every action and the graph carries no
 * type for a value.
 */
export interface Request {
  readonly stdin?: Content | undefined;
  readonly args: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly passthrough: readonly string[];
}

/** The channel one action receives, with the emission the results lane holds it to. */
export interface ActionChannel {
  out: Out<OpenResult>;
  /** Whether the action emitted its result, which the missing rule reads after it returned. */
  emitted: () => boolean;
  /**
   * Stops every sequence this channel still has pending. The action's own failure stays primary,
   * so a sequence it never awaited is stopped rather than drained.
   */
  stop: () => void;
  /** Closes every region the action opened that is still open, because the action returned. */
  complete: () => void;
  /** Closes every region the action opened that is still open, because the action threw. */
  fail: () => void;
}
export type StringOption = UnmarkedStringOption | BackgroundOption;
/** A string option that carries no run-wide mark. */
export type UnmarkedStringOption = OptionSpelling &
  (
    | (Presence & Multiplicity & Omission)
    | {
        required: 'non-interactive';
        default?: never;
        multiple?: false;
        validateOmitted?: never;
        env?: string | readonly [string, ...string[]];
      }
  ) &
  Described &
  Listed &
  Controlled &
  OptionExtensions &
  Unmarked & {
    type: 'string';
    polarity?: never;
    validate?: StandardSchemaV1;
    /** The value a bare spelling supplies, so an explicit value is attached to the spelling. */
    implied?: string;
  };
/**
 * The string global option that carries the background mark, whose value the run reads from argv
 * beside the color choice. argv is its one source, so it declares no short alias, variable,
 * default, implied value, or list.
 */
export type BackgroundOption = Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'string';
    background: true;
    aliases?: readonly string[];
    validate?: StandardSchemaV1;
    short?: never;
    shortOnly?: never;
    env?: never;
    default?: never;
    implied?: never;
    multiple?: false;
    required?: never;
    validateOmitted?: never;
    polarity?: never;
    interaction?: never;
    color?: never;
    verbose?: never;
    quiet?: never;
  };
/** A variadic argument collects the remaining tokens, so it follows the multiple option rules. */
export type VariadicArgument = Presence &
  Described &
  ArgumentExtensions & { type?: 'string'; variadic: true; validate?: StandardSchemaV1 };
export type ScalarArgument = Presence &
  Omission &
  Described &
  ArgumentExtensions & { type?: 'string'; variadic?: false; validate?: StandardSchemaV1 };
export type ContentArgument = ContentInput &
  Described &
  ArgumentExtensions &
  ({ variadic: true; min?: number; max?: number } | { variadic?: false; min?: never; max?: never });
export type ContentOption = ContentInput &
  OptionSpelling &
  Described &
  Listed &
  Controlled &
  OptionExtensions &
  Unmarked & {
    polarity?: never;
    implied?: never;
  } & (
    | { multiple: true; env?: never; min?: number; max?: number }
    | ({ multiple?: false; min?: never; max?: never } & EnvBinding)
  );
export interface StdinConfig {
  description?: string;
  required?: boolean;
}
export type ArgumentConfig = VariadicArgument | ScalarArgument | ContentArgument;
export type ValidatedValue<Config, Raw> = Config extends { type: 'content' }
  ? PerValue<Config, Content>
  : Config extends unknown
    ? 'validate' extends keyof Config
      ? SchemaOutput<Config, Config['validate'], Raw>
      : Raw
    : never;
/**
 * Each member of a conditional declaration checks its default against its own validator input
 * type. Only a config with a failing member is paired, because the pairing intersects a union
 * config with a copy of itself, which multiplies it by its own members: a config whose type
 * parameters are erased to the wide `OptionConfig` declares no default and is never paired.
 */
export type DefaultConstraint<Config> = [DefaultFault<Config>] extends [never]
  ? unknown
  : PairedDefault<Config>;

/**
 * An argument's config names only the keys `ArgumentConfig` declares, because core reads no other.
 * TypeScript runs no excess-key check on a config a type parameter infers, so this constraint
 * rejects each other key. The key names the fault, the way the other declaration constraints do,
 * because an intersection with `never` properties would reduce the whole config and report every
 * key.
 */
export type ArgumentKeyConstraint<Config> = [
  Exclude<KeysOf<Config>, KeysOf<ArgumentConfig>>,
] extends [never]
  ? unknown
  : {
      [
        Key in Exclude<
          KeysOf<Config>,
          KeysOf<ArgumentConfig>
        > as `An argument declares no ${Key & string} key`
      ]: never;
    };

/**
 * An implied value is the string an operator would otherwise attach, so it must be a string the
 * validator's input type accepts, as a default must be. A multiple option's validator reads one
 * value, so the implied value meets that one value's input type. A validator that declares no types
 * infers `never`, so it states nothing to check against. The key names the fault, the way the
 * other declaration constraints do, because an intersection with the literal would reduce the whole
 * config to `never` and report every key.
 */
export type ImpliedConstraint<Config> = Config extends { implied: infer Implied }
  ? 'validate' extends keyof Config
    ? [SchemaInput<Config['validate']>] extends [never]
      ? unknown
      : Implied extends SchemaInput<Config['validate']>
        ? unknown
        : { 'An implied value must be in the validator input type': Config['validate'] }
    : unknown
  : unknown;

/**
 * A multiple option or a variadic argument passes each value to its validator alone, so the
 * declared validator must accept one `string`. The key names the fault, the way the other
 * declaration constraints do.
 */
export type PerValueConstraint<Config> = Config extends { multiple: true } | { variadic: true }
  ? 'validate' extends keyof Config
    ? // A validator that declares no types infers `never`, so it states nothing to reject.
      [SchemaInput<Config['validate']>] extends [never]
      ? unknown
      : string extends SchemaInput<Config['validate']>
        ? unknown
        : { 'A validator of several values must accept one string input': Config['validate'] }
    : unknown
  : unknown;
/**
 * The declaration rules `validateOmitted: true` needs: a schema that accepts `undefined`, an
 * omission the schema can answer, and no other rule that already decides absence. Each key names
 * its fault, the way the other declaration constraints do.
 */
export type ValidateOmittedConstraint<Config> = Config extends { validateOmitted: true }
  ? Config extends { type: 'boolean' }
    ? { 'A Boolean option declares no validateOmitted': never }
    : Config extends { required: true }
      ? { 'A required input rejects validateOmitted': never }
      : Config extends { default: unknown }
        ? { 'A declared default rejects validateOmitted': never }
        : Config extends { multiple: true } | { variadic: true }
          ? { 'An input of several values receives no values as an empty array': never }
          : 'validate' extends keyof Config
            ? undefined extends SchemaInput<Config['validate']>
              ? unknown
              : { 'A validateOmitted validator must accept an undefined input': Config['validate'] }
            : { 'validateOmitted needs a validator to receive the omission': never }
  : unknown;
/**
 * A global option declares no presence rule, so its omission is always plain absence. A union
 * config fails when any member declares the key, and a wide `OptionConfig` passes, because its
 * members only allow the key. `required` is named first when a config declares both.
 */
export type GlobalOmissionConstraint<Config> = [Extract<Config, { type: 'content' }>] extends [
  never,
]
  ? [DeclaredPresenceRule<Config>] extends [never]
    ? unknown
    : PresenceRuleFaults['required' extends DeclaredPresenceRule<Config>
        ? 'required'
        : 'validateOmitted']
  : { 'A content input is local to its Command': never };
export type ArgumentValue<Config extends ArgumentConfig> = Config extends { variadic: true }
  ? ValidatedValue<Config, string[]>
  :
      | ValidatedValue<Config, string>
      | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
          ? never
          : undefined);
/**
 * A Boolean option: one polarity with any spelling, both polarities with long forms, or the color
 * mark, which the run reads from argv before short groups and binds no variable, so it declares
 * no short alias and no `env`.
 */
export type BooleanOption =
  | (OptionSpelling &
      BooleanFacts &
      EnvBinding & {
        color?: never;
        polarity?: 'positive' | 'negative';
      })
  | (BooleanFacts &
      EnvBinding & {
        color?: never;
        polarity: 'both';
        short?: ShortAlias;
        shortOnly?: false;
        aliases?: readonly string[];
      })
  | (BooleanFacts & {
      color: true;
      polarity?: 'positive' | 'negative' | 'both';
      short?: never;
      shortOnly?: never;
      aliases?: readonly string[];
      env?: never;
    });
/**
 * A counted option takes no value and reads how many times it was supplied, across every spelling,
 * so it declares no validator, default, presence rule, collection, polarity, or implied value. It
 * may carry the verbose mark or the quiet mark, never both, and a marked option binds no variable,
 * because the run settles its verbosity before it reads the environment.
 */
export type CountOption = OptionSpelling &
  Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'count';
    interaction?: never;
    color?: never;
    background?: never;
    validate?: never;
    default?: never;
    multiple?: never;
    required?: never;
    validateOmitted?: never;
    polarity?: never;
    implied?: never;
  } & (
    | ({ verbose?: never; quiet?: never } & EnvBinding)
    | { verbose: true; quiet?: never; env?: never }
    | { quiet: true; verbose?: never; env?: never }
  );
export type OptionConfig = StringOption | BooleanOption | CountOption | ContentOption;
/**
 * The configuration of a global option a plugin declares: everything `option()` takes except the
 * presence rules, which a global option never declares, because its validation runs on every
 * Command. `globalOption()` states the same rule through `GlobalOmissionConstraint`, which also
 * accepts a config typed as the wide `OptionConfig`.
 */
export type GlobalOptionConfig = Exclude<OptionConfig, ContentOption> &
  Readonly<Partial<Record<PresenceRuleKey, never>>>;
export type OptionValue<Config extends OptionConfig> = Config extends StringOption | ContentOption
  ? Config extends { multiple: true }
    ? ValidatedValue<Config, string[]>
    :
        | ValidatedValue<Config, string>
        | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
            ? never
            : undefined)
  : Config extends CountOption
    ? number
    : boolean;

/**
 * The values an invocation by name supplies, mirroring the action context: `args` keyed by argument
 * name, `options` by the declared name of a local or global option, and the passthrough tail. Each
 * value lowers to the tokens argv would give: a string or a number is one token, a Boolean a
 * spelling or its absence, a number on a counted option that many occurrences, and an array one
 * occurrence per element.
 */
export interface InvocationValues {
  readonly args?: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[] | undefined>
  >;
  readonly options?: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[] | undefined>
  >;
  readonly passthrough?: readonly string[];
}

/**
 * How one invocation by name runs: the starting view selection, the handler that maps a failure
 * into the outcome, a signal that cancels the call, and the observer of its progress events.
 */
export interface InvokeOptions<Mapped = LoomError> {
  /** The starting view selection, as a middleware's `view` assignment. */
  readonly view?: string;
  readonly failure?: (
    failure: Readonly<LoomError>,
    context: {
      readonly application: string;
      readonly path: readonly string[];
      readonly exitCode: FailureExitCode;
      /** The failure's form, the same object the failed outcome carries. */
      readonly form: FailureForm;
    },
  ) => Mapped;
  /** Composed with the parent run's signal when an action calls `invoke`. */
  readonly signal?: AbortSignal;
  /**
   * Receives each progress event of the call's run, in order, inside the report or the region close
   * that built it. A throw stops it, and `invoke` rejects with that throw once the run settles.
   */
  readonly onProgress?: (event: ProgressEvent) => void;
  /**
   * Options the call leaves out of its run, by declared name: no tier supplies one, so a key of
   * `options` that names one is an unknown option and the input-source stage reads nothing for it.
   * A name the routed Command's table does not hold is an unknown option too.
   */
  readonly exclude?: readonly string[];
}

/**
 * What one invocation by name resolved: a run that would resolve 0, one that would resolve a failure
 * code, with what the run wrote, or a cancelled one, whose captured text is discarded.
 */
export type InvocationOutcome<Mapped = LoomError> =
  | { readonly status: 'completed'; readonly output: string; readonly messages: string }
  | {
      readonly status: 'failed';
      readonly failure: Mapped;
      /** The form of the failure the handler received. */
      readonly form: FailureForm;
      readonly exitCode: FailureExitCode;
      readonly output: string;
      readonly messages: string;
    }
  | { readonly status: 'cancelled'; readonly exitCode: 129 | 130 | 131 | 141 | 143 };

/**
 * What an action receives. `graph` is the frozen graph `inspect()` returns for this run, and
 * `command` is the routed node inside it: the same two values the run's middleware receive.
 * `invoke` runs another Command of that graph by name.
 */
export interface ActionContext<Args, Options = {}, Result = unknown, Provided = {}> {
  readonly interactive: boolean;
  readonly supplied: SuppliedInputs;
  readonly cancel: () => void;
  readonly stdin?: Content | undefined;
  readonly style: ContextualStyle;
  args: Args;
  options: Options;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  passthrough: string[];
  out: Out<Result>;
  host: Host;
  /** Records a log event for every installed plugin's `onLog` hook, under no plugin. */
  readonly log: Log;
  /** The run's cancellation signal, which a caller, a shutdown, the action, or a closed pipe aborts. */
  signal: AbortSignal;
  /**
   * Registers a synchronous handler that runs once, at the end of a shutdown or of the process, and
   * is removed when the run ends while no shutdown is under way. Answers the call that removes it.
   */
  readonly onShutdown: OnShutdown;
  /** Registers a synchronous handler that runs when Ctrl-Z suspends the process, until the run ends. */
  readonly onSuspend: OnSuspend;
  /** Registers a synchronous handler that runs when the process resumes, until the run ends. */
  readonly onResume: OnResume;
  /** The value of each provider the Command's `uses` lists, under its provider's name. */
  readonly provided: Provided;
  /** Runs another Command of the graph this run built, by name, and captures what it writes. */
  readonly invoke: <Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped>,
  ) => Promise<InvocationOutcome<Mapped>>;
}
export type Action<
  Args,
  Options = {},
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> = (context: Omit<ActionContext<Args, Options, Result, Provided>, 'stdin'> & Stdin) => unknown;

/** Phantom key. It keeps the inferred declaration types exact and holds no runtime value. */
export declare const declaredTypes: unique symbol;

/**
 * Arguments and local options describe the action's own inputs. Globals are a requirement on the
 * Receiving Application: a library that needs none can attach wherever its local keys are disjoint.
 */
export interface DeclaredTypes<
  Args,
  Options,
  Globals,
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> {
  stdin: Stdin;
  args: Args;
  globals: (value: Globals) => void;
  options: Options;
  /** The values the Command's opt-ins provide. A plain field keeps it covariant, as `result` is. */
  provided: Provided;
  /**
   * The result the Command declares, or `unknown` where it declares none. A plain field keeps it
   * covariant, so a child that carries one still satisfies a neutral `Command` annotation.
   */
  result: Result;
}

/**
 * The handler one declaration accepts. It reads the phantom types, not the `action()` call, so it
 * holds on a fresh declaration, on a partly declared one, and on one that registered its action.
 */
export type ActionHandler<Declaration> = Declaration extends {
  [declaredTypes]: DeclaredTypes<
    infer Args,
    infer Options,
    infer Globals,
    infer Result,
    infer Stdin,
    infer Provided
  >;
}
  ? Action<Args, Globals & Options, Result, Stdin, Provided>
  : never;
/** The args object an extracted handler receives for this declaration. */
export type ActionArgs<Declaration> =
  ActionArgument<Declaration> extends { args: infer Args } ? Args : never;
/** The options object an extracted handler receives, global values included. */
export type ActionOptions<Declaration> =
  ActionArgument<Declaration> extends { options: infer Options } ? Options : never;

export type { StdinContext, Unmarked };
