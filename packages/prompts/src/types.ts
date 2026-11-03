import type { ActionContext, Out, StandardSchemaV1 } from '@loomcli/core';

type PromptContext<Options, Args = unknown> = Pick<
  ActionContext<Args, Options>,
  | 'args'
  | 'passthrough'
  | 'options'
  | 'interactive'
  | 'supplied'
  | 'command'
  | 'graph'
  | 'host'
  | 'signal'
  | 'cancel'
  | 'onShutdown'
  | 'onSuspend'
  | 'onResume'
> & { readonly out: Pick<Out, 'draw' | 'region'> };

type LinkKey<Options> = keyof Options & string;
type Answer<Options, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Options[Key & keyof Options];
type Link<Key, Argument = never> =
  | { option: Key; argument?: never; skipIfSupplied?: boolean }
  | { argument: Argument; option?: never; skipIfSupplied?: boolean }
  | { option?: never; argument?: never; skipIfSupplied?: never };
type TextSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: string;
  validate?: StandardSchemaV1<string, Output>;
};
type SecretSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: never;
  validate?: StandardSchemaV1<string, Output>;
};
type ConfirmSettings<Key = never> = Link<Key> & { message: string; default?: boolean };
type SelectSettings<Key = never, Choice extends string = string, Argument = never> = Link<
  Key,
  Argument
> & {
  message: string;
  choices: readonly Choice[];
  default?: NoInfer<Choice>;
};

export type {
  Answer,
  ConfirmSettings,
  LinkKey,
  PromptContext,
  SecretSettings,
  SelectSettings,
  TextSettings,
};
