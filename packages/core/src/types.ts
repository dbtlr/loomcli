/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

import type { StandardSchemaV1 } from '@standard-schema/spec';

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
type SchemaOutput<Schema, Raw> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Schema>
  : Raw;
type SchemaInput<Schema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<Schema>
  : string;

type ActionArgument<Declaration> =
  ActionHandler<Declaration> extends (context: infer Context) => unknown ? Context : never;

/** A local option name cannot repeat a key the globals already own. */
export type GlobalNameConstraint<Name extends string, Globals> = Name extends keyof Globals
  ? never
  : unknown;

/** A required record key excludes open strings; distribution rejects each union member. */
export type NameConstraint<Name extends string, Whole extends string = Name> =
  {} extends Record<Name, unknown>
    ? never
    : Name extends Whole
      ? [Whole] extends [Name]
        ? unknown
        : never
      : never;

export type ExitCode = 0 | 1 | 2;
export interface InputTerminal {
  isTTY: boolean;
}
export interface OutputTerminal extends InputTerminal {
  columns: number | undefined;
  rows: number | undefined;
}
export interface Host {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  terminal: { stdin: InputTerminal; stdout: OutputTerminal; stderr: OutputTerminal };
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}
export interface RunOptions {
  host?: Partial<Host>;
}
export interface Out {
  print(message: string): Promise<void>;
  info(message: string): Promise<void>;
  success(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
  fatal(message: string): never;
}
export type StringOption = OptionSpelling &
  Presence & { type: 'string'; polarity?: never; validate?: StandardSchemaV1 };
export interface VariadicArgument {
  variadic: true;
  required: true;
  validate?: StandardSchemaV1;
  default?: never;
}
export interface ScalarArgument {
  variadic?: false;
  required: true;
  validate?: StandardSchemaV1;
  default?: never;
}
export type ArgumentConfig = VariadicArgument | ScalarArgument;
export type ValidatedValue<Config, Raw> = Config extends unknown
  ? 'validate' extends keyof Config
    ? SchemaOutput<Config['validate'], Raw>
    : Raw
  : never;
/** Keep each conditional declaration paired with its own schema input type. */
export type DefaultConstraint<Config> = Config extends unknown
  ? Config & {
      default?: 'validate' extends keyof Config ? SchemaInput<Config['validate']> : string;
    }
  : never;
export type ArgumentValue<Config extends ArgumentConfig> = Config extends { variadic: true }
  ? ValidatedValue<Config, string[]>
  : ValidatedValue<Config, string>;
export type BooleanOption =
  | (OptionSpelling & {
      type: 'boolean';
      validate?: never;
      default?: never;
      required?: never;
      polarity?: 'positive' | 'negative';
    })
  | {
      type: 'boolean';
      validate?: never;
      default?: never;
      required?: never;
      polarity: 'both';
      short?: ShortAlias;
      shortOnly?: false;
    };
export type OptionConfig = StringOption | BooleanOption;
export type OptionValue<Config extends OptionConfig> = Config extends StringOption
  ?
      | ValidatedValue<Config, string>
      | (Config extends { required: true } | { default: unknown } ? never : undefined)
  : boolean;

export interface ActionContext<Args, Options = {}> {
  args: Args;
  options: Options;
  passthrough: string[];
  out: Out;
  host: Host;
}
export type Action<Args, Options = {}> = (context: ActionContext<Args, Options>) => unknown;
export type ActionHandler<Declaration> = Declaration extends {
  action(handler: infer Handler): unknown;
}
  ? Handler
  : never;
/** The args object an extracted handler receives for this declaration. */
export type ActionArgs<Declaration> =
  ActionArgument<Declaration> extends { args: infer Args } ? Args : never;
/** The options object an extracted handler receives, global values included. */
export type ActionOptions<Declaration> =
  ActionArgument<Declaration> extends { options: infer Options } ? Options : never;
