import { DeclarationError } from './errors.js';
import { isPlainObject } from './facts.js';
import type { Palette } from './style-state.js';
import { chains, reservedStyleNames } from './style.js';
import type { Operation } from './style.js';

function buildTheme(value: unknown, identity: string): Palette {
  if (!isPlainObject(value)) {
    throw new DeclarationError(
      `Plugin "${identity}" must declare theme as a mapping of names to concrete style chains.`,
    );
  }
  const palette = new Map<string, readonly Operation[]>();
  for (const [name, chain] of Object.entries(value)) {
    if (reservedStyleNames.has(name)) {
      throw new DeclarationError(
        `Plugin "${identity}" theme name "${name}" shadows a built-in style member.`,
      );
    }
    const operations = typeof chain === 'function' ? chains.get(chain) : undefined;
    if (
      chain !== undefined &&
      (operations === undefined || operations.some((entry) => entry[0] === 'token'))
    ) {
      throw new DeclarationError(
        `Plugin "${identity}" theme mapping "${name}" must be an unapplied concrete style chain without semantic tokens.`,
      );
    }
    palette.set(name, operations ?? []);
  }
  return palette;
}

export { buildTheme };
