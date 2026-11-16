import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { landedFragments, renderGroups } from './changelog.js';
import type { ChangelogFiles } from './changelog.js';
import { releaseBody } from './markdown.js';
import { noPendingFragments, notCurrentVersion, versionNotCut } from './messages.js';
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
    throw new Error(versionNotCut(files.changelog, version.text));
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
    throw new Error(notCurrentVersion(version.text, current.text));
  }
  await requireHistory(checkout, 'notes');
  const { fragments } = await landedFragments(checkout, undefined, files.changes);
  if (fragments.length === 0) {
    throw new Error(noPendingFragments(files.changes, version.text));
  }
  // The groups close with a blank line between sections; the notes end with one newline, as a stable body does.
  return renderGroups(fragments).replace(/\n+$/u, '\n');
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
