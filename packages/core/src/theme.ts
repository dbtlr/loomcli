import { DeclarationError, quoted } from './errors.js';
import { partFinding, slotSite } from './facts.js';
import { isPlainObject } from './plain.js';
import { themeMapping, themeNameTaken } from './plugin-rules.js';
import type { Palette } from './style-state.js';
import { chains, reservedStyleNames } from './style.js';
import type { Operation } from './style.js';

/**
 * One plugin's theme, read as the palette core resolves semantic styles through. Each fault marks
 * the theme, or the one entry at fault, in `plugin(identity, { theme })`.
 */
function buildTheme(value: unknown, identity: string): Palette {
  const subject = `Plugin ${quoted(identity)}`;
  const site = slotSite({ call: 'plugin', named: identity, subject }, 'theme', value);
  if (!isPlainObject(value)) {
    throw new DeclarationError(themeMapping, {
      correction: 'Supply a mapping of names to concrete style chains.',
      findings: [partFinding(site, [])],
      sentence: `${subject} declares a theme that is not a mapping.`,
    });
  }
  const palette = new Map<string, readonly Operation[]>();
  for (const [name, chain] of Object.entries(value)) {
    if (reservedStyleNames.has(name)) {
      throw new DeclarationError(themeNameTaken, {
        correction: 'Rename the theme entry.',
        findings: [partFinding(site, [name])],
        sentence: `${subject} theme name ${quoted(name)} shadows a built-in style member.`,
      });
    }
    const operations = typeof chain === 'function' ? chains.get(chain) : undefined;
    if (
      chain !== undefined &&
      (operations === undefined || operations.some((entry) => entry[0] === 'token'))
    ) {
      throw new DeclarationError(themeMapping, {
        correction:
          'Map the name to a concrete chain such as style.cyan.bold, without calling it or naming a semantic style.',
        findings: [partFinding(site, [name])],
        sentence: `${subject} theme mapping ${quoted(name)} is not an unapplied concrete style chain without semantic tokens.`,
      });
    }
    palette.set(name, operations ?? []);
  }
  return palette;
}

export { buildTheme };
