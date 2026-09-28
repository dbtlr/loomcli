import {
  EX_CANTCREAT,
  EX_CONFIG,
  EX_DATAERR,
  EX_IOERR,
  EX_NOHOST,
  EX_NOINPUT,
  EX_NOPERM,
  EX_NOUSER,
  EX_OSERR,
  EX_OSFILE,
  EX_PROTOCOL,
  EX_SOFTWARE,
  EX_TEMPFAIL,
  EX_UNAVAILABLE,
  EX_USAGE,
  FatalError,
  LoomError,
  UsageError,
} from '@loomcli/core';
import type { ExitCode, FailureExitCode } from '@loomcli/core';

// Each sysexits name carries its literal number type.
const sysexits: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78] = [
  EX_USAGE,
  EX_DATAERR,
  EX_NOINPUT,
  EX_NOUSER,
  EX_NOHOST,
  EX_UNAVAILABLE,
  EX_SOFTWARE,
  EX_OSERR,
  EX_OSFILE,
  EX_CANTCREAT,
  EX_IOERR,
  EX_TEMPFAIL,
  EX_PROTOCOL,
  EX_NOPERM,
  EX_CONFIG,
];

// The declarable range is 1 through 125.
const lowest: FailureExitCode = 1;
const highest: FailureExitCode = 125;
// @ts-expect-error TS2322: 0 means success, so no failure declares it.
const success: FailureExitCode = 0;
// @ts-expect-error TS2322: 126 belongs to the shell.
const shell: FailureExitCode = 126;

// A run resolves success, a declared code, or a cancellation code.
const declared: ExitCode = EX_DATAERR;
const cancelled: ExitCode = 143;

// A class states its code once, and the instance reports the same type.
class RegistryUnavailableError extends FatalError {
  static override readonly exitCode = EX_UNAVAILABLE;

  constructor(message: string) {
    super(message);
    this.name = 'RegistryUnavailableError';
  }
}
const unavailable: 69 = RegistryUnavailableError.exitCode;
const reported: FailureExitCode = new RegistryUnavailableError('The registry answered 503.')
  .exitCode;

// A class whose subclasses declare other codes annotates its own declaration.
class DocumentError extends FatalError {
  static override readonly exitCode: FailureExitCode = EX_DATAERR;

  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}
class MissingDocumentError extends DocumentError {
  static override readonly exitCode = EX_NOINPUT;

  constructor(message: string) {
    super(message);
    this.name = 'MissingDocumentError';
  }
}

// An author's usage failure may declare its own code under UsageError.
class StrictUsageError extends UsageError {
  static override readonly exitCode = EX_USAGE;

  constructor(message: string) {
    super(message);
    this.name = 'StrictUsageError';
  }
}

const bases: [FailureExitCode, FailureExitCode] = [LoomError.exitCode, UsageError.exitCode];

// @ts-expect-error TS2417: 0 is outside the declarable range.
class ZeroError extends FatalError {
  static override readonly exitCode = 0;

  constructor(message: string) {
    super(message);
    this.name = 'ZeroError';
  }
}

// @ts-expect-error TS2417: 126 is outside the declarable range.
class ShellError extends FatalError {
  static override readonly exitCode = 126;

  constructor(message: string) {
    super(message);
    this.name = 'ShellError';
  }
}

// @ts-expect-error TS2417: A plain number could hold any code, so the class line rejects it.
class AnyCodeError extends FatalError {
  static override readonly exitCode: number = 69;

  constructor(message: string) {
    super(message);
    this.name = 'AnyCodeError';
  }
}

// The instance's code is a read-only accessor, so a subclass cannot replace it with a property.
class ShadowError extends FatalError {
  // @ts-expect-error TS2610: A property cannot override the accessor the class code backs.
  override readonly exitCode = EX_DATAERR;

  constructor(message: string) {
    super(message);
    this.name = 'ShadowError';
  }
}

// @ts-expect-error TS2540: No throw may assign its own code.
new RegistryUnavailableError('The registry answered 503.').exitCode = EX_DATAERR;

// @ts-expect-error TS2554: The constructor takes the message alone.
const perThrow = new RegistryUnavailableError('The registry answered 503.', 69);

void sysexits;
void lowest;
void highest;
void success;
void shell;
void declared;
void cancelled;
void unavailable;
void reported;
void bases;
void perThrow;

export { AnyCodeError, MissingDocumentError, ShadowError, ShellError, StrictUsageError, ZeroError };
