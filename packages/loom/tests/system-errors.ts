/**
 * System errors an in-process `loom` run meets where a test plans one. A test file wraps the
 * `node:fs` members it fails in `failing`, from a `vi.mock` factory, and a case plans one failure
 * with `failAt`, which `restoreFs` undoes. A planned failure throws what the runtime throws: an
 * error that carries the code, its text in the runtime's own words, which no sentence of the bin's
 * repeats.
 */

/** The one failure a case planned: the member, which first arguments it fails, and the code. */
interface Planned {
  readonly code: string | undefined;
  readonly matches: (first: string) => boolean;
  readonly member: string;
}

let planned: Planned | undefined = undefined;

/**
 * The error the runtime throws for a call on the path that failed with the code. Without a code,
 * it is a throw that carries none.
 */
function systemError(path: string, code: string | undefined): Error {
  const error = new Error(`${code ?? 'UNKNOWN'}: induced failure, open '${path}'`);
  return code === undefined ? error : Object.assign(error, { code });
}

/**
 * Fails each later call of the member whose first argument is the path, or which the predicate
 * accepts, with the code's system error, until `restoreFs` runs.
 */
function failAt(
  member: string,
  path: string | ((first: string) => boolean),
  code: string | undefined,
) {
  const matches = typeof path === 'string' ? (first: string) => first === path : path;
  planned = { code, matches, member };
}

/** Undoes the failure a case planned. */
function restoreFs() {
  planned = undefined;
}

/** The member, which throws the planned failure when a case planned one for it, else calls through. */
function failing<Member extends (...args: never[]) => unknown>(
  member: string,
  original: Member,
): Member {
  return new Proxy(original, {
    apply(target, self, args: unknown[]) {
      const first = String(args[0]);
      if (planned?.member === member && planned.matches(first)) {
        throw systemError(first, planned.code);
      }
      return Reflect.apply(target, self, args);
    },
  });
}

export { failAt, failing, restoreFs, systemError };
