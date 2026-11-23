/**
 * Resolves a per-call time zone to the runtime's spelling of its IANA name. Numeric offsets and
 * names the runtime does not know return `undefined`. The supplied name is not trimmed.
 *
 * @example
 * ```ts
 * import { resolveTimeZone } from '@loomcli/core';
 *
 * resolveTimeZone('Asia/Tokyo'); // 'Asia/Tokyo'
 * resolveTimeZone('+09:00'); // undefined
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/invocation.md
 * @public
 */
export function resolveTimeZone(timeZone: string): string | undefined {
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    return resolved.startsWith('+') || resolved.startsWith('-') ? undefined : resolved;
  } catch {
    return undefined;
  }
}
