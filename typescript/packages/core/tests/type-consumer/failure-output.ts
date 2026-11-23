import {
  Application,
  Command,
  encodeFailure,
  EX_DATAERR,
  FatalError,
  plugin,
  WorkingDirectoryError,
} from '@loomcli/core';
import type {
  FailureEncoder,
  FailureEncoding,
  FailureForm,
  FailureHook,
  FailureViewContext,
  Middleware,
} from '@loomcli/core';

// A class states its failure code once, and a projection reads it without an instance.
class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;

  constructor(path: string) {
    super(`Path not found: "${path}".`);
    this.name = 'PathNotFoundError';
  }
}
const literal: 'path-not-found' = PathNotFoundError.code;
const inherited: string = FatalError.code;

// A class whose own subclasses declare other codes annotates its declaration.
class RegistryError extends FatalError {
  static override readonly code: string = 'registry';

  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}
class RegistryDownError extends RegistryError {
  static override readonly code = 'registry-down';

  constructor(message: string) {
    super(message);
    this.name = 'RegistryDownError';
  }
}

// @ts-expect-error TS2417: A failure code is a string.
class NumericCodeError extends FatalError {
  static override readonly code = 42;

  constructor(message: string) {
    super(message);
    this.name = 'NumericCodeError';
  }
}

// @ts-expect-error TS2417: A literal-typed parent's subclass declares the same literal or none.
class OtherPathError extends PathNotFoundError {
  static override readonly code = 'other-path';

  constructor(path: string) {
    super(path);
    this.name = 'OtherPathError';
  }
}

// The form is plain data that invoke's outcome and its handler carry.
async function outcome(): Promise<string> {
  const app = new Application('probe').command(new Command('get').action(() => undefined));
  const result = await app.invoke(['get'], {}, { failure: (_failure, { form }) => form.code });
  if (result.status === 'failed') {
    const form: FailureForm = result.form;
    const code: string = result.failure;
    const hints: readonly string[] = form.hints;
    return `${code} ${form.message} ${String(form.exitCode)} ${hints.join(',')}`;
  }
  return '';
}

// An unreadable working directory narrows by its class, whose code and exit code read without an instance.
async function unreadable(): Promise<string> {
  const app = new Application('probe').command(new Command('get').action(() => undefined));
  const result = await app.invoke(['get'], {});
  if (result.status === 'failed' && result.failure instanceof WorkingDirectoryError) {
    const cause: unknown = result.failure.cause;
    return `${WorkingDirectoryError.code} ${String(WorkingDirectoryError.exitCode)} ${String(cause)}`;
  }
  return '';
}
const directoryFailure = new WorkingDirectoryError({ cause: new Error('uv_cwd') });
// @ts-expect-error TS2559: The message is fixed, so the constructor takes the platform's options alone.
const sentenced = new WorkingDirectoryError('The directory is gone.');

// A failure view and a hook read the run's selection.
const selected = (context: FailureViewContext): string =>
  `${context.view ?? ''} ${context.mediaType ?? ''}`;
const hinted: FailureHook = (_failure, { mediaType, view }) => `${view ?? ''} ${mediaType ?? ''}`;

// An encoder receives the form and returns the text core writes to stderr.
const line: FailureEncoder = (form) => `${JSON.stringify({ error: form })}\n`;
const encoding: FailureEncoding = encodeFailure('application/json', line);
// @ts-expect-error TS2345: A media type is a string.
encodeFailure(5, line);
// @ts-expect-error TS2322: An encoder returns a string.
encodeFailure('application/json', () => 5);

const json = plugin('@probe/json', {
  failureEncoders: [encoding],
  options: { pick: { type: 'string' } },
});

// A middleware reads its own validated options, each possibly absent, under `ownOptions`.
const middleware: Middleware<typeof json> = async ({ next, ownOptions }) => {
  const pick: string | undefined = ownOptions.pick;
  const attached: unknown = ownOptions.format;
  void pick;
  void attached;
  await next();
};

void literal;
void inherited;
void outcome;
void unreadable;
void directoryFailure;
void sentenced;
void selected;
void hinted;
void middleware;

export { NumericCodeError, OtherPathError, RegistryDownError };
