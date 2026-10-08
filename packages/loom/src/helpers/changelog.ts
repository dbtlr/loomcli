import { fromMarkdown } from 'mdast-util-from-markdown';

import type { FragmentKind } from './fragments.js';
import { readFragments } from './fragments.js';
import { headingText, locateRelease, requireClosedBlocks } from './markdown.js';
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

/** A `MAJOR.MINOR.PATCH` version, split into its numbers. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  text: string;
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
 * The fragments under the root, each group in landing order: by the first-parent commit that added
 * each fragment, then by file name, so a later correction keeps the fragment's first position.
 * A shallow clone hides those commits, and a fragment no commit added has no position, so both fail.
 */
export function landedFragments(root: string, ref?: string) {
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
        kind: fragment.kind,
        name: fragment.name,
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
 * The next version. `0.0.0` cuts `0.1.0`. Below `1.0.0`, breaking advances the minor and anything
 * else the patch; from `1.0.0`, breaking advances the major, feature the minor, and fix the patch.
 */
export function nextVersion(current: Version, highest: FragmentKind | undefined) {
  if (current.text === '0.0.0') {
    return '0.1.0';
  }
  if (highest === 'breaking') {
    return current.major === 0 ? `0.${current.minor + 1}.0` : `${current.major + 1}.0.0`;
  }
  if (highest === 'feature' && current.major > 0) {
    return `${current.major}.${current.minor + 1}.0`;
  }
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

/** Reads a `MAJOR.MINOR.PATCH` version; a prerelease or any other form fails. */
export function parseVersion(text: string): Version {
  const match = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u.exec(text);
  if (!match) {
    throw new Error(
      `package.json version ${JSON.stringify(text)} is not MAJOR.MINOR.PATCH. Prerelease versions belong to release orchestration.`,
    );
  }
  const major = Number(match.groups?.major);
  const minor = Number(match.groups?.minor);
  const patch = Number(match.groups?.patch);
  if (![major + 1, minor + 1, patch + 1].every((value) => Number.isSafeInteger(value))) {
    throw new Error(`package.json version ${text} has components that are too large.`);
  }
  return { major, minor, patch, text };
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
 * Where a new release section goes: above the earlier release sections, after the frontmatter,
 * title, and introduction. A changelog without a title, with an Unreleased section, or that
 * already holds the version fails.
 */
export function releaseInsertion(changelog: string, version: string) {
  const { body, frontmatter, nodes, releases } = locateRelease(changelog, version);
  requireClosedBlocks(body, 'CHANGELOG.md');
  const headings = nodes.filter((node) => node.type === 'heading');
  if (!headings.some((node) => node.depth === 1)) {
    throw new Error('CHANGELOG.md requires a title.');
  }
  if (
    headings.some(
      (node) =>
        headingText(node).trim().toLowerCase() === 'unreleased' ||
        headingText(node).trim().split(/\s/u)[0] === `v${version}`,
    )
  ) {
    throw new Error('CHANGELOG.md already contains this version or an Unreleased section.');
  }
  const offset = releases[0]?.position?.start.offset;
  const before = offset === undefined ? changelog : changelog.slice(0, frontmatter.length + offset);
  const after = offset === undefined ? '' : changelog.slice(frontmatter.length + offset);
  return { after, before: before + blankLine(before) };
}

export function insertSection(changelog: string, section: string, version: string) {
  const { after, before } = releaseInsertion(changelog, version);
  return before + section + after;
}
