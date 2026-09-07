import { fromMarkdown } from 'mdast-util-from-markdown';

import { readFragments } from './fragments.ts';
import { requireClosedBlocks } from './markdown.ts';
import { unchangedLibraries } from './material.ts';
import { currentVersion, git, readLibraries } from './repository.ts';

function compareNames(left: string, right: string) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function prepareRelease(
  root: string,
  options: {
    date: string;
    initial: boolean;
    since: string | undefined;
    narrative: string | undefined;
  },
) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('Release preparation requires full Git history.');
  }
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const fragments = readFragments(root)
    .map((fragment) => {
      const added = git(root, [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '-1',
        '--format=%ct',
        'HEAD',
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
  const libraries = readLibraries(root);
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
      : unchangedLibraries(root, libraries, options.since ?? `v${current.text}`);
  if (unchanged.length > 0) {
    section += `No material changes: ${unchanged.join(', ')}.\n\n`;
  }
  return { fragments, head, libraries, section, version };
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
