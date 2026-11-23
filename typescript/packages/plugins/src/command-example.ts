/**
 * One example invocation: the tokens after the application name as one line, and an optional note
 * of one line. Help prints it under EXAMPLES, and the manifest lists it in the Command's entry, so
 * help and the manifest share this one declaration.
 *
 * @public
 */
interface CommandExample {
  /** The tokens after the application name, as one line. */
  readonly command: string;
  /** One line printed under the invocation. None by default. */
  readonly note?: string | undefined;
}

export type { CommandExample };
