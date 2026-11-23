/*
 * The one check for a control character that the plugins that write a path or a command line into
 * a file or a call an agent reads share, so none of them carries a copy.
 */

/** A control character, U+0000 to U+001F or U+007F to U+009F. */
const controlCharacter = /\p{Cc}/u;

/** Whether the text holds a control character, which would write extra directives where it lands. */
function holdsControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

export { holdsControlCharacter };
