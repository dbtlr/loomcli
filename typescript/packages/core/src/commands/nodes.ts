import type { CommandNodeHandle } from './types.js';

/**
 * Each authored value registers its handle here, so the public value holds no state to reach or
 * replace.
 */
export const nodes = new WeakMap<object, CommandNodeHandle>();

/** The handle behind a value an author built as a Command, or nothing for any other value. */
export function commandNode(value: unknown): CommandNodeHandle | undefined {
  return typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
}
