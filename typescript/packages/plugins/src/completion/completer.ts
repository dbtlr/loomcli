import type { Host, TypedInputs } from '@loomcli/core';

/**
 * One value a completer offers: the text to insert, or the text with a description shown beside
 * it.
 *
 * @public
 */
type CompletionValue = string | { readonly value: string; readonly description?: string };

/**
 * The values a completer returns: a list, a set, or any other iterable object. A text is iterable
 * too, but each of its characters would be a value, so the type leaves it out.
 *
 * @public
 */
type CompletionValues = Iterable<CompletionValue> & object;

/**
 * What a completer reads at Tab time. Nothing about it is validated: `word` and `typed` are words
 * the operator typed, exactly as the parser read them.
 *
 * @public
 * @sealed
 */
interface CompleterContext {
  /** The word being completed, without any lead such as `--opt=` or the short letter `-o`. */
  readonly word: string;
  /**
   * The words the earlier words gave each option and each argument, by name, as `locate()` reports
   * them. The input being completed holds its earlier words too, and not `word`. An arity option's
   * words are one flat list that ends with those its open occurrence has received, so their count
   * modulo the arity is the index of the tuple word being completed. A last-wins option holds only
   * its last completed occurrence's words, then any open occurrence's.
   */
  readonly typed: TypedInputs;
  /** The run signal. A completer that waits on something stops when it aborts. */
  readonly signal: AbortSignal;
  /** The run's host. */
  readonly host: Host;
}

/**
 * The author's function that supplies one input's values at Tab time. It returns, now or later, the
 * values to offer. The plugin keeps only those that start with `word` and that a shell inserts
 * exactly.
 *
 * @public
 */
type Completer = (context: CompleterContext) => CompletionValues | Promise<CompletionValues>;

/**
 * The completion plugin's settings.
 *
 * @public
 */
interface CompletionSettings {
  /**
   * The completers an option or an argument names with `{ values: '<name>' }` in its
   * `completionInput` or `completionArgument` value.
   */
  readonly values?: Readonly<Record<string, Completer>>;
}

export type { Completer, CompleterContext, CompletionSettings, CompletionValue, CompletionValues };
