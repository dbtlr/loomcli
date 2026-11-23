/** The facts a system error carries apart from its text: its code, the call that failed, and its path. */
interface SystemErrorFacts {
  readonly code: string;
  readonly path: string | undefined;
  readonly syscall: string;
}

/**
 * The code a system error carries, such as `EACCES`, or `undefined` for a throw that carries no
 * string `code`, as the bin's own failures do not. A sentence names the cause from this fact, never
 * from the error's text, under ADR-0164.
 *
 * @example
 * ```ts
 * systemErrorCode(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })); // 'EACCES'
 * systemErrorCode(new Error('Tag v1.2.0 already exists.')); // undefined
 * ```
 */
export function systemErrorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * The facts of a system error the operating system raised, or `undefined` for any other throw: one
 * that carries no string `code` and `syscall`, or one whose code is a runtime's internal `ERR_*`
 * code, such as `ERR_INVALID_URL`, which names no file error.
 *
 * @example
 * ```ts
 * const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT', path: 'notes.md', syscall: 'open' });
 * systemErrorFacts(error); // { code: 'ENOENT', path: 'notes.md', syscall: 'open' }
 * systemErrorFacts(Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' })); // undefined
 * ```
 */
export function systemErrorFacts(error: unknown): SystemErrorFacts | undefined {
  const code = systemErrorCode(error);
  if (
    code === undefined ||
    code.startsWith('ERR_') ||
    !(error instanceof Error) ||
    !('syscall' in error) ||
    typeof error.syscall !== 'string'
  ) {
    return undefined;
  }
  const path = 'path' in error && typeof error.path === 'string' ? error.path : undefined;
  return { code, path, syscall: error.syscall };
}
