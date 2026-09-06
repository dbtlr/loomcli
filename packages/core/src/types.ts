/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

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
export interface ActionContext<Args> {
  args: Args;
  out: Out;
  host: Host;
}
export type Action<Args> = (context: ActionContext<Args>) => unknown;
export type ActionHandler<Declaration> = Declaration extends {
  action(handler: infer Handler): unknown;
}
  ? Handler
  : never;
