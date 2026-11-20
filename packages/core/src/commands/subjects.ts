import { commandSentence, commandSubject } from '../failures/wording.js';
import type { ExtensionSubject } from '../plugins/extension.js';

/**
 * The path a finding opens with for a declaration call on one Command. The root's is empty. A named
 * Command's call cannot know the parent it will join, so its path is its own name.
 */
export function pathOf(name: string | null): readonly string[] {
  return name === null ? [] : [name];
}

/** How the extension diagnostics of one Command's own layers name it. */
export function layerOf(name: string | null): ExtensionSubject {
  return { phrase: `on ${commandSubject(name)}`, sentence: commandSentence(name) };
}
