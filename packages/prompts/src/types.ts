import type { ActionContext, Out, StandardSchemaV1 } from '@loomcli/core';

/**
 * What a question reads from an action's context: the routed Command's inputs, what the operator
 * supplied, the run's signal and lifecycle hooks, and the output lanes a question draws through.
 * An action's, a middleware's, or a hook's context that carries these is accepted as it is.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#calling-a-question
 * @public
 */
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

/**
 * The name of an option or argument a question links: a string key of the Command's options or
 * arguments type.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#linking-an-input
 * @public
 */
type LinkKey<Options> = keyof Options & string;
/**
 * What a question resolves to: its own output, or the linked option's value when the operator
 * supplied that option instead. With no linked key the answer is the output alone.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#resolving-a-question
 * @public
 * @sealed
 */
type Answer<Options, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Options[Key & keyof Options];
type Link<Key, Argument = never> =
  | { option: Key; argument?: never; skipIfSupplied?: boolean }
  | { argument: Argument; option?: never; skipIfSupplied?: boolean }
  | { option?: never; argument?: never; skipIfSupplied?: never };
/**
 * The settings of a text question: its message, an optional default the input starts with, an
 * optional validator for the typed line, and an optional link to an option or argument.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#calling-a-question
 * @public
 */
type TextSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: string;
  validate?: StandardSchemaV1<string, Output>;
};
/**
 * The settings of an editor question: those of a text question, plus the file extension the
 * operator's editor opens the answer's file with.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#the-editor-question
 * @public
 */
type EditorSettings<Key = never, Output = string, Argument = never> = Readonly<
  TextSettings<Key, Output, Argument>
> & { readonly extension?: string };
/**
 * The settings of a secret question: its message, an optional validator, and an optional link. A
 * secret takes no default, because the answer is never shown.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#calling-a-question
 * @public
 */
type SecretSettings<Key = never, Output = string, Argument = never> = Link<Key, Argument> & {
  message: string;
  default?: never;
  validate?: StandardSchemaV1<string, Output>;
};
/**
 * The settings of a confirm question: its message, an optional default answer, and an optional
 * link to a Boolean option.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#calling-a-question
 * @public
 */
type ConfirmSettings<Key = never> = Link<Key> & { message: string; default?: boolean };
/**
 * What a select or multiselect question resolves to: the chosen value or values, the linked
 * option's value, or the linked argument's value when the question links one.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#resolving-a-question
 * @public
 * @sealed
 */
type ChoiceAnswer<Options, Key, Args, Argument, Output> = [Argument] extends [never]
  ? [Key] extends [never]
    ? Output
    : Options[Key & keyof Options]
  : Args[Argument & keyof Args];
interface ChoiceDetails {
  /** A line shown below the list while the choice is highlighted. */
  readonly description?: string;
  /** Whether the operator cannot pick the choice, with the reason a string states. */
  readonly disabled?: boolean | string;
}
type StringValue<Value> = unknown extends Value ? string : Extract<Value, string>;
/**
 * A choice written as an object: its value, an optional label shown in place of the value, an
 * optional description, and an optional disabled state. A value that is not a string needs a label.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
type ChoiceObject<Value = unknown> =
  | (ChoiceDetails & { readonly value: StringValue<Value>; readonly label?: string })
  | (ChoiceDetails & { readonly value: Value; readonly label: string });
/**
 * A row in a list of choices that groups the rows below it and cannot be picked.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
interface Separator {
  /** The text the row shows, or the empty string for a blank row. */
  readonly separator: string;
}
/**
 * One choice the operator can pick: a string that is both its value and its label, or a
 * {@link ChoiceObject}.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
type Choice<Value = unknown> = StringValue<Value> | ChoiceObject<Value>;
/**
 * One row of a choice list: a {@link Choice} or a {@link Separator}.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
type ChoiceEntry<Value = unknown> = Choice<Value> | Separator;
/**
 * The value a choice entry stands for: the string itself, an object's `value`, and nothing for a
 * separator.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
type ChoiceValue<Entry> = Entry extends Separator
  ? never
  : Entry extends string
    ? Entry
    : Entry extends { readonly value: infer Value }
      ? Value
      : never;
/**
 * A function that supplies the choices for the term the operator has typed so far, with a signal
 * that aborts when the term changes or the question ends.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#searching
 * @public
 */
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
/**
 * The settings of a select question: its message, the choices or a source that supplies them, an
 * optional default choice, and an optional link.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
type SelectSettings<Key = never, Entry extends ChoiceEntry = ChoiceEntry, Argument = never> = Link<
  Key,
  Argument
> &
  ChoiceList<Entry> &
  LinkedChoices<Key, Argument> & {
    readonly message: string;
    readonly default?: NoInfer<ChoiceValue<Entry>>;
  };
/**
 * The settings of a multiselect question: those of a select question, with default choices and the
 * fewest and most choices the operator may pick.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#choices
 * @public
 */
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
