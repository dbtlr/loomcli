import { fromMarkdown } from 'mdast-util-from-markdown';

import { readFragments } from './fragments.js';
import { requireClosedBlocks } from './markdown.js';
import { materialBaseline, unchangedLibraries } from './material.js';
import { currentVersion, git, readLibraries, requireFullHistory } from './repository.js';

function compareNames(left: string, right: string) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function releaseDate(input: string | undefined) {
  const date = input ?? new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error('Expected a calendar date: YYYY-MM-DD.');
  }
  return date;
}

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
  requireFullHistory(root);
  const head = ref ?? git(root, ['rev-parse', 'HEAD']).trim();
  const fragments = readFragments(root, ref)
    .map((fragment) => {
      const added = git(root, [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '-1',
        '--format=%ct',
        head,
        '--',
        `.changes/${fragment.name}`,
      ]).trim();
      if (!/^\d+$/u.test(added)) {
        throw new Error(
          `.changes/${fragment.name}: commit the fragment before preparing a release.`,
        );
      }
      return {
        added: Number(added),
        body: fragment.body,
        breaking: fragment.breaking,
        name: fragment.name,
      };
    })
    .toSorted((left, right) => left.added - right.added || compareNames(left.name, right.name));
  const libraries = readLibraries(root, ref);
  const current = currentVersion(libraries);
  if (options.initial && current.text !== '0.0.0') {
    throw new Error('--initial requires library version 0.0.0.');
  }
  if (fragments.length === 0 && !options.initial) {
    throw new Error('No fragments to release.');
  }
  const breaking = fragments.filter((fragment) => fragment.breaking);
  const ordinary = fragments.filter((fragment) => !fragment.breaking);
  let version = `0.${current.minor}.${current.patch + 1}`;
  if (breaking.length > 0) {
    version = `0.${current.minor + 1}.0`;
  }
  if (current.text === '0.0.0') {
    version = '0.1.0';
  }
  let section = `## v${version} - ${options.date}\n\n`;
  if (options.narrative !== undefined) {
    requireClosedBlocks(options.narrative, 'Narrative');
    if (
      !options.narrative.trim() ||
      fromMarkdown(options.narrative).children.some(
        (node) => node.type === 'heading' && node.depth <= 2,
      )
    ) {
      throw new Error('Narrative must contain prose without level-one or level-two headings.');
    }
    section += options.narrative + blankLine(options.narrative);
  }
  for (const [heading, entries] of [
    ['Breaking Changes', breaking],
    ['Changes', ordinary],
  ] satisfies [string, typeof fragments][]) {
    if (entries.length > 0) {
      section += `### ${heading}\n\n`;
      for (const entry of entries) {
        section += entry.body + blankLine(entry.body);
      }
    }
  }
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

export function blankLine(text: string) {
  if (text.endsWith('\n\n')) {
    return '';
  }
  if (text.endsWith('\n')) {
    return '\n';
  }
  return '\n\n';
}
