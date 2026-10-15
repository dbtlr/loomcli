import type { ActionContext, Out, StandardSchemaV1 } from '@loomcli/core';

type PromptContext<Options> = Pick<
  ActionContext<unknown, Options>,
  | 'passthrough'
  | 'options'
  | 'interactive'
  | 'supplied'
  | 'command'
  | 'graph'
  | 'host'
  | 'signal'
  | 'cancel'
> & { readonly out: Pick<Out, 'draw'> };

type LinkKey<Options> = keyof Options & string;
type Answer<Options, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Options[Key & keyof Options];
type Link<Key> =
  | { option: Key; skipIfSupplied?: boolean }
  | { option?: never; skipIfSupplied?: never };
type TextSettings<Key = never, Output = string> = Link<Key> & {
  message: string;
  default?: string;
  validate?: StandardSchemaV1<string, Output>;
};
type SecretSettings<Key = never, Output = string> = Link<Key> & {
  message: string;
  default?: never;
  validate?: StandardSchemaV1<string, Output>;
};
type ConfirmSettings<Key = never> = Link<Key> & { message: string; default?: boolean };
type SelectSettings<Key = never, Choice extends string = string> = Link<Key> & {
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
