import { fromMarkdown } from 'mdast-util-from-markdown';

import { withoutByteOrderMark } from './byte-order-mark.js';
import { parseVersion } from './version.js';
import type { Version } from './version.js';

type Node = ReturnType<typeof fromMarkdown>['children'][number];

type Heading = Extract<Node, { type: 'heading' }>;

function text(nodes: Heading['children']): string {
  return nodes
    .map((node) => {
      if (node.type === 'html') {
        return '';
      }
      if ('value' in node) {
        return node.value;
      }
      if ('children' in node) {
        return text(node.children);
      }
      return '';
    })
    .join('');
}

// A release section's version is the first word of its level-two heading, when that word is `v`
// And a MAJOR.MINOR.PATCH version. Any other level-two heading names no release.
function headingVersion(heading: Heading) {
  const word = headingText(heading).trim().split(/\s/u)[0] ?? '';
  return word.startsWith('v') ? parseVersion(word.slice(1)) : undefined;
}

export interface ReleaseLocation {
  body: string;
  frontmatter: string;
  index: number;
  nodes: Node[];
  releases: Heading[];
}

export function headingText(heading: Heading) {
  return text(heading.children);
}

// A changelog opens every release with a depth-2 heading whose first word is the version.
// The frontmatter is not Markdown, so it is split off before the body is parsed, and every offset counts from the body.
// A leading byte order mark counts as part of the frontmatter, so it stays where it is.
// The index is -1 while the changelog carries no section for the version.
export function locateRelease(changelog: string, version: string): ReleaseLocation {
  const mark = changelog.length - withoutByteOrderMark(changelog).length;
  const frontmatter =
    changelog.slice(0, mark) +
    (/^---\r?\n[\s\S]*?\r?\n---\r?\n/u.exec(changelog.slice(mark))?.[0] ?? '');
  const body = changelog.slice(frontmatter.length);
  const nodes = fromMarkdown(body).children;
  const releases = nodes.flatMap((node) =>
    node.type === 'heading' && node.depth === 2 ? [node] : [],
  );
  const index = releases.findIndex(
    (heading) => headingText(heading).trim().split(/\s/u)[0] === `v${version}`,
  );
  return { body, frontmatter, index, nodes, releases };
}

/** The version of every release section the changelog holds, in the order they appear. */
export function releaseVersions(changelog: string): Version[] {
  return locateRelease(changelog, '').releases.flatMap((heading) => headingVersion(heading) ?? []);
}

/**
 * The body of one version's release section: everything under its heading up to the next release
 * section, without the blank lines around it. Undefined when the changelog holds no such section.
 * A level-two heading that names no release belongs to the body.
 */
export function releaseBody(changelog: string, version: string): string | undefined {
  const { body, index, releases } = locateRelease(changelog, version);
  const start = releases[index]?.position?.end.offset;
  if (start === undefined) {
    return undefined;
  }
  const next = releases.slice(index + 1).find((heading) => headingVersion(heading) !== undefined);
  return body.slice(start, next?.position?.start.offset ?? body.length).trim();
}

// A fragment must finish its blocks so later release headings remain structural headings.
export function requireClosedBlocks(source: string, label: string) {
  const boundary = fromMarkdown(`${source}\n\n## Release boundary\n`).children.at(-1);
  if (
    boundary?.type !== 'heading' ||
    boundary.depth !== 2 ||
    headingText(boundary) !== 'Release boundary'
  ) {
    throw new Error(`${label}: unclosed Markdown block would swallow later release entries.`);
  }
}
