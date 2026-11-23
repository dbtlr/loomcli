import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';

import {
  changelogWithoutTitle,
  narrativeHeadings,
  notCalendarDate,
  sectionExists,
  uncommittedFragment,
  unreleasedSection,
} from '../commands/changelog/messages.js';
import { withoutByteOrderMark } from './byte-order-mark.js';
import { conventionalChangelog, conventionalFragments } from './conventions.js';
import type { FragmentKind } from './fragments.js';
import { readFragments, requireSafeCharacters } from './fragments.js';
import { headingText, locateRelease, requireClosedBlocks } from './markdown.js';
import { git, gitLine, readPlacement, requireFullHistory, workspaceAt } from './repository.js';
import type { Checkout } from './repository.js';

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

/** A first-parent chain of commits, newest first, and each commit's position, oldest at 1. */
interface Chain {
  commits: string[];
  positions: Map<string, number>;
}

/** The newest commit of the chain at or before `from` that added `place`, or undefined when none did. */
async function addition(checkout: Checkout, chain: Chain, from: string, place: string) {
  const commit = await gitLine(checkout, [
    'log',
    '--first-parent',
    '--diff-filter=A',
    '-1',
    '--format=%H',
    from,
    '--',
    place,
  ]);
  const position = chain.positions.get(commit);
  return position === undefined ? undefined : { commit, position };
}

/**
 * The position a fragment the move carried landed at before the move, or undefined when the commit
 * that added it where the workspace sits now did not carry it. That commit carried it when its
 * parent held the workspace at the top of the work tree, `former`, and the fragment there, at
 * `place`.
 */
async function carriedPosition(
  checkout: Checkout,
  chain: Chain,
  added: string,
  place: string,
  former: string,
) {
  const parent = chain.commits[chain.commits.indexOf(added) + 1];
  if (
    parent === undefined ||
    (await workspaceAt(checkout, parent)) !== former ||
    !(await git(checkout, ['ls-tree', parent, '--', place]))
  ) {
    return undefined;
  }
  const before = await addition(checkout, chain, parent, place);
  return before?.position;
}

/**
 * The fragments in the folder in landing order, as `landedFragments` describes. `former` is the
 * path from the root to the top of the work tree, where the workspace sat before it moved, or `''`
 * to read each fragment only where the revision holds it.
 */
async function landedAt(
  checkout: Checkout,
  ref: string | undefined,
  folder: string,
  former: string,
) {
  await requireFullHistory(checkout);
  const head = ref ?? (await gitLine(checkout, ['rev-parse', 'HEAD']));
  const history = await git(checkout, ['rev-list', '--first-parent', head]);
  const commits = history.split('\n').filter(Boolean);
  const chain = {
    commits,
    positions: new Map(commits.map((commit, index) => [commit, commits.length - index])),
  };
  const landed = [];
  const location = await workspaceAt(checkout, ref);
  for (const fragment of await readFragments(checkout, ref, folder)) {
    const path = `${folder}/${fragment.name}`;
    const place = `${location}${path}`;
    // A working-tree fragment the head does not hold is uncommitted, though an earlier one of its name landed.
    const committed =
      ref !== undefined || (await git(checkout, ['ls-tree', head, '--', place])) !== '';
    const here = committed ? await addition(checkout, chain, head, place) : undefined;
    if (here === undefined) {
      throw new Error(uncommittedFragment(path));
    }
    const carried =
      former === '' || former === location
        ? undefined
        : await carriedPosition(checkout, chain, here.commit, `${former}${path}`, former);
    landed.push({
      added: carried ?? here.position,
      body: fragment.body,
      kind: fragment.kind,
      name: fragment.name,
      source: fragment.source,
    });
  }
  const fragments = landed.toSorted(
    (left, right) => left.added - right.added || compareNames(left.name, right.name),
  );
  return { fragments, head };
}

/**
 * The narrative file an option names, resolved against the working directory, without its byte
 * order mark. A narrative holding bytes or a character a fragment refuses fails, naming the path
 * as the option gave it.
 */
export function readNarrative(cwd: string, path: string | undefined) {
  if (path === undefined) {
    return undefined;
  }
  const bytes = readFileSync(resolve(cwd, path));
  requireSafeCharacters(path, bytes, 'narrative');
  return withoutByteOrderMark(bytes.toString('utf8'));
}

export function releaseDate(input: string | undefined) {
  const date = input ?? new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(notCalendarDate);
  }
  return date;
}

