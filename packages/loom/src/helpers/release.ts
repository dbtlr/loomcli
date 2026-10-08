import { highestKind, landedFragments, renderSection } from './changelog.js';
import { materialBaseline, unchangedLibraries } from './material.js';
import { currentVersion, readLibraries } from './repository.js';
import { nextVersion } from './version.js';

export function prepareRelease(
  root: string,
  options: {
    date: string;
    initial: boolean;
    since: string | undefined;
    narrative: string | undefined;
  },
  ref?: string,
) {
  const { fragments, head } = landedFragments(root, ref);
  const libraries = readLibraries(root, ref);
  const current = currentVersion(libraries);
  if (options.initial && current.text !== '0.0.0') {
    throw new Error('--initial requires library version 0.0.0.');
  }
  if (fragments.length === 0 && !options.initial) {
    throw new Error('No fragments to release.');
  }
  const version = nextVersion(current, highestKind(fragments));
  let section = renderSection({
    date: options.date,
    fragments,
    narrative: options.narrative,
    version,
  });
  const unchanged =
    current.text === '0.0.0'
      ? []
      : unchangedLibraries(
          root,
          libraries,
          options.since ?? materialBaseline(root, libraries, current.text, head),
          ref,
        );
  if (unchanged.length > 0) {
    section += `No material changes: ${unchanged.join(', ')}.\n\n`;
  }
  return { fragments, head, libraries, section, version };
}

// A release must carry notes, because the release plan refuses a changelog section that says nothing.
// Only an initial cut can reach that state: every other cut consumes at least one fragment.
export function requireReleaseNotes(release: ReturnType<typeof prepareRelease>) {
  const body = release.section.slice(release.section.indexOf('\n') + 1);
  if (body.trim() === '') {
    throw new Error(
      `Release v${release.version} carries no entries, so it requires a narrative for its notes.`,
    );
  }
}
