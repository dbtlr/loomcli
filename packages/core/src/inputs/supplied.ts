import { defineEntry } from '../support/plain.js';
import { holdsTuples } from './context.js';
import type { InputDeclaration, Invocation, OptionInput, SuppliedValues } from './declarations.js';
import { arityOf, reportedOf, spellingsOf } from './options.js';
import type { OptionValues } from './options.js';
import { inputPhrase } from './phrases.js';
import type { SuppliedInputs } from './types.js';
import type { InputSubject } from './wording.js';

/**
 * The token an operator would type for one declaration: an option's reported spelling, read from
 * the routed Command's table, and the declared name for an argument. Every input diagnostic and
 * every reported problem names the declaration this way, so an omission and a rejected value read
 * alike and a `shortOnly` option is never named by a long form it does not accept. An invocation by
 * name types no spelling, so there an option is named by its declared name, the key the caller wrote.
 */
export function spellingOf(
  input: InputDeclaration,
  invocation: Pick<Invocation, 'named' | 'table'>,
): string {
  return input.kind === 'argument' || invocation.named !== undefined
    ? input.name
    : reportedOf(spellingsOf(invocation.table, input.name), input.name);
}

/**
 * An input diagnostic names the declaration by kind and by the spelling that reaches it, and a
 * value an input source filled by its source too. An argument has no source.
 */
export function suppliedName(
  input: InputDeclaration,
  spelling: string,
  origin?: string,
): InputSubject {
  return input.kind === 'argument'
    ? { kind: 'argument', spelling }
    : { kind: 'option', origin, spelling };
}

/**
 * The default sentence for an omitted required input. An argument and an option keep the wording
 * each phase used before omission became one problem, and a collected input asks for one value
 * more than a scalar does.
 */
export function missingMessage(
  input: InputDeclaration,
  spelling: string,
  facts: { collected: boolean; origin?: string | undefined },
) {
  const { collected, origin } = facts;
  const whenNotInteractive = input.config.required === 'non-interactive';
  return input.kind === 'argument'
    ? inputPhrase('requiredArgument', spelling, collected, whenNotInteractive)
    : inputPhrase('requiredOption', { kind: 'option', origin, spelling }, whenNotInteractive, {
        arity: arityOf(input.config),
        collected,
        kind: 'values',
      });
}

/**
 * A multiple option collects its occurrences and a variadic argument collects the remaining
 * tokens, so either one carries a `string[]` as its raw value and validates each value alone.
 */
export function collects(input: InputDeclaration) {
  return input.kind === 'option' ? input.config.multiple === true : input.config.variadic === true;
}

/**
 * The declaration flag that sends an omitted value to its own validator. Every declaration reads it
 * here, and the types allow it only where no other rule already decides absence.
 */
export function validatesOmission(input: InputDeclaration) {
  const { config } = input;
  return 'validateOmitted' in config && config.validateOmitted;
}

/**
 * One accessor for a supplied option value, so the collected, single, and arity shapes read alike:
 * an arity option's one tuple, or a multiple one's list of tuples.
 */
export function suppliedOption(
  options: OptionValues,
  input: OptionInput,
  collected: boolean,
): string | string[] | string[][] | undefined {
  const { name } = input;
  if (arityOf(input.config) !== undefined) {
    const tuples = options.tuples.get(name);
    return collected ? tuples : tuples?.[0];
  }
  return wordsOf(options, name, collected);
}

/** A one-word option's supplied value: its one word, or a multiple option's list of them. */
export function wordsOf(options: OptionValues, name: string, collected: boolean) {
  return collected ? options.lists.get(name) : options.strings.get(name);
}

/**
 * The copy a collected value is handed out as, a list of tuples copied at both depths, because the
 * parser's arrays are the action's.
 */
function copied(value: string | string[] | string[][] | undefined) {
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  return holdsTuples(value) ? value.map((words) => [...words]) : [...value];
}

/**
 * An array default or implied output reaches the action as its own mutable copy, so an action that
 * mutates its array rewrites neither the declaration nor the next invocation. One prepared declared
 * value serves every invocation of a run, and an unvalidated default is the value the author
 * declared, so each read copies it. A multiple arity option's list of tuples is copied at both
 * depths, under `nested`. The copy keeps a hole where the value has one, as the graph's does. Every
 * other output passes through unchanged.
 */
export function freshDeclaredValue(value: unknown, nested = false): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const elements: readonly unknown[] = value;
  // A spread reads a hole as `undefined`, and `slice` and `map` keep it.
  // oxlint-disable-next-line unicorn/prefer-spread
  return nested ? elements.map((element) => freshDeclaredValue(element)) : elements.slice();
}

/** Whether an input's value is a list of tuples, which a fresh copy copies at both depths. */
export function holdsTupleList(input: InputDeclaration): boolean {
  return input.kind === 'option' && collects(input) && arityOf(input.config) !== undefined;
}

/**
 * The raw tokens of one invocation, keyed by declared name. Every declared input of the routed
 * Command and every global appears, so absence reads as the shape its declaration collects. Each
 * collected value is copied, because the parser's own array is what the action reads.
 */
export function suppliedInputs(
  declarations: readonly InputDeclaration[],
  supplied: SuppliedValues,
  freeze = false,
): SuppliedInputs {
  const args: Record<string, string | readonly string[] | undefined> = {};
  const options: Record<string, string | readonly string[] | boolean | number | undefined> = {};
  for (const input of declarations) {
    const collected = collects(input);
    if (input.kind === 'argument') {
      defineEntry(
        args,
        input.name,
        copied(supplied.args.get(input)) ?? (collected ? [] : undefined),
      );
    } else if (input.config.type === 'boolean') {
      defineEntry(options, input.name, supplied.options.booleans.get(input.name));
    } else if (input.config.type === 'count') {
      defineEntry(options, input.name, supplied.options.counts.get(input.name));
    } else {
      defineEntry(
        options,
        input.name,
        copied(suppliedOption(supplied.options, input, collected)) ?? (collected ? [] : undefined),
      );
    }
  }
  if (freeze) {
    for (const value of [...Object.values(args), ...Object.values(options)]) {
      if (Array.isArray(value)) {
        Object.freeze(value);
      }
    }
    return Object.freeze({ args: Object.freeze(args), options: Object.freeze(options) });
  }
  return { args, options };
}
