import { fromMarkdown } from 'mdast-util-from-markdown';

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
// The index is -1 while the changelog carries no section for the version.
export function locateRelease(changelog: string, version: string): ReleaseLocation {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/u.exec(changelog)?.[0] ?? '';
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
