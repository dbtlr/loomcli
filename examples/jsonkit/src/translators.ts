import { EX_DATAERR, FatalError, translate } from '@loomcli/core';

/**
 * A document that is not valid JSON. The data was read, and its syntax is wrong, so it exits with
 * `EX_DATAERR`. The translator sees only the `SyntaxError`, so the sentence names no source and
 * quotes no engine text.
 */
export class InvalidJsonError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(options?: ErrorOptions) {
    super(
      'The document is not valid JSON. Correct its syntax, or supply another document.',
      options,
    );
    this.name = 'InvalidJsonError';
  }
}

/** `JSON.parse` throws a `SyntaxError` for a malformed document, so no reader catches it. */
export const invalidJson = translate(
  SyntaxError,
  (error) => new InvalidJsonError({ cause: error }),
);
