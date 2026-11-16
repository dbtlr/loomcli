/*
 * The operator sentences of the background plugin, under ADR-0164: the issue of a `--background`
 * value it does not take. `tests/message-voice.test.ts` holds this module to the failure message
 * voice.
 */

/**
 * The issue of a `--background` value that is neither `dark` nor `light`.
 *
 * @example
 * ```ts
 * console.log(backgroundIssue); // 'Supply dark or light.'
 * ```
 */
const backgroundIssue = 'Supply dark or light.';

export { backgroundIssue };