/**
 * The fragments in the folder under the root, each group in landing order: by the position of the
 * first-parent commit that added each fragment, then by file name within one commit, so a later
 * correction keeps the fragment's first position and commit dates never enter. A shallow clone
 * hides those commits, and a fragment no commit added has no position, so both fail.
 */
export async function landedFragments(
  checkout: Checkout,
  ref?: string,
  folder = conventionalFragments,
) {
  return await landedAt(checkout, ref, folder, '');
}

/**
 * The workspace's own fragments in landing order, as `landedFragments` reads them. Below the top of
 * the work tree, a fragment the move carried keeps the position it landed at before the move, at
 * the same path at the top, where the workspace sat. Every other fragment takes its position from
 * where the workspace sits now, so a fragment that reuses the name of one a cut consumed before the
 * move lands where it was added, and an uncommitted one has no position.
 */
export async function landedWorkspaceFragments(checkout: Checkout, ref?: string) {
  const { up } = await readPlacement(checkout);
  return await landedAt(checkout, ref, conventionalFragments, up);
}

/** The highest kind present, which decides the bump, or undefined for an empty set. */
export function highestKind(fragments: { kind: FragmentKind }[]) {
  const kinds = new Set(fragments.map((fragment) => fragment.kind));
  return (['breaking', 'feature', 'fix'] satisfies FragmentKind[]).find((kind) => kinds.has(kind));
}

/** Refuses a narrative that is empty, leaves a Markdown block open, or holds a level-one or level-two heading. */
export function requireNarrative(narrative: string) {
  requireClosedBlocks(narrative, 'Narrative');
  if (
    !narrative.trim() ||
    fromMarkdown(narrative).children.some((node) => node.type === 'heading' && node.depth <= 2)
  ) {
    throw new Error(narrativeHeadings);
  }
}

/**
 * The breaking, feature, and fix groups of a set of fragments, each omitted when empty, with each
 * fragment's prose copied verbatim. These are the entries of a release section and the notes of a
 * prerelease.
 */
export function renderGroups(fragments: { body: string; kind: FragmentKind }[]) {
  let groups = '';
  for (const [heading, kind] of [
    ['Breaking Changes', 'breaking'],
    ['Features', 'feature'],
    ['Fixes', 'fix'],
  ] satisfies [string, FragmentKind][]) {
    const entries = fragments.filter((fragment) => fragment.kind === kind);
    if (entries.length > 0) {
      groups += `### ${heading}\n\n`;
      for (const entry of entries) {
        groups += entry.body + blankLine(entry.body);
      }
    }
  }
  return groups;
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
    requireNarrative(narrative);
    section += narrative + blankLine(narrative);
  }
  return section + renderGroups(release.fragments);
}

/**
 * The changelog and the fragment folder a cut names, as the operator reads them: relative to the
 * package directory, or to the workspace directory for Loom's own release.
 */
export interface ChangelogFiles {
  readonly changelog: string;
  readonly changes: string;
}

/** The changelog and the fragment folder a repository or a package keeps when nothing names others. */
export const conventionalFiles: ChangelogFiles = {
  changelog: conventionalChangelog,
  changes: conventionalFragments,
};

/**
 * Where a new release section goes: above the earlier release sections, after the byte order mark,
 * frontmatter, title, and introduction. A changelog without a title, with an Unreleased section, or
 * that already holds the version fails, each with its own sentence that names the files.
 */
export function releaseInsertion(
  changelog: string,
  version: string,
  { changelog: file, changes } = conventionalFiles,
) {
  const { body, frontmatter, index, nodes, releases } = locateRelease(changelog, version);
  requireClosedBlocks(body, file);
  const headings = nodes.filter((node) => node.type === 'heading');
  if (!headings.some((node) => node.depth === 1)) {
    throw new Error(changelogWithoutTitle(file));
  }
  // An Unreleased heading without a link definition keeps its brackets as text.
  const titles = headings.map((node) => headingText(node).trim());
  if (titles.some((title) => /^\[?unreleased\]?$/iu.test(title))) {
    throw new Error(unreleasedSection(file, changes));
  }
  if (index !== -1) {
    throw new Error(sectionExists(file, version));
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

export function insertSection(
  changelog: string,
  section: string,
  version: string,
  files = conventionalFiles,
) {
  const { after, before } = releaseInsertion(changelog, version, files);
  return before + placedSection(section, after) + after;
}
