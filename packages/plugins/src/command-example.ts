/**
 * One example invocation: the tokens after the application name as one line, and an optional note
 * of one line. Help prints it under EXAMPLES, and the manifest lists it in the Command's entry, so
 * help and the manifest share this one declaration.
 */
interface CommandExample {
  readonly command: string;
  readonly note?: string | undefined;
}

export type { CommandExample };
