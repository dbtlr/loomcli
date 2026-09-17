/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { ExtensionValue } from './extension.js';
import type { ResultNode } from './inspect.js';
import type { RenderingPolicy } from './rendering.js';
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
type OptionSpelling =
  | { short?: ShortAlias; shortOnly?: false }
  | { short: ShortAlias; shortOnly: true };

type Presence = { required: true; default?: never } | { required?: false; default?: unknown };
/** The literal member keeps `multiple: true` exact under contextual typing, as `Presence` does. */
type Multiplicity = { multiple: true } | { multiple?: false };
/**
 * `validateOmitted: true` sends an omitted optional scalar to its own schema. The literal member
 * keeps the flag exact under contextual typing, as `Multiplicity` does.
 */
type Omission = { validateOmitted: true } | { validateOmitted?: false };
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
/** The extension values one option declaration carries, whatever scope declares the option. */
interface OptionExtensions {
  extensions?: readonly ExtensionValue<'option'>[];
}
/** The same slot on an argument declaration, typed by the target its values must name. */
interface ArgumentExtensions {
  extensions?: readonly ExtensionValue<'argument'>[];
}
/**
 * The tokens one declaration collects before validation: one string, or the whole collection. A
 * multiple option and a variadic argument collect alike, so they share this raw shape.
 */
type RawValue<Config> = Config extends { multiple: true } | { variadic: true } ? string[] : string;
type SchemaOutput<Schema, Raw> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Schema>
  : Raw;
type SchemaInput<Schema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<Schema>
  : string;

/** The named key states the rule, so a rejected declaration name reads as its own diagnostic. */
interface LiteralNameFault {
  'Declaration names must be one literal string': never;
}

type ActionArgument<Declaration> =
  ActionHandler<Declaration> extends (context: infer Context) => unknown ? Context : never;

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

export type ExitCode = 0 | 1 | 2 | 130 | 143;
export interface InputTerminal {
  isTTY: boolean;
}
export interface OutputTerminal extends InputTerminal {
  columns: number | undefined;
  rows: number | undefined;
}
export interface Host {
  platform: string;
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  terminal: { stdin: InputTerminal; stdout: OutputTerminal; stderr: OutputTerminal };
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}
export interface RunOptions {
  rendering?: RenderingPolicy;
  host?: Partial<Host>;
  /**
   * A caller-owned signal that cancels the run. Core subscribes to it at run entry and honors an
   * abort at every phase boundary; it composes with an installed signals owner.
   */
  signal?: AbortSignal;
}

/** The declaration one schema call validates, under the name and the scope it was declared in. */
export interface InputIdentity {
  kind: 'argument' | 'option';
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
  /** Raw option values, globals and locals: a string, every occurrence, or a Boolean presence. */
  options: Readonly<Record<string, string | readonly string[] | boolean | undefined>>;
}

/**
 * What core knows when it calls one schema. A default validates before any token is read, so its
 * phase carries the host and the declaration alone. An invocation call adds the routed path, the
 * passthrough tail, and the tokens every declared input received.
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
    };
/** Immutable authoring and measurement context for one view destination. */
export interface ViewContext {
  readonly style: ContextualStyle;
  readonly width: (text: string) => number;
}
/** A pure synchronous view turns one typed value into the marked text core resolves. */
export interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  /** A view has one shape; the row view of Results is the other. */
  row?: never;
}
/**
 * A row view renders a sequence one row at a time.
 * `head` and `tail` open and close the sequence, and each defaults to the empty string.
 * Every function is pure and synchronous and owns the newlines in the text it returns.
 */
export interface RowView<Row> {
  row: (row: Readonly<Row>, index: number, context: ViewContext) => string;
  head?: (context: ViewContext) => string;
  tail?: (context: ViewContext) => string;
  /** A row view has one shape; the whole view of Rendered output is the other. */
  render?: never;
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
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  option(name: string, config: OptionConfig): AttachedCommand;
  views(
    replacements: Readonly<Record<string, ResultView>>,
    options?: { default?: string },
  ): AttachedCommand;
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}

/**
 * The lifecycle hook core calls once per Command at graph build, in installation order, each
 * receiving what the previous plugin's hook returned.
 */
export type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

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

