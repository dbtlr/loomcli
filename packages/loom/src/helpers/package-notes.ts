import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { landedFragments, renderGroups } from './changelog.js';
import type { ChangelogFiles } from './changelog.js';
import { releaseBody } from './markdown.js';
import { packageVersion, requireHistory } from './package-changelog.js';
import { readWorkingFile } from './repository.js';
import type { Checkout } from './repository.js';
import type { SemVer } from './version.js';

// The body of a cut version's changelog section.
function stableNotes(directory: string, version: SemVer, files: ChangelogFiles) {
  const changelog = existsSync(join(directory, files.changelog))
    ? readWorkingFile(directory, files.changelog)
    : '';
  const body = releaseBody(changelog, version.text);
  if (body === undefined) {
    throw new Error(
      `${files.changelog} holds no v${version.text} section, so the version has not been cut; run loom changelog write first.`,
    );
  }
  return body === '' ? '' : `${body}\n`;
}

// The pending fragments of the package's current prerelease, grouped as a section renders them.
async function prereleaseNotes(checkout: Checkout, version: SemVer, files: ChangelogFiles) {
  const directory = checkout.root;
  const current = packageVersion(
    readWorkingFile(directory, 'package.json'),
    join(directory, 'package.json'),
  );
  if (current.text !== version.text) {
    throw new Error(
      `${version.text} is not the package's current version ${current.text}, so its fragments are not the ones pending; preview a candidate with loom changelog write --target ${version.text} --dry-run.`,
    );
  }
  await requireHistory(checkout, 'notes');
  const { fragments } = await landedFragments(checkout, undefined, files.changes);
  if (fragments.length === 0) {
    throw new Error(`No fragments are pending in ${files.changes}/ for ${version.text}.`);
  }
  return renderGroups(fragments);
}

/**
 * One version's notes for a release page. A stable version prints the body of its changelog
 * section and fails when the version has not been cut. A prerelease prints the pending fragments
 * and must be the package's current version.
 */
export async function packageNotes(checkout: Checkout, version: SemVer, files: ChangelogFiles) {
  return version.prerelease.length === 0
    ? stableNotes(checkout.root, version, files)
    : await prereleaseNotes(checkout, version, files);
}
