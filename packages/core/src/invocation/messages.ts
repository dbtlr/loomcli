/*
 * The operator sentences of an invocation by name, under ADR-0164: the issue each kind of input
 * reports for a value no token spells, which says what the input takes. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */

/**
 * The issue of a Boolean option's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesBoolean };
 * ```
 */
const takesBoolean = 'Use true or false.';

/**
 * The issue of a counted option's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesCount };
 * ```
 */
const takesCount = 'Use a whole number of 0 or more.';

/**
 * The issue of an implied-value option's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesImplied };
 * ```
 */
const takesImplied = 'Use a string, a number, or true.';

/**
 * The issue of a multiple option's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesList };
 * ```
 */
const takesList = 'Use a string, a number, or a list of them.';

/**
 * The issue of a multiple implied-value option's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesListOrImplied };
 * ```
 */
const takesListOrImplied = 'Use a string, a number, true, or a list of strings and numbers.';

/**
 * The issue of a scalar option's or an argument's value no token spells.
 *
 * @example
 * ```ts
 * const issue = { message: takesScalar };
 * ```
 */
const takesScalar = 'Use a string or a number.';

/** A tuple of an arity option's count, as its issue names it. */
function tuple(arity: number): string {
  return `a list of ${String(arity)} strings or numbers`;
}

/**
 * The issue an arity option reports for a value no tuple spells: a tuple of its count, or on a
 * multiple option a list of such tuples.
 *
 * @example
 * ```ts
 * takesTuple(2, false); // 'Use a list of 2 strings or numbers.'
 * ```
 */
function takesTuple(arity: number, multiple: boolean): string {
  return multiple ? `Use ${tuple(arity)}, or a list of such lists.` : `Use ${tuple(arity)}.`;
}

export {
  takesBoolean,
  takesCount,
  takesImplied,
  takesList,
  takesListOrImplied,
  takesScalar,
  takesTuple,
};
