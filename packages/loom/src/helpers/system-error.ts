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
