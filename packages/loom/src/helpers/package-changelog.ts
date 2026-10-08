import {
  chmodSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import {
  highestKind,
  insertSection,
  landedFragments,
  nextVersion,
  parseVersion,
  renderSection,
} from './changelog.js';
import { readRegularFile } from './repository.js';

// The end of the JSON string that opens at the index, past its closing quote.
function stringEnd(source: string, start: number) {
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    index += source[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}

/**
 * The span of the top-level `version` string in a JSON object's source. Scanning instead of
 * re-serializing keeps every other byte, and a nested `version`, such as a script's, never matches.
 * The last one wins, as it does for `JSON.parse`.
 */
function versionSpan(source: string) {
  let depth = 0;
  let state: 'key' | 'colon' | 'value' | 'other' = 'other';
  let key: unknown = undefined;
  let span: { end: number; start: number } | undefined = undefined;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    let next = index + 1;
    if (character === '"') {
      next = stringEnd(source, index);
      if (depth === 1 && state === 'key') {
        key = JSON.parse(source.slice(index, next));
        state = 'colon';
      } else if (depth === 1 && state === 'value') {
        span = key === 'version' ? { end: next, start: index } : span;
        state = 'other';
      }
    } else if (character === '{' || character === '[') {
      depth += 1;
      state = depth === 1 && character === '{' ? 'key' : 'other';
    } else if (character === '}' || character === ']') {
      depth -= 1;
      state = 'other';
    } else if (depth === 1 && character === ':') {
      state = 'value';
    } else if (depth === 1 && character === ',') {
      state = 'key';
    } else if (depth === 1 && state === 'value' && !/\s/u.test(character ?? '')) {
      state = 'other';
    }
    index = next;
  }
  return span;
}

// The manifest with its top-level `version` set and every other byte kept.
function withVersion(source: string, version: string) {
  const span = versionSpan(source);
  if (span === undefined) {
    throw new Error('package.json: expected a version string.');
  }
  return source.slice(0, span.start) + JSON.stringify(version) + source.slice(span.end);
}

function manifestVersion(source: string) {
  let document: unknown = undefined;
  try {
    document = JSON.parse(source);
  } catch (error) {
    throw new Error('package.json: expected valid JSON.', { cause: error });
  }
  const parsed = z.object({ version: z.string() }).safeParse(document);
  if (!parsed.success) {
    throw new Error('package.json: expected a version string.');
  }
  return parsed.data.version;
}

/**
 * A package's next cut, prepared without writing: the section its pending fragments render, the
 * version they decide, and the new contents of `CHANGELOG.md` and `package.json`.
 */
export function preparePackageCut(
  directory: string,
  options: { date: string; narrative: string | undefined },
) {
  const manifest = readRegularFile(directory, 'package.json');
  const current = parseVersion(manifestVersion(manifest));
  const { fragments } = landedFragments(directory);
  if (fragments.length === 0) {
    throw new Error('No fragments to release. Add a fragment to .changes/ first.');
  }
  const version = nextVersion(current, highestKind(fragments));
  const section = renderSection({
    date: options.date,
    fragments,
    narrative: options.narrative,
    version,
  });
  const changelog = existsSync(join(directory, 'CHANGELOG.md'))
    ? readRegularFile(directory, 'CHANGELOG.md')
    : '# Changelog\n';
  return {
    changelog: insertSection(changelog, section, version),
    fragments,
    manifest: withVersion(manifest, version),
    section,
    version,
  };
}

/**
 * Installs a prepared cut. Each file is written to a temporary copy beside it first, so a failure
 * before the copies replace the originals changes nothing. The consumed fragments go last.
 */
export function writePackageCut(directory: string, cut: ReturnType<typeof preparePackageCut>) {
  const stage = mkdtempSync(join(directory, '.loom-changelog-'));
  try {
    const files = [
      ['CHANGELOG.md', cut.changelog],
      ['package.json', cut.manifest],
    ] satisfies [string, string][];
    for (const [name, contents] of files) {
      writeFileSync(join(stage, name), contents);
      if (existsSync(join(directory, name))) {
        chmodSync(join(stage, name), statSync(join(directory, name)).mode);
      }
    }
    for (const [name] of files) {
      renameSync(join(stage, name), join(directory, name));
    }
    for (const fragment of cut.fragments) {
      rmSync(join(directory, '.changes', fragment.name));
    }
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}
