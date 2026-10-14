import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const main = new URL('../dist/main.js', import.meta.url);
export const document =
  '{"name":"loom","tags":["a","b"],"nested":{"deep":{"value":"found"}},"count":3,"ok":true,"none":null}';

/** Every case runs the built application in a throwaway directory of JSON documents. */
export function withDocuments(files: Record<string, string>, run: (cwd: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(directory, name), contents);
    }
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** Each word with how often it appears, so a comparison ignores the order a shell lists in. */
export function counts(words: readonly string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const word of words) {
    tally.set(word, (tally.get(word) ?? 0) + 1);
  }
  return tally;
}
