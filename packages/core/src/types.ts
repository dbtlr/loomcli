/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

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
export type StringOption = OptionSpelling & { type: 'string'; polarity?: never };
export type BooleanOption =
  | (OptionSpelling & { type: 'boolean'; polarity?: 'positive' | 'negative' })
  | { type: 'boolean'; polarity: 'both'; short?: ShortAlias; shortOnly?: false };
export type OptionConfig = StringOption | BooleanOption;
export type OptionValue<Config extends OptionConfig> = Config extends StringOption
  ? string | undefined
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
