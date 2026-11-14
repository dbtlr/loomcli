/**
 * The first code no failure class may declare. 126 and 127 belong to the shell, and 128 plus a
 * signal number reports a signal, which covers 130, 141, and 143.
 */
const firstReserved = 126;

/** Every whole number below `Bound`, counted up from 0, as one union of literal types. */
type WholeNumbersBelow<
  Bound extends number,
  Counted extends number[] = [],
> = Counted['length'] extends Bound
  ? Counted[number]
  : WholeNumbersBelow<Bound, [...Counted, Counted['length']]>;

/**
 * The codes a failure class may declare, 1 through 125. 0 is success, and the rest are reserved.
 *
 * @public
 */
export type FailureExitCode = Exclude<WholeNumbersBelow<typeof firstReserved>, 0>;

// The failure codes BSD's `sysexits.h` names, as flat constants with literal types.
// A failure class declares one by name: `static override readonly exitCode = EX_UNAVAILABLE;`.
// `EX_OK` is not here, because no failure declares 0.
// Core raises invalid input as 2 and never raises `EX_USAGE`.

/**
 * The command was used incorrectly.
 * A failure class declares it as its exit code, and the run exits 64.
 *
 * @example
 * ```ts
 * import { EX_USAGE, FatalError } from '@loomcli/core';
 *
 * class InvocationUsageError extends FatalError {
 *   static override readonly code = 'invalid-usage';
 *   static override readonly exitCode = EX_USAGE;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_USAGE = 64;
/**
 * The input data was incorrect.
 * A failure class declares it as its exit code, and the run exits 65.
 *
 * @example
 * ```ts
 * import { EX_DATAERR, FatalError } from '@loomcli/core';
 *
 * class MalformedDocumentError extends FatalError {
 *   static override readonly code = 'malformed-document';
 *   static override readonly exitCode = EX_DATAERR;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_DATAERR = 65;
/**
 * An input file did not exist or could not be read.
 * A failure class declares it as its exit code, and the run exits 66.
 *
 * @example
 * ```ts
 * import { EX_NOINPUT, FatalError } from '@loomcli/core';
 *
 * class InputFileMissingError extends FatalError {
 *   static override readonly code = 'input-file-missing';
 *   static override readonly exitCode = EX_NOINPUT;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_NOINPUT = 66;
/**
 * An addressee is unknown.
 * A failure class declares it as its exit code, and the run exits 67.
 *
 * @example
 * ```ts
 * import { EX_NOUSER, FatalError } from '@loomcli/core';
 *
 * class UnknownAddresseeError extends FatalError {
 *   static override readonly code = 'unknown-addressee';
 *   static override readonly exitCode = EX_NOUSER;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_NOUSER = 67;
/**
 * A host name is unknown.
 * A failure class declares it as its exit code, and the run exits 68.
 *
 * @example
 * ```ts
 * import { EX_NOHOST, FatalError } from '@loomcli/core';
 *
 * class UnknownHostError extends FatalError {
 *   static override readonly code = 'unknown-host';
 *   static override readonly exitCode = EX_NOHOST;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_NOHOST = 68;
/**
 * A service is unavailable.
 * A failure class declares it as its exit code, and the run exits 69.
 *
 * @example
 * ```ts
 * import { EX_UNAVAILABLE, FatalError } from '@loomcli/core';
 *
 * class RegistryDownError extends FatalError {
 *   static override readonly code = 'registry-down';
 *   static override readonly exitCode = EX_UNAVAILABLE;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_UNAVAILABLE = 69;
/**
 * An internal software error.
 * A failure class declares it as its exit code, and the run exits 70.
 *
 * @example
 * ```ts
 * import { EX_SOFTWARE, FatalError } from '@loomcli/core';
 *
 * class InternalFaultError extends FatalError {
 *   static override readonly code = 'internal-fault';
 *   static override readonly exitCode = EX_SOFTWARE;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_SOFTWARE = 70;
/**
 * An operating system error.
 * A failure class declares it as its exit code, and the run exits 71.
 *
 * @example
 * ```ts
 * import { EX_OSERR, FatalError } from '@loomcli/core';
 *
 * class SystemCallError extends FatalError {
 *   static override readonly code = 'system-call-failed';
 *   static override readonly exitCode = EX_OSERR;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_OSERR = 71;
/**
 * A system file is missing or malformed.
 * A failure class declares it as its exit code, and the run exits 72.
 *
 * @example
 * ```ts
 * import { EX_OSFILE, FatalError } from '@loomcli/core';
 *
 * class SystemFileError extends FatalError {
 *   static override readonly code = 'system-file-broken';
 *   static override readonly exitCode = EX_OSFILE;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_OSFILE = 72;
/**
 * An output file cannot be created.
 * A failure class declares it as its exit code, and the run exits 73.
 *
 * @example
 * ```ts
 * import { EX_CANTCREAT, FatalError } from '@loomcli/core';
 *
 * class OutputNotCreatedError extends FatalError {
 *   static override readonly code = 'output-not-created';
 *   static override readonly exitCode = EX_CANTCREAT;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_CANTCREAT = 73;
/**
 * An input or output error.
 * A failure class declares it as its exit code, and the run exits 74.
 *
 * @example
 * ```ts
 * import { EX_IOERR, FatalError } from '@loomcli/core';
 *
 * class ReadWriteError extends FatalError {
 *   static override readonly code = 'read-write-failed';
 *   static override readonly exitCode = EX_IOERR;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_IOERR = 74;
/**
 * A temporary failure; a retry may succeed.
 * A failure class declares it as its exit code, and the run exits 75.
 *
 * @example
 * ```ts
 * import { EX_TEMPFAIL, FatalError } from '@loomcli/core';
 *
 * class TryAgainError extends FatalError {
 *   static override readonly code = 'try-again';
 *   static override readonly exitCode = EX_TEMPFAIL;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_TEMPFAIL = 75;
/**
 * A remote system broke the protocol.
 * A failure class declares it as its exit code, and the run exits 76.
 *
 * @example
 * ```ts
 * import { EX_PROTOCOL, FatalError } from '@loomcli/core';
 *
 * class ProtocolBrokenError extends FatalError {
 *   static override readonly code = 'protocol-broken';
 *   static override readonly exitCode = EX_PROTOCOL;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_PROTOCOL = 76;
/**
 * Permission is insufficient.
 * A failure class declares it as its exit code, and the run exits 77.
 *
 * @example
 * ```ts
 * import { EX_NOPERM, FatalError } from '@loomcli/core';
 *
 * class PermissionDeniedError extends FatalError {
 *   static override readonly code = 'permission-denied';
 *   static override readonly exitCode = EX_NOPERM;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_NOPERM = 77;
/**
 * The configuration is wrong.
 * A failure class declares it as its exit code, and the run exits 78.
 *
 * @example
 * ```ts
 * import { EX_CONFIG, FatalError } from '@loomcli/core';
 *
 * class ConfigurationWrongError extends FatalError {
 *   static override readonly code = 'configuration-wrong';
 *   static override readonly exitCode = EX_CONFIG;
 * }
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#declared-exit-codes
 *
 * @public
 */
export const EX_CONFIG = 78;
