/*
 * The operator sentences of an invocation by name, under ADR-0164: the issue of a value no token
 * spells. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */

const invalidTimeZone =
  'invoke() timeZone is not an IANA time zone name this runtime knows. Use a name such as "Asia/Tokyo".';

const takesBoolean = 'Use true or false.';

const takesCount = 'Use a whole number of 0 or more.';

const takesImplied = 'Use a string, a number, or true.';

const takesList = 'Use a string, a number, or a list of them.';

const takesListOrImplied = 'Use a string, a number, true, or a list of strings and numbers.';

const takesScalar = 'Use a string or a number.';

function tuple(arity: number): string {
  return `a list of ${String(arity)} strings or numbers`;
}

function takesTuple(arity: number, multiple: boolean): string {
  return multiple ? `Use ${tuple(arity)}, or a list of such lists.` : `Use ${tuple(arity)}.`;
}

export {
  invalidTimeZone,
  takesBoolean,
  takesCount,
  takesImplied,
  takesList,
  takesListOrImplied,
  takesScalar,
  takesTuple,
};
