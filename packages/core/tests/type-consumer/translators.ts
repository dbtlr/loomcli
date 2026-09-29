import {
  Application,
  DeclarationError,
  EX_DATAERR,
  FatalError,
  InputError,
  plugin,
  translate,
} from '@loomcli/core';
import type { ErrorClass, Translation, Translator } from '@loomcli/core';

class InvalidJsonError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(options?: ErrorOptions) {
    super(
      'The document is not valid JSON. Correct its syntax, or supply another document.',
      options,
    );
    this.name = 'InvalidJsonError';
  }
}

// The translator's parameter types as the key's instance type, with no narrowing.
const invalidJson: Translation = translate(SyntaxError, (error) => {
  const parsed: SyntaxError = error;
  return new InvalidJsonError({ cause: parsed });
});

// A Node system error is keyed on its class and told apart by its own fields.
const missingFile = translate(Error, (error) =>
  'code' in error && error.code === 'ENOENT' ? new FatalError('The file is missing.') : undefined,
);

// An abstract class is a key, and its instance type reaches the translator.
abstract class ClientError extends Error {
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}
const client = translate(ClientError, (error) => {
  const status: number = error.status;
  return status === 503 ? new FatalError('The service is unavailable.') : undefined;
});

// The exported names describe the same pair.
const key: ErrorClass<SyntaxError> = SyntaxError;
const passing: Translator<SyntaxError> = () => undefined;
const typed: Translation = translate(key, passing);

// The Application and a plugin each list their translations.
const app = new Application('jsonkit', { translators: [invalidJson, missingFile] });
const http = plugin('@acme/http', { translators: [client, typed] });

// The failure classes an author constructs accept the platform ErrorOptions.
const causes = [
  new FatalError('Stopped.', { cause: 'reason' }),
  new InputError('Bad input.', [], { cause: 1 }),
  new DeclarationError('Declared wrong.', { cause: undefined }),
];

// @ts-expect-error TS2322: a translator returns a failure or undefined, never a string.
const stringly = translate(SyntaxError, () => 'The document is broken.');

// @ts-expect-error TS2741: an Error that is not a LoomError is no failure.
const foreign = translate(SyntaxError, (error) => new TypeError(error.message));

// @ts-expect-error TS2339: the parameter is the key's instance type, which has no status.
const unrelated = translate(SyntaxError, (error) => (error.status === 1 ? undefined : undefined));

// @ts-expect-error TS2322: a list holds translations, not bare functions.
const bare = new Application('bare', { translators: [() => undefined] });

// @ts-expect-error TS2345: a key is a class, not an instance.
const instance = translate(new SyntaxError('x'), () => undefined);

export { app, bare, causes, foreign, http, instance, stringly, unrelated };
