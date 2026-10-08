import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';

import type { FragmentKind } from './fragments.js';
import { readFragments } from './fragments.js';
import {
  headingText,
  locateRelease,
  requireClosedBlocks,
  withoutByteOrderMark,
} from './markdown.js';
import { git, requireFullHistory } from './repository.js';

function compareNames(left: string, right: string) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function blankLine(text: string) {
  if (text.endsWith('\n\n')) {
    return '';
  }
  if (text.endsWith('\n')) {
    return '\n';
  }
  return '\n\n';
}

// The narrative file an option names, resolved against the working directory, without its byte order mark.
export function readNarrative(cwd: string, path: string | undefined) {
  return path === undefined
    ? undefined
    : withoutByteOrderMark(readFileSync(resolve(cwd, path), 'utf8'));
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

/**
 * The fragments under the root, each group in landing order: by the position of the first-parent
 * commit that added each fragment, then by file name within one commit, so a later correction keeps
 * the fragment's first position and commit dates never enter. A shallow clone hides those commits,
 * and a fragment no commit added has no position, so both fail.
 */
export function landedFragments(root: string, ref?: string) {
  requireFullHistory(root);
  const head = ref ?? git(root, ['rev-parse', 'HEAD']).trim();
  const chain = git(root, ['rev-list', '--first-parent', head]).split('\n').filter(Boolean);
  const positions = new Map(chain.map((commit, index) => [commit, chain.length - index]));
  const fragments = readFragments(root, ref)
    .map((fragment) => {
      const commit = git(root, [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '-1',
        '--format=%H',
        head,
        '--',
        `.changes/${fragment.name}`,
      ]).trim();
      const added = positions.get(commit);
      if (added === undefined) {
        throw new Error(
          `.changes/${fragment.name}: commit the fragment before preparing a release.`,
        );
      }
      return {
        added,
        body: fragment.body,
        kind: fragment.kind,
        name: fragment.name,
        source: fragment.source,
      };
    })
    .toSorted((left, right) => left.added - right.added || compareNames(left.name, right.name));
  return { fragments, head };
}

/** The highest kind present, which decides the bump, or undefined for an empty set. */
export function highestKind(fragments: { kind: FragmentKind }[]) {
  const kinds = new Set(fragments.map((fragment) => fragment.kind));
  return (['breaking', 'feature', 'fix'] satisfies FragmentKind[]).find((kind) => kinds.has(kind));
}

/**
 * One release section: the heading, the narrative when given, then the breaking, feature, and fix
 * groups, each omitted when empty. Fragment and narrative prose is copied verbatim.
 */
export function renderSection(release: {
  date: string;
  fragments: { body: string; kind: FragmentKind }[];
  narrative: string | undefined;
  version: string;
}) {
  let section = `## v${release.version} - ${release.date}\n\n`;
  const { narrative } = release;
  if (narrative !== undefined) {
    requireClosedBlocks(narrative, 'Narrative');
    if (
      !narrative.trim() ||
      fromMarkdown(narrative).children.some((node) => node.type === 'heading' && node.depth <= 2)
    ) {
      throw new Error('Narrative must contain prose without level-one or level-two headings.');
    }
    section += narrative + blankLine(narrative);
  }
  for (const [heading, kind] of [
    ['Breaking Changes', 'breaking'],
    ['Features', 'feature'],
    ['Fixes', 'fix'],
  ] satisfies [string, FragmentKind][]) {
    const entries = release.fragments.filter((fragment) => fragment.kind === kind);
    if (entries.length > 0) {
      section += `### ${heading}\n\n`;
      for (const entry of entries) {
        section += entry.body + blankLine(entry.body);
      }
    }
  }
  return section;
}

/**
 * Where a new release section goes: above the earlier release sections, after the byte order mark,
 * frontmatter, title, and introduction. A changelog without a title, with an Unreleased section, or
 * that already holds the version fails, each with its own sentence.
 */
export function releaseInsertion(changelog: string, version: string) {
  const { body, frontmatter, nodes, releases } = locateRelease(changelog, version);
  requireClosedBlocks(body, 'CHANGELOG.md');
  const headings = nodes.filter((node) => node.type === 'heading');
  if (!headings.some((node) => node.depth === 1)) {
    throw new Error(
      'CHANGELOG.md needs a level-one title, so add one such as # Changelog above its release sections.',
    );
  }
  // An Unreleased heading without a link definition keeps its brackets as text.
  const titles = headings.map((node) => headingText(node).trim());
  if (titles.some((title) => /^\[?unreleased\]?$/iu.test(title))) {
    throw new Error(
      'CHANGELOG.md has an Unreleased section, so move its entries into fragments in .changes/ and delete the section.',
    );
  }
  if (titles.some((title) => title.split(/\s/u)[0] === `v${version}`)) {
    throw new Error(
      `CHANGELOG.md already has a v${version} section, so set the version in package.json to the latest release it records and cut again.`,
    );
  }
  const offset = releases[0]?.position?.start.offset;
  const before = offset === undefined ? changelog : changelog.slice(0, frontmatter.length + offset);
  const after = offset === undefined ? '' : changelog.slice(frontmatter.length + offset);
  return { after, before: before + blankLine(before) };
}

// The section as it lands. A section that ends the file closes with one newline.
// A section above an earlier release keeps its blank line before that release's heading.
export function placedSection(section: string, after: string) {
  return after === '' ? section.replace(/\n+$/u, '\n') : section;
}

export function insertSection(changelog: string, section: string, version: string) {
  const { after, before } = releaseInsertion(changelog, version);
  return before + placedSection(section, after) + after;
}
