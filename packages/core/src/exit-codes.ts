/**
 * The first code no failure class may declare. 126 and 127 belong to the shell, and 128 plus a
 * signal number reports a signal, which covers 130 and 143.
 */
const firstReserved = 126;

/** Every whole number below `Bound`, counted up from 0, as one union of literal types. */
type WholeNumbersBelow<
  Bound extends number,
  Counted extends number[] = [],
> = Counted['length'] extends Bound
  ? Counted[number]
  : WholeNumbersBelow<Bound, [...Counted, Counted['length']]>;

/** The codes a failure class may declare, 1 through 125. 0 is success, and the rest are reserved. */
export type FailureExitCode = Exclude<WholeNumbersBelow<typeof firstReserved>, 0>;

/**
 * Whether one declared value is a code a failure class may exit with. A JavaScript class, or one
 * that escaped the type check, may declare any value at all, so the check reads it as unknown.
 */
export function isFailureExitCode(value: unknown): value is FailureExitCode {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value < firstReserved
  );
}

// The failure codes BSD's `sysexits.h` names, as flat constants with literal types.
// A failure class declares one by name: `static override readonly exitCode = EX_UNAVAILABLE;`.
// `EX_OK` is not here, because no failure declares 0.
// Core raises invalid input as 2 and never raises `EX_USAGE`.

/** The command was used incorrectly. */
export const EX_USAGE = 64;
/** The input data was incorrect. */
export const EX_DATAERR = 65;
/** An input file did not exist or could not be read. */
export const EX_NOINPUT = 66;
/** An addressee is unknown. */
export const EX_NOUSER = 67;
/** A host name is unknown. */
export const EX_NOHOST = 68;
/** A service is unavailable. */
export const EX_UNAVAILABLE = 69;
/** An internal software error. */
export const EX_SOFTWARE = 70;
/** An operating system error. */
export const EX_OSERR = 71;
/** A system file is missing or malformed. */
export const EX_OSFILE = 72;
/** An output file cannot be created. */
export const EX_CANTCREAT = 73;
/** An input or output error. */
export const EX_IOERR = 74;
/** A temporary failure; a retry may succeed. */
export const EX_TEMPFAIL = 75;
/** A remote system broke the protocol. */
export const EX_PROTOCOL = 76;
/** Permission is insufficient. */
export const EX_NOPERM = 77;
/** The configuration is wrong. */
export const EX_CONFIG = 78;
