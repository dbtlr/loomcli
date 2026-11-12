import type { ActionContext, Out, StandardSchemaV1 } from '@loomcli/core';

/** @public */
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
> & { readonly out: Pick<Out, 'draw' | 'region' | 'lendTerminal'> };

/** @public */
type LinkKey<Options> = keyof Options & string;
/** @public @sealed */
type Answer<Options, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Options[Key & keyof Options];
type Link<Key, Argument = never> =
  | { option: Key; argument?: never; skipIfSupplied?: boolean }
  | { argument: Argument; option?: never; skipIfSupplied?: boolean }
  | { option?: never; argument?: never; skipIfSupplied?: never };
/** @public */
type TextSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: string;
  validate?: StandardSchemaV1<string, Output>;
};
/** @public */
type EditorSettings<Key = never, Output = string, Argument = never> = Readonly<
  TextSettings<Key, Output, Argument>
> & { readonly extension?: string };
/** @public */
type SecretSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: never;
  validate?: StandardSchemaV1<string, Output>;
};
/** @public */
type ConfirmSettings<Key = never> = Link<Key> & { message: string; default?: boolean };
/** @public @sealed */
type ChoiceAnswer<Options, Key, Args, Argument, Output> = [Argument] extends [never]
  ? [Key] extends [never]
    ? Output
    : Options[Key & keyof Options]
  : Args[Argument & keyof Args];
interface ChoiceDetails {
  readonly description?: string;
  readonly disabled?: boolean | string;
}
type StringValue<Value> = unknown extends Value ? string : Extract<Value, string>;
/** @public */
type ChoiceObject<Value = unknown> =
  | (ChoiceDetails & { readonly value: StringValue<Value>; readonly label?: string })
  | (ChoiceDetails & { readonly value: Value; readonly label: string });
/** @public */
interface Separator {
  readonly separator: string;
}
/** @public */
type Choice<Value = unknown> = StringValue<Value> | ChoiceObject<Value>;
/** @public */
type ChoiceEntry<Value = unknown> = Choice<Value> | Separator;
/** @public @sealed */
type ChoiceValue<Entry> = Entry extends Separator
  ? never
  : Entry extends string
    ? Entry
    : Entry extends { readonly value: infer Value }
      ? Value
      : never;
/** @public */
type ChoiceSource<Value = unknown> = (
  term: string,
  options: { readonly signal: AbortSignal },
) => readonly ChoiceEntry<Value>[] | PromiseLike<readonly ChoiceEntry<Value>[]>;
type ChoiceList<Entry> =
  | { readonly choices: readonly Entry[]; readonly search?: boolean; readonly source?: never }
  | {
      readonly source: (
        term: string,
        options: { readonly signal: AbortSignal },
      ) => readonly Entry[] | PromiseLike<readonly Entry[]>;
      readonly choices?: never;
      readonly search?: never;
    };
type LinkedChoices<Key, Argument> = [Key | Argument] extends [never]
  ? unknown
  : { readonly choices?: readonly ChoiceEntry<string>[]; readonly source?: ChoiceSource<string> };
/** @public */
type SelectSettings<Key = never, Entry extends ChoiceEntry = ChoiceEntry, Argument = never> = Link<
  Key,
  Argument
> &
  ChoiceList<Entry> &
  LinkedChoices<Key, Argument> & {
    readonly message: string;
    readonly default?: NoInfer<ChoiceValue<Entry>>;
  };
/** @public */
type MultiselectSettings<
  Key = never,
  Entry extends ChoiceEntry = ChoiceEntry,
  Argument = never,
> = Link<Key, Argument> &
  ChoiceList<Entry> &
  LinkedChoices<Key, Argument> & {
    readonly message: string;
    readonly default?: readonly NoInfer<ChoiceValue<Entry>>[];
    readonly min?: number;
    readonly max?: number;
  };
export type {
  Answer,
  ChoiceAnswer,
  Choice,
  ChoiceObject,
  ChoiceEntry,
  ChoiceSource,
  ChoiceValue,
  Separator,
  ConfirmSettings,
  LinkKey,
  PromptContext,
  SecretSettings,
  SelectSettings,
  MultiselectSettings,
  TextSettings,
  EditorSettings,
};
