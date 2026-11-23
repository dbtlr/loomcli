/**
 * The configuration plugin's `-v` lines that say which file the lookup read, or that it found
 * none, under ADR-0165. `config-lines.test.ts` pins their bytes and their place before the
 * `Ignored` lines, so the tests of dropped values and unknown keys, which run at `-v` to read the
 * `Ignored` lines, read the rest of stderr without them.
 */
const lookupLine = /^› (?:Read configuration from .*|Found no configuration file)\.\n/gmu;

/** The text with each line that names the file the lookup read, or that it found none, removed. */
export function withoutLookupLines(text: string): string {
  return text.replaceAll(lookupLine, '');
}