export interface Out<Result = unknown> {
  print(message: string): Promise<void>;
  info(message: string): Promise<void>;
  success(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
  /** The neutral view call: a rendered value has no purpose and no destination. */
  render<Data>(data: Data, view: View<Data>): Promise<void>;
  /** The same call over a sequence: core writes each row's text as the source yields it. */
  render<Row>(rows: Iterable<Row> | AsyncIterable<Row>, view: RowView<Row>): Promise<void>;
  /**
   * The Command's own result, emitted once. Property syntax keeps the parameter contravariant, so
   * a neutral `Out` never stands in for one that carries a declaration.
   */
  results: (value: ResultInput<Result>) => Promise<void>;
  fatal(message: string): never;
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
 * own arguments and local options; global and plugin option values are not here. The records are
 * untyped and frozen, because a middleware runs ahead of every action and the graph carries no
 * type for a value.
 */
export interface Request {
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
}
export type StringOption = OptionSpelling &
  Presence &
  Multiplicity &
  Omission &
  Described &
  Listed &
  OptionExtensions & { type: 'string'; polarity?: never; validate?: StandardSchemaV1 };
/** A variadic argument collects the remaining tokens, so it follows the multiple option rules. */
export type VariadicArgument = Presence &
  Described &
  ArgumentExtensions & { variadic: true; validate?: StandardSchemaV1 };
export type ScalarArgument = Presence &
  Omission &
  Described &
  ArgumentExtensions & { variadic?: false; validate?: StandardSchemaV1 };
export type ArgumentConfig = VariadicArgument | ScalarArgument;
export type ValidatedValue<Config, Raw> = Config extends unknown
  ? 'validate' extends keyof Config
    ? SchemaOutput<Config['validate'], Raw>
    : Raw
  : never;
/** Keep each conditional declaration paired with its own schema input type. */
export type DefaultConstraint<Config> = Config extends unknown
  ? Config & {
      default?: 'validate' extends keyof Config
        ? SchemaInput<Config['validate']>
        : RawValue<Config>;
    }
  : never;

/**
 * A multiple option hands its whole collection to one schema, so the declared schema must accept a
 * `string[]` input. The key names the fault, the way the other declaration constraints do.
 */
export type MultipleConstraint<Config> = Config extends { multiple: true }
  ? 'validate' extends keyof Config
    ? string[] extends SchemaInput<Config['validate']>
      ? unknown
      : { 'A multiple option schema must accept a string[] input': Config['validate'] }
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
          ? { 'A collected input validates its omission as an empty array': never }
          : 'validate' extends keyof Config
            ? undefined extends SchemaInput<Config['validate']>
              ? unknown
              : { 'A validateOmitted schema must accept an undefined input': Config['validate'] }
            : { 'validateOmitted needs a validate schema to receive the omission': never }
  : unknown;
export type ArgumentValue<Config extends ArgumentConfig> = Config extends { variadic: true }
  ? ValidatedValue<Config, string[]>
  :
      | ValidatedValue<Config, string>
      | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
          ? never
          : undefined);
export type BooleanOption =
  | (OptionSpelling &
      Described &
      Listed &
      OptionExtensions & {
        type: 'boolean';
        validate?: never;
        default?: never;
        multiple?: never;
        required?: never;
        validateOmitted?: never;
        polarity?: 'positive' | 'negative';
      })
  | (Described &
      Listed &
      OptionExtensions & {
        type: 'boolean';
        validate?: never;
        default?: never;
        multiple?: never;
        required?: never;
        validateOmitted?: never;
        polarity: 'both';
        short?: ShortAlias;
        shortOnly?: false;
      });
export type OptionConfig = StringOption | BooleanOption;
/**
 * The parsing part of a string option config, which is all a plugin option declares. A plugin
 * option carries no schema and no presence rule, because the pre-scan consumes it ahead of routing,
 * where the validation context every schema is promised cannot exist. Its middleware interprets
 * the value.
 * A Boolean plugin option is an ordinary `BooleanOption`, which already declares none of them.
 */
export type PluginStringOption = OptionSpelling &
  Multiplicity &
  Described &
  Listed &
  OptionExtensions & {
    type: 'string';
    default?: string | string[];
    polarity?: never;
    required?: never;
    validate?: never;
    validateOmitted?: never;
  };
export type PluginOptionConfig = PluginStringOption | BooleanOption;
export type OptionValue<Config extends OptionConfig> = Config extends StringOption
  ? Config extends { multiple: true }
    ? ValidatedValue<Config, string[]>
    :
        | ValidatedValue<Config, string>
        | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
            ? never
            : undefined)
  : boolean;

export interface ActionContext<Args, Options = {}, Result = unknown> {
  readonly style: ContextualStyle;
  args: Args;
  options: Options;
  passthrough: string[];
  out: Out<Result>;
  host: Host;
  /** The run's cancellation signal, which a caller or an installed signals owner aborts. */
  signal: AbortSignal;
}
export type Action<Args, Options = {}, Result = unknown> = (
  context: ActionContext<Args, Options, Result>,
) => unknown;

/** Phantom key. It keeps the inferred declaration types exact and holds no runtime value. */
export declare const declaredTypes: unique symbol;

/**
 * Arguments and local options describe the action's own inputs. Globals are a requirement on the
 * Receiving Application: a library that needs none can attach wherever its local keys are disjoint.
 */
export interface DeclaredTypes<Args, Options, Globals, Result = unknown> {
  args: Args;
  globals: (value: Globals) => void;
  options: Options;
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
  [declaredTypes]: DeclaredTypes<infer Args, infer Options, infer Globals, infer Result>;
}
  ? Action<Args, Globals & Options, Result>
  : never;
/** The args object an extracted handler receives for this declaration. */
export type ActionArgs<Declaration> =
  ActionArgument<Declaration> extends { args: infer Args } ? Args : never;
/** The options object an extracted handler receives, global values included. */
export type ActionOptions<Declaration> =
  ActionArgument<Declaration> extends { options: infer Options } ? Options : never;
