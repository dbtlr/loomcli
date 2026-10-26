/**
 * The style a built context holds when the test states none. A test cares that its function asked
 * for style names, not what they do, so every name answers a style that returns its text unchanged,
 * and each path answers the same function on every read, so a test spies on the names its function
 * asks for.
 */
import type { ContextualStyle } from '@loomcli/core';

/** The helpers that take a color and answer a style, one style whatever the color. */
const colorHelpers: ReadonlySet<string> = new Set([
  'ansi256',
  'bgAnsi256',
  'bgHex',
  'bgRgb',
  'hex',
  'rgb',
]);

/** One path's style: a function that returns its text unchanged and answers each further name. */
function answering(): (text: string) => string {
  return new Proxy((text: string) => text, {
    get: (target, key, receiver) => {
      answer(target, key);
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor: (target, key) => {
      answer(target, key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

/**
 * Keeps the answer to a name on the path's function the first time the name is asked for, so every
 * later read, a spy, and an assignment meet the same property. A name the function already has,
 * such as `call`, `bind`, `name`, or `length`, stays the function's, and `then` answers nothing, so
 * the style is never a thenable.
 */
function answer(target: (text: string) => string, key: string | symbol): void {
  if (typeof key !== 'string' || key === 'then' || key in target) {
    return;
  }
  const style = answering();
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value: colorHelpers.has(key) ? () => style : style,
    writable: true,
  });
}

/** A style that answers every name, every color, modifier, reset, theme token, and helper. */
function unstatedStyle(): ContextualStyle {
  // Last resort: no typed path exists to a ContextualStyle outside core.
  // Core's Style carries a brand under a symbol core does not export.
  // It holds because the proxy answers every member the type names, a theme's tokens included.
  // Each name answers a style, and each color helper answers a function that answers one.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return answering() as ContextualStyle;
}

export { unstatedStyle };
